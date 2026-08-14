import { PUBLISHABLE_STATUS, roleAtLeast } from '@rit/shared';
import type {
  Allergen,
  ApproveAllergensInput,
  CreateRecipeInput,
  ForkRecipeInput,
  ListRecipesQuery,
  MediaAssetView,
  MoveRecipeInput,
  PaginatedResponse,
  PublishRecipeInput,
  AccessCandidate,
  RecipeContentInput,
  RecipeContentView,
  RecipeDetail,
  RecipePublishModeView,
  RecipeSummary,
  RecipeVersionDetail,
  RecipeVersionSummary,
  SaveVersionInput,
  TenantContext,
  TenantScope,
  UpdateRecipeAccessInput,
  UpdateRecipeInput,
} from '@rit/shared';
import { Types } from 'mongoose';
import type { Document } from 'mongoose';
import { AppError } from '../../lib/AppError';
import { escapeRegex } from '../../lib/regex';
import {
  assertCanWriteAt,
  assertRole,
  membershipReadersFilter,
  scopeForWrite,
  scopeReadFilter,
} from '../../lib/scope';
import { assertPhotosAttachable, resolveAssets, widenAssetsToCover } from '../media/media.service';
import {
  assertAccessListValid,
  canBypassPersonAccess,
  dedupeAccessUserIds,
  personAccessFilter,
} from '../tenancy/personAccess';
import { Membership } from '../tenancy/membership.model';
import { User } from '../auth/auth.model';
import {
  autoTranslateOnPublish,
  beginAutoTranslation,
  invalidateForActiveVersion,
} from '../translations/translation.service';
import { Property } from '../tenancy/property.model';
import { Location } from '../tenancy/location.model';
import { resolveRecipePublishModeForScope } from '../tenancy/tenancy.service';
import { Recipe } from './recipe.model';
import { RecipeVersion } from './recipeVersion.model';
import { RecipeTranslation } from '../translations/translation.model';
import type {
  IAllergenTag,
  IRecipe,
  IRecipeContent,
  IRecipeVersion,
  IScope,
  IUser,
} from '../../types/index';

/**
 * Recipes: one mutable working copy per lineage, immutable numbered versions,
 * one active version that kitchen staff cook from, and forking into new
 * lineages. The safety spine runs through here — allergen sign-off state is
 * server-owned, and anyone below chef only ever sees active, approved content.
 */

type LeanRecipe = Omit<IRecipe, keyof Document> & { _id: unknown };
type LeanVersion = Omit<IRecipeVersion, keyof Document> & { _id: unknown };

// ── Small helpers ─────────────────────────────────────────────────────────────

/**
 * Kicks off automatic translation for a recipe whose live text just changed,
 * without waiting for the translation itself.
 *
 * Two halves, and the split is the point. Claiming the run is *awaited*: it is
 * one small local write, and it means the recipe page a chef opens a second
 * later already knows Spanish is coming, instead of offering a "Translate"
 * button that would run the same work twice. The translation itself stays
 * detached — whether the Spanish gets written is a setting on the tenant, but
 * whether the *English* goes live is what the chef pressed the button for, and
 * an LLM call that takes seconds and may fail must never delay or roll back the
 * activation.
 *
 * `autoTranslateOnPublish` never rejects — the catch is a belt-and-braces guard
 * against an unhandled rejection taking the process down, since nothing awaits
 * this promise.
 */
async function scheduleAutoTranslation(recipeId: string, userId: string): Promise<void> {
  const willRun = await beginAutoTranslation(recipeId);
  if (!willRun) return;

  void autoTranslateOnPublish(recipeId, userId).catch((err) => {
    console.error('Automatic translation could not be scheduled', err);
  });
}

/** Readers (below chef) see only active versions and approved allergen tags. */
function isReader(ctx: TenantContext): boolean {
  return !ctx.isPlatformAdmin && !roleAtLeast(ctx.role, 'chef');
}

function shapeScope(scope: IScope): TenantScope {
  return {
    orgId: String(scope.orgId),
    propertyId: scope.propertyId ? String(scope.propertyId) : null,
    locationId: scope.locationId ? String(scope.locationId) : null,
  };
}

/** Role + write-tier check: may `ctx` mutate a recipe living at `scope`? */
function canManage(ctx: TenantContext, scope: TenantScope): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (!roleAtLeast(ctx.role, 'chef')) return false;
  try {
    assertCanWriteAt(ctx, { propertyId: scope.propertyId, locationId: scope.locationId });
    return true;
  } catch {
    return false;
  }
}

/** True only when tags exist and every one has cleared human review. */
function tagsVerified(tags: IAllergenTag[] | null | undefined): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.every((t) => t.status === PUBLISHABLE_STATUS);
}

function refIdsOf(lines: Array<{ kind: string; recipeId?: unknown }>): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.kind === 'recipe' && line.recipeId) ids.add(String(line.recipeId));
  }
  return [...ids];
}

/**
 * Canonical form of an ingredient list for change detection. Excludes `note` —
 * a prep note ("chop finely") does not change what is in the dish, and the
 * allergen reset below is keyed to composition, not phrasing.
 */
function canonicalIngredients(
  lines: Array<{
    kind: string;
    name?: string | null;
    recipeId?: unknown;
    quantity: { amount: number; unit: string };
  }>
): string {
  return JSON.stringify(
    lines.map((l) => ({
      kind: l.kind,
      name: l.name ?? null,
      recipeId: l.recipeId ? String(l.recipeId) : null,
      amount: l.quantity.amount,
      unit: l.quantity.unit,
    }))
  );
}

/**
 * Reconciles the stored allergen tags with a submitted tag list.
 *
 * SAFETY: approval stamps only survive an edit when the ingredient list is
 * unchanged — an approval was made against a specific composition, and keeping
 * it across a swap of "sunflower oil" for "peanut oil" would be a stale safety
 * claim. Mirrors the translations rule: editing the source invalidates the
 * sign-off. Exported for direct unit testing.
 */
export function mergeAllergenTags(
  existing: IAllergenTag[],
  requested: Allergen[],
  ingredientsChanged: boolean
): IAllergenTag[] {
  const prior = new Map(existing.map((t) => [t.allergen, t]));
  return requested.map((allergen) => {
    const kept = prior.get(allergen);
    if (kept && !ingredientsChanged) {
      return {
        allergen,
        status: kept.status,
        approvedBy: kept.approvedBy ?? null,
        approvedAt: kept.approvedAt ?? null,
      };
    }
    return { allergen, status: 'pending_review', approvedBy: null, approvedAt: null };
  });
}

function pendingTags(allergens: Allergen[]): IAllergenTag[] {
  return allergens.map((allergen) => ({
    allergen,
    status: 'pending_review' as const,
    approvedBy: null,
    approvedAt: null,
  }));
}

/** Builds stored content from validated client input plus server-owned fields. */
function buildContent(input: RecipeContentInput, allergens: IAllergenTag[]): IRecipeContent {
  return {
    description: input.description,
    yield: input.yield,
    ingredients: input.ingredients.map((line) =>
      line.kind === 'item'
        ? { kind: 'item' as const, name: line.name, recipeId: null, quantity: line.quantity, note: line.note }
        : {
            kind: 'recipe' as const,
            recipeId: new Types.ObjectId(line.recipeId),
            quantity: line.quantity,
            note: line.note,
          }
    ),
    steps: input.steps,
    allergens,
    dietary: input.dietary,
    // Order is the chef's: index 0 is the hero shot. Validated by
    // `assertPhotosAttachable` before we get here.
    photoIds: input.photoIds.map((id) => new Types.ObjectId(id)),
    times: input.times,
  };
}

// ── Reference validation ──────────────────────────────────────────────────────

/**
 * Validates every `recipe`-kind ingredient line against `targetScope`:
 *
 * - the referenced recipe must exist inside the caller's read scope → 404
 *   (existence hiding — same as any other out-of-scope read);
 * - it must not be archived → 400;
 * - its scope must sit at-or-above `targetScope` → 400. Anything narrower
 *   would render broken for part of the referencing recipe's audience: a
 *   property recipe pointing at one location's sub-recipe is unreadable at
 *   every sibling location;
 * - a person-restricted recipe may only be NEWLY referenced by someone who can
 *   read it → 404. Ids in `accessExemptIds` — refs the document already
 *   carries — are grandfathered past that last check only.
 */
async function validateSubRefs(
  ctx: TenantContext,
  targetScope: TenantScope,
  lines: Array<{ kind: string; recipeId?: unknown }>,
  accessExemptIds?: Set<string>
): Promise<void> {
  const refIds = refIdsOf(lines);
  if (refIds.length === 0) return;

  const refs = await Recipe.find({ _id: { $in: refIds }, ...scopeReadFilter(ctx) })
    .select('status scope')
    .lean();
  const byId = new Map(refs.map((r) => [String(r._id), r]));

  if (refIds.some((id) => !byId.has(id))) throw new AppError('Sub-recipe not found', 404);

  // Person-restricted sub-recipes: a NEW reference requires read access — a
  // chef must not attach a recipe they cannot see, which would broadcast its
  // name to this recipe's whole audience. Exempt ids skip the check, so
  // restricting a recipe never bricks resaves of recipes already using it.
  // Same 404 as above: out-of-access and nonexistent are indistinguishable.
  if (!canBypassPersonAccess(ctx)) {
    const newIds = refIds.filter((id) => !accessExemptIds?.has(id));
    if (newIds.length > 0) {
      const readable = await Recipe.find({
        _id: { $in: newIds },
        ...scopeReadFilter(ctx),
        ...personAccessFilter(ctx),
      })
        .select('_id')
        .lean();
      if (readable.length !== newIds.length) throw new AppError('Sub-recipe not found', 404);
    }
  }

  const badLines: number[] = [];
  const archivedLines: number[] = [];
  lines.forEach((line, index) => {
    if (line.kind !== 'recipe' || !line.recipeId) return;
    const ref = byId.get(String(line.recipeId))!;
    if (ref.status === 'archived') archivedLines.push(index);
    const refScope = shapeScope(ref.scope);
    if (refScope.propertyId && refScope.propertyId !== targetScope.propertyId) badLines.push(index);
    else if (refScope.locationId && refScope.locationId !== targetScope.locationId)
      badLines.push(index);
  });

  if (archivedLines.length > 0) {
    throw new AppError(`Ingredient line ${archivedLines.join(', ')} references an archived recipe`, 400);
  }
  if (badLines.length > 0) {
    throw new AppError(
      `Ingredient line ${badLines.join(', ')} references a recipe scoped below this one — it would be unreadable for part of this recipe's audience`,
      400
    );
  }
}

/**
 * Rejects an ingredient list that would make `rootId` reachable from itself.
 *
 * BFS over the lineage graph, batched per level. Each visited recipe
 * contributes the refs of its working copy AND of its active version —
 * consumption resolves active versions, and an active snapshot can reference
 * recipes its current working copy no longer does. Exported for unit tests.
 *
 * Composes only scopeReadFilter — never the person-level access filter. An
 * ACL-hidden node would make a real cycle undetectable, and nothing traversed
 * here reaches the caller beyond a generic 409.
 */
export async function assertNoCycle(
  ctx: TenantContext,
  rootId: string,
  lines: Array<{ kind: string; recipeId?: unknown }>
): Promise<void> {
  const cycle = () => new AppError('This change would create a circular sub-recipe reference', 409);

  let frontier = refIdsOf(lines);
  if (frontier.includes(rootId)) throw cycle();
  const visited = new Set<string>(frontier);

  while (frontier.length > 0) {
    // A real recipe tree is a few levels deep; hundreds means something is
    // wrong, and unbounded traversal on every save is a denial-of-service.
    if (visited.size > 500) {
      throw new AppError('Sub-recipe tree is too large to verify', 409);
    }

    const heads = await Recipe.find({ _id: { $in: frontier }, ...scopeReadFilter(ctx) })
      .select('workingCopy.ingredients activeVersionId')
      .lean();
    const activeIds = heads.map((h) => h.activeVersionId).filter(Boolean);
    const versions =
      activeIds.length > 0
        ? await RecipeVersion.find({ _id: { $in: activeIds } })
            .select('content.ingredients')
            .lean()
        : [];

    const next = new Set<string>();
    for (const head of heads) for (const id of refIdsOf(head.workingCopy.ingredients)) next.add(id);
    for (const v of versions) for (const id of refIdsOf(v.content.ingredients)) next.add(id);

    if (next.has(rootId)) throw cycle();
    frontier = [...next].filter((id) => !visited.has(id));
    frontier.forEach((id) => visited.add(id));
  }
}

/**
 * A write target's property/location must actually exist in this org —
 * `scopeForWrite` checks tier containment, not existence, and a scope pointing
 * at a foreign or deleted property is a document nobody can ever read.
 */
async function assertScopeExists(scope: TenantScope): Promise<void> {
  if (scope.propertyId) {
    const property = await Property.exists({ _id: scope.propertyId, orgId: scope.orgId });
    if (!property) throw new AppError('Not found', 404);
  }
  if (scope.locationId) {
    const location = await Location.exists({
      _id: scope.locationId,
      orgId: scope.orgId,
      propertyId: scope.propertyId,
    });
    if (!location) throw new AppError('Not found', 404);
  }
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeContent(
  content: IRecipeContent,
  subNames: Map<string, string>,
  photos: Map<string, MediaAssetView>,
  staffView: boolean
): RecipeContentView {
  const tags = staffView
    ? content.allergens.filter((t) => t.status === PUBLISHABLE_STATUS)
    : content.allergens;
  return {
    description: content.description,
    yield: { amount: content.yield.amount, unit: content.yield.unit },
    ingredients: content.ingredients.map((line) => ({
      kind: line.kind,
      name:
        line.kind === 'recipe'
          ? (subNames.get(String(line.recipeId)) ?? 'Unavailable recipe')
          : (line.name ?? ''),
      recipeId: line.recipeId ? String(line.recipeId) : null,
      quantity: { amount: line.quantity.amount, unit: line.quantity.unit },
      note: line.note ?? null,
    })),
    steps: content.steps,
    allergens: tags.map((t) => ({
      allergen: t.allergen,
      status: t.status,
      approvedBy: t.approvedBy ? String(t.approvedBy) : null,
      approvedAt: t.approvedAt ? t.approvedAt.toISOString() : null,
    })),
    dietary: content.dietary,
    // Filtered, not defaulted: an asset deleted out from under the recipe drops
    // out of the list rather than rendering as a broken image on the line.
    photos: content.photoIds
      .map((id) => photos.get(String(id)))
      .filter((photo): photo is MediaAssetView => photo != null),
    times: content.times
      ? {
          prepMinutes: content.times.prepMinutes ?? null,
          cookMinutes: content.times.cookMinutes ?? null,
        }
      : null,
  };
}

/**
 * The content a summary is derived from: the active snapshot when the recipe is
 * published, else (chef view only) the working copy. Both the allergen verdict
 * and the hero photo come from the same place, so a list row never mixes what
 * staff can see with what only a chef can.
 */
type PhotoSource = Pick<IRecipeContent, 'photoIds'>;
type SummarySource = Pick<IRecipeContent, 'allergens' | 'photoIds'> | null;

/** First photo that still resolves — a deleted hero falls through to the next. */
function heroOf(source: SummarySource, photos: Map<string, MediaAssetView>): MediaAssetView | null {
  for (const id of source?.photoIds ?? []) {
    const photo = photos.get(String(id));
    if (photo) return photo;
  }
  return null;
}

function shapeSummary(
  head: LeanRecipe,
  source: SummarySource,
  photos: Map<string, MediaAssetView>
): RecipeSummary {
  return {
    _id: String(head._id),
    name: head.name,
    status: head.status,
    scope: shapeScope(head.scope),
    activeVersion: head.activeVersion ?? null,
    allergensVerified: tagsVerified(source?.allergens),
    isFork: Boolean(head.forkedFrom),
    // `!= null` covers pre-feature lean docs where the field is undefined.
    restricted: head.access != null,
    heroPhoto: heroOf(source, photos),
    createdAt: head.createdAt.toISOString(),
    modifiedAt: head.modifiedAt.toISOString(),
  };
}

function shapeVersionSummary(v: LeanVersion, activeVersionId: unknown): RecipeVersionSummary {
  return {
    _id: String(v._id),
    recipeId: String(v.recipeId),
    version: v.version,
    name: v.name,
    note: v.note ?? null,
    isActive: activeVersionId != null && String(v._id) === String(activeVersionId),
    createdBy: String(v.createdBy),
    createdAt: v.createdAt.toISOString(),
  };
}

/**
 * Batch-resolves the display names of every sub-recipe referenced by
 * `contents`. Deliberately unscoped and ungated by the person-level ACL: an
 * ingredient line is part of the *consuming* recipe, and rendering
 * "Demi-glace" there is an approved name-only disclosure (see AGENTS.md and
 * personAccess.ts) — the restricted recipe's content stays unreachable, and
 * clicking through to it 404s.
 */
async function subNamesFor(contents: Array<IRecipeContent | null | undefined>): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const content of contents) {
    if (!content) continue;
    for (const id of refIdsOf(content.ingredients)) ids.add(id);
  }
  if (ids.size === 0) return new Map();
  const refs = await Recipe.find({ _id: { $in: [...ids] } })
    .select('name')
    .lean();
  return new Map(refs.map((r) => [String(r._id), r.name]));
}

/** Batch-resolves every plating photo referenced by `contents`, keyed by id. */
async function photosFor(
  contents: Array<PhotoSource | null | undefined>
): Promise<Map<string, MediaAssetView>> {
  const ids = new Set<string>();
  for (const content of contents) {
    if (!content) continue;
    for (const id of content.photoIds) ids.add(String(id));
  }
  return resolveAssets([...ids]);
}

async function shapeDetail(ctx: TenantContext, head: LeanRecipe): Promise<RecipeDetail> {
  const reader = isReader(ctx);
  const manage = canManage(ctx, shapeScope(head.scope));
  const active = head.activeVersionId
    ? await RecipeVersion.findById(head.activeVersionId).lean()
    : null;

  const visible = [active?.content, reader ? null : head.workingCopy];
  // The publish mode rides along on the detail read so the editor offers the
  // shortcut on exactly the recipes the server would accept it for. Resolved in
  // parallel with the rest — it is three keyed lookups on a read that already
  // does several, and the alternative (the client resolving it from its own
  // scope) can disagree with the server about a recipe the chef did not move.
  const [subNames, photos, publishMode, accessUsers, forkSourceVisible] = await Promise.all([
    subNamesFor(visible),
    photosFor(visible),
    resolveRecipePublishModeForScope(head.scope),
    // The allow-list resolves for managers of the recipe only: who else is
    // trusted is itself managed information, not something a listed viewer
    // (let alone staff) is told.
    head.access && manage
      ? User.find({ _id: { $in: head.access.userIds } })
          .select('name email')
          .lean()
      : null,
    // A fork names its source only to callers who could read that source —
    // an unreadable origin is hidden like any other unreadable recipe.
    head.forkedFrom
      ? Recipe.exists({
          _id: head.forkedFrom.recipeId,
          ...scopeReadFilter(ctx),
          ...personAccessFilter(ctx),
        })
      : null,
  ]);
  const summarySource = active ? active.content : reader ? null : head.workingCopy;

  return {
    ...shapeSummary(head, summarySource, photos),
    forkedFrom:
      head.forkedFrom && forkSourceVisible
        ? {
            recipeId: String(head.forkedFrom.recipeId),
            versionId: String(head.forkedFrom.versionId),
            version: head.forkedFrom.version,
          }
        : null,
    createdBy: String(head.createdBy),
    currentVersion: head.currentVersion,
    activeVersionId: head.activeVersionId ? String(head.activeVersionId) : null,
    activeContent: active ? shapeContent(active.content, subNames, photos, reader) : null,
    workingCopy: reader ? null : shapeContent(head.workingCopy, subNames, photos, false),
    canManage: manage,
    access:
      head.access && accessUsers
        ? {
            userIds: head.access.userIds.map(String),
            users: accessUsers.map((user) => ({
              _id: String(user._id),
              name: { first: user.name.first, last: user.name.last },
              email: user.email,
            })),
          }
        : null,
    publishMode,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function listRecipes(
  ctx: TenantContext,
  query: ListRecipesQuery
): Promise<PaginatedResponse<RecipeSummary>> {
  const reader = isReader(ctx);

  const filter: Record<string, unknown> = {
    ...scopeReadFilter(ctx),
    // One filter drives the rows, the total AND the ?q= name regex, so a
    // person-restricted recipe neither lists, counts, nor answers name probes.
    ...personAccessFilter(ctx),
    // Readers never see archived lineages or unpublished work-in-progress.
    status: reader ? 'active' : query.status,
  };
  // Readers are always restricted to live lineages; any caller may narrow to
  // them explicitly (the reader browser does, so chefs browsing it never see
  // unpublished work either).
  if (reader || query.live) filter.activeVersionId = { $ne: null };
  if (query.q) filter.name = { $regex: escapeRegex(query.q), $options: 'i' };

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    Recipe.find(filter).sort({ name: 1 }).skip(skip).limit(query.limit).lean(),
    Recipe.countDocuments(filter),
  ]);

  // `allergensVerified` and `heroPhoto` both reflect what the caller would see:
  // the active snapshot when published, else (chef list only) the working copy.
  const activeIds = rows.map((r) => r.activeVersionId).filter(Boolean);
  const versions =
    activeIds.length > 0
      ? await RecipeVersion.find({ _id: { $in: activeIds } })
          .select('content.allergens content.photoIds')
          .lean()
      : [];
  const contentByVersion = new Map(versions.map((v) => [String(v._id), v.content]));

  const sources = rows.map((row) =>
    row.activeVersionId
      ? (contentByVersion.get(String(row.activeVersionId)) ?? null)
      : reader
        ? null
        : row.workingCopy
  );

  // One media round-trip for the whole page rather than one per row.
  const photos = await photosFor(sources);
  const items = rows.map((row, index) => shapeSummary(row, sources[index], photos));

  return { items, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
}

/**
 * The publish mode a recipe created *right now* would be governed by — the
 * caller's own write scope, which is where `createRecipe` puts a new lineage.
 *
 * Exists for the screens that offer the shortcut before a recipe exists (AI
 * draft review, above all). They could almost derive it from the tenant tree,
 * but "almost" is the problem: the answer must come from the same resolution
 * the publish call will run, or the UI can offer a shortcut the server refuses.
 */
export async function getScopePublishMode(ctx: TenantContext): Promise<RecipePublishModeView> {
  assertRole(ctx, 'chef');
  return { mode: await resolveRecipePublishModeForScope(scopeForWrite(ctx)) };
}

export async function getRecipe(ctx: TenantContext, id: string): Promise<RecipeDetail> {
  const head = await Recipe.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  }).lean();
  if (!head) throw new AppError('Not found', 404);
  // Unpublished or archived work is invisible to readers, not forbidden —
  // existence hiding, as everywhere else.
  if (isReader(ctx) && (head.status !== 'active' || !head.activeVersionId)) {
    throw new AppError('Not found', 404);
  }
  return shapeDetail(ctx, head);
}

// ── Working-copy writes ───────────────────────────────────────────────────────

export async function createRecipe(
  ctx: TenantContext,
  userId: string,
  input: CreateRecipeInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const scope = scopeForWrite(ctx, {
    propertyId: input.propertyId ?? undefined,
    locationId: input.locationId ?? undefined,
  });
  await assertScopeExists(scope);
  await validateSubRefs(ctx, scope, input.content.ingredients);
  await assertPhotosAttachable(ctx, scope, input.content.photoIds);

  // Born restricted, when asked. An empty list is legitimate — it means the
  // creator plus the standing bypass set (admin and up), nobody else.
  let access: IRecipe['access'] = null;
  if (input.access != null) {
    const userIds = dedupeAccessUserIds(input.access.userIds);
    await assertAccessListValid(scope, userIds);
    access = { userIds: userIds.map((uid) => new Types.ObjectId(uid)) };
  }

  const recipe = await Recipe.create({
    scope,
    name: input.name,
    status: 'active',
    workingCopy: buildContent(input.content, pendingTags(input.content.allergens)),
    currentVersion: 0,
    activeVersionId: null,
    activeVersion: null,
    forkedFrom: null,
    access,
    createdBy: userId,
  });

  // The read-back always succeeds for the caller — `createdBy` is a bypass
  // branch of the access filter, even when they left themselves off the list.
  return getRecipe(ctx, String(recipe._id));
}

/** Loads a head for mutation: scoped + person-ACL-gated (404), write-tier checked (403), not archived (409). */
async function loadForWrite(ctx: TenantContext, id: string, allowArchived = false): Promise<IRecipe> {
  const head = await Recipe.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  });
  if (!head) throw new AppError('Not found', 404);
  const scope = shapeScope(head.scope);
  assertCanWriteAt(ctx, { propertyId: scope.propertyId, locationId: scope.locationId });
  if (!allowArchived && head.status === 'archived') {
    throw new AppError('This recipe is archived. Unarchive it first.', 409);
  }
  return head;
}

export async function updateRecipe(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: UpdateRecipeInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  // A rename reaches staff immediately, without a new version, which is why
  // it counts as a source change for translations (see `sourceHashOf`). In an
  // automatic scope it therefore re-fires translation the same way going live
  // does — otherwise renaming a live dish would quietly strip its Spanish.
  const renamedWhileLive =
    input.name !== undefined && input.name !== head.name && head.activeVersionId != null;

  if (input.name !== undefined) head.name = input.name;

  if (input.content !== undefined) {
    const scope = shapeScope(head.scope);
    // Refs already on the working copy are grandfathered past the person-level
    // access check — restricting a sub-recipe must never brick resaves of the
    // recipes that were already using it.
    await validateSubRefs(
      ctx,
      scope,
      input.content.ingredients,
      new Set(refIdsOf(head.workingCopy.ingredients))
    );
    await assertNoCycle(ctx, id, input.content.ingredients);
    await assertPhotosAttachable(ctx, scope, input.content.photoIds);

    // Photos are not composition: swapping the hero shot is not a reason to
    // reset allergen sign-off, so `canonicalIngredients` deliberately ignores
    // them. Changing an ingredient still resets every tag.
    const ingredientsChanged =
      canonicalIngredients(head.workingCopy.ingredients) !==
      canonicalIngredients(input.content.ingredients);
    const tags = mergeAllergenTags(
      head.workingCopy.allergens,
      input.content.allergens,
      ingredientsChanged
    );
    head.workingCopy = buildContent(input.content, tags);
  }

  await head.save();
  const detail = await getRecipe(ctx, id);
  if (renamedWhileLive) await scheduleAutoTranslation(id, userId);
  return detail;
}

export async function approveAllergens(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: ApproveAllergensInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  const tags = head.workingCopy.allergens;
  if (input.allergens) {
    const present = new Set(tags.map((t) => t.allergen));
    const unknown = input.allergens.filter((a) => !present.has(a));
    if (unknown.length > 0) {
      throw new AppError(`Not tagged on this recipe: ${unknown.join(', ')}`, 400);
    }
  }
  const approving = new Set(input.allergens ?? tags.map((t) => t.allergen));

  const now = new Date();
  head.workingCopy.allergens = tags.map((t) =>
    approving.has(t.allergen) && t.status !== PUBLISHABLE_STATUS
      ? { allergen: t.allergen, status: PUBLISHABLE_STATUS, approvedBy: new Types.ObjectId(userId), approvedAt: now }
      : t
  );

  await head.save();
  return getRecipe(ctx, id);
}

// ── Person-level access ───────────────────────────────────────────────────────

/**
 * Replaces the allow-list wholesale (PUT semantics), or clears it with null.
 *
 * `loadForWrite` is the entire gate: the caller must currently *read* the
 * recipe (creator / listed / admin+, else 404), hold chef+ within its write
 * tier (403), and the lineage must not be archived (409). Because only current
 * readers may edit the list and creator + admin/owner always remain readers,
 * no edit can ever lock everyone out.
 */
export async function updateRecipeAccess(
  ctx: TenantContext,
  id: string,
  input: UpdateRecipeAccessInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  if (input.access != null) {
    const userIds = dedupeAccessUserIds(input.access.userIds);
    await assertAccessListValid(shapeScope(head.scope), userIds);
    head.access = { userIds: userIds.map((uid) => new Types.ObjectId(uid)) };
  } else {
    head.access = null;
  }

  await head.save();
  return getRecipe(ctx, id);
}

/**
 * The people the access picker may offer: every active member whose membership
 * can see this recipe's scope — by construction exactly the set
 * `assertAccessListValid` accepts. Not the tenancy roster endpoint, which is
 * manager-gated and exact-scope: it would miss org-wide members and, for a
 * property recipe, its locations' members, precisely the valid entries here.
 *
 * The cap bounds the response, far above any real staff roster; the UI
 * filters client-side.
 */
export async function listAccessCandidates(
  ctx: TenantContext,
  id: string
): Promise<AccessCandidate[]> {
  assertRole(ctx, 'chef');
  // Archived allowed: this read only supports the panel, it mutates nothing.
  const head = await loadForWrite(ctx, id, true);

  const rows = await Membership.find({
    orgId: head.scope.orgId,
    status: 'active',
    ...membershipReadersFilter(shapeScope(head.scope)),
  })
    .populate('userId', 'name email jobTitle')
    .limit(500)
    .lean();

  // One entry per person — a user may hold several rows (org-wide plus a
  // location, say) — and none for deleted accounts.
  const byUser = new Map<string, AccessCandidate>();
  for (const row of rows) {
    const user = row.userId as unknown as Pick<IUser, '_id' | 'name' | 'email' | 'jobTitle'> | null;
    if (!user) continue;
    byUser.set(String(user._id), {
      _id: String(user._id),
      name: { first: user.name.first, last: user.name.last },
      email: user.email,
      jobTitle: user.jobTitle ?? null,
    });
  }
  return [...byUser.values()].sort((a, b) =>
    `${a.name.last} ${a.name.first}`.localeCompare(`${b.name.last} ${b.name.first}`)
  );
}

// ── Versioning ────────────────────────────────────────────────────────────────

export async function saveVersion(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: SaveVersionInput
): Promise<RecipeVersionSummary> {
  assertRole(ctx, 'chef');
  await loadForWrite(ctx, id);

  // Reserve the next number atomically; two racing saves cannot both win the
  // same one — the unique {recipeId, version} index turns the loser's insert
  // into the errorHandler's 409. A failed create leaves a numbering gap, which
  // is harmless: numbers order history, they don't count it.
  const head = await Recipe.findOneAndUpdate(
    { _id: id, ...scopeReadFilter(ctx), ...personAccessFilter(ctx) },
    { $inc: { currentVersion: 1 } },
    { new: true }
  ).lean();
  if (!head) throw new AppError('Not found', 404);

  const version = await RecipeVersion.create({
    recipeId: head._id,
    version: head.currentVersion,
    name: head.name,
    content: head.workingCopy,
    note: input.note,
    scope: head.scope,
    createdBy: userId,
  });

  return shapeVersionSummary(version.toObject(), head.activeVersionId);
}

/**
 * The one-step publish for a recipe nobody has ever cooked from: mint v1 and
 * put it in front of staff, in the order a chef would do it by hand.
 *
 * Three guards, and each earns its place:
 *
 * - **The scope's `recipePublishMode` must allow it.** Resolved from the
 *   *recipe's* scope, so a shared property book behaves the same way for every
 *   chef who writes into it.
 * - **The lineage must never have been live.** Once staff are cooking from a
 *   version, changing what they read stays two deliberate acts — save a
 *   version, then set it live. A shortcut past that is a different feature with
 *   a different risk, and this is not it.
 * - **`publish_on_save_verified` requires the sign-off tick.** Not
 *   `tagsVerified`: a dish with no allergens at all can never satisfy that (an
 *   empty tag list is not a claim of safety — AGENTS.md §10 rule 2), and a mode
 *   nobody can satisfy is a mode nobody turns on. What the tick means is that a
 *   human affirmed the allergen picture, which is exactly what this mode is
 *   for. An untagged dish still reads *Unverified* to staff afterwards.
 *
 * Sign-off runs before the snapshot so the approval stamps land *inside* v1
 * rather than one version behind it. Not a transaction — nothing in this API is
 * — so a failure between minting and activating leaves a saved, unpublished v1:
 * visibly short of the goal, and safe, which is the right way for this to fail.
 */
export async function publishRecipe(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: PublishRecipeInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  const mode = await resolveRecipePublishModeForScope(head.scope);
  if (mode === 'manual') {
    throw new AppError('Publishing on save is turned off for this recipe’s scope', 409);
  }
  if (head.activeVersionId) {
    throw new AppError(
      'This recipe is already live. Save a version and set it live to change what staff read.',
      409
    );
  }
  if (mode === 'publish_on_save_verified' && !input.approveAllergens) {
    throw new AppError(
      'This scope requires allergen sign-off before a recipe goes live. Verify the allergen tags, then publish.',
      409
    );
  }

  if (input.approveAllergens) {
    await approveAllergens(ctx, userId, id, {});
  }

  const version = await saveVersion(ctx, userId, id, input.note ? { note: input.note } : {});
  return activateVersion(ctx, userId, id, version._id);
}

export async function listVersions(ctx: TenantContext, id: string): Promise<RecipeVersionSummary[]> {
  assertRole(ctx, 'chef');
  const head = await Recipe.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  })
    .select('activeVersionId')
    .lean();
  if (!head) throw new AppError('Not found', 404);

  const versions = await RecipeVersion.find({ recipeId: id, ...scopeReadFilter(ctx) })
    .sort({ version: -1 })
    .lean();
  return versions.map((v) => shapeVersionSummary(v, head.activeVersionId));
}

export async function getVersion(
  ctx: TenantContext,
  id: string,
  versionId: string
): Promise<RecipeVersionDetail> {
  assertRole(ctx, 'chef');
  const head = await Recipe.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  })
    .select('activeVersionId')
    .lean();
  if (!head) throw new AppError('Not found', 404);

  const version = await RecipeVersion.findOne({
    _id: versionId,
    recipeId: id,
    ...scopeReadFilter(ctx),
  }).lean();
  if (!version) throw new AppError('Not found', 404);

  const [subNames, photos] = await Promise.all([
    subNamesFor([version.content]),
    photosFor([version.content]),
  ]);
  return {
    ...shapeVersionSummary(version, head.activeVersionId),
    content: shapeContent(version.content, subNames, photos, false),
  };
}

export async function activateVersion(
  ctx: TenantContext,
  userId: string,
  id: string,
  versionId: string
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  const version = await RecipeVersion.findOne({ _id: versionId, recipeId: id })
    .select('version')
    .lean();
  if (!version) throw new AppError('Not found', 404);

  head.activeVersionId = version._id as Types.ObjectId;
  head.activeVersion = version.version;
  await head.save();

  // SAFETY: a different version going live is the recipes-world "source edit"
  // — approved translations of the old version fall back to pending_review so
  // the Spanish can never silently describe a recipe staff no longer read.
  // Re-activating the same version leaves its approval standing.
  await invalidateForActiveVersion(id, version._id as Types.ObjectId);

  const detail = await getRecipe(ctx, id);
  await scheduleAutoTranslation(id, userId);
  return detail;
}

/** The recall lever: staff visibility drops the moment this commits. */
export async function deactivateRecipe(ctx: TenantContext, id: string): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id, true);
  head.activeVersionId = null;
  head.activeVersion = null;
  await head.save();
  return getRecipe(ctx, id);
}

export async function restoreVersion(
  ctx: TenantContext,
  id: string,
  versionId: string
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  const version = await RecipeVersion.findOne({ _id: versionId, recipeId: id }).lean();
  if (!version) throw new AppError('Not found', 404);

  // The reference graph may have changed since this snapshot was taken: a
  // recipe it references may now reference us back, or have been archived.
  // Every ref is access-exempt — it comes from this lineage's own history,
  // not from the restorer's browsing.
  await validateSubRefs(
    ctx,
    shapeScope(head.scope),
    version.content.ingredients,
    new Set(refIdsOf(version.content.ingredients))
  );
  await assertNoCycle(ctx, id, version.content.ingredients);

  // Verbatim, approval stamps included: the sign-off was made against exactly
  // this content, and restoring it does not make that less true. Restoring
  // only touches the working copy — the chef still saves a version explicitly.
  head.workingCopy = version.content;
  await head.save();
  return getRecipe(ctx, id);
}

// ── Forking ───────────────────────────────────────────────────────────────────

/**
 * Copies a snapshot of this lineage into a brand-new lineage at a target
 * scope — a location adapting a property's standard. The fork remembers its
 * origin but shares nothing else: versions start over at zero.
 */
export async function forkRecipe(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: ForkRecipeInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'chef');

  // The one read path outside loadForWrite: gate it the same way, or a fork
  // becomes the copy-everything bypass of the person-level ACL.
  const source = await Recipe.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  }).lean();
  if (!source) throw new AppError('Not found', 404);

  let version: LeanVersion | null = null;
  if (input.versionId) {
    version = await RecipeVersion.findOne({
      _id: input.versionId,
      recipeId: id,
      ...scopeReadFilter(ctx),
    }).lean();
    if (!version) throw new AppError('Not found', 404);
  } else if (source.activeVersionId) {
    version = await RecipeVersion.findById(source.activeVersionId).lean();
  }
  if (!version) {
    throw new AppError('This recipe has no active version. Name a version to fork.', 409);
  }

  const targetScope = scopeForWrite(ctx, {
    propertyId: input.propertyId ?? undefined,
    locationId: input.locationId ?? undefined,
  });
  await assertScopeExists(targetScope);
  // An upward or sideways-tier fork can orphan sub-recipe references that were
  // fine at the source's scope — re-validate against where the fork will live.
  await validateSubRefs(ctx, targetScope, version.content.ingredients);
  // Plating photos travel with the fork (unlike allergen sign-off below), so
  // they face the same scope test: a location's photo cannot follow a recipe up
  // to property level, where its siblings could not load it.
  await assertPhotosAttachable(ctx, targetScope, version.content.photoIds.map(String));

  // SAFETY: allergen approvals do not travel across lineages. The original
  // sign-off happened in another kitchen's context, a fork exists to diverge,
  // and the approver's name must not carry liability onto a document they will
  // never see again. Re-approval is one action for the receiving chef.
  const workingCopy: IRecipeContent = {
    ...version.content,
    allergens: pendingTags(version.content.allergens.map((t) => t.allergen)),
  };

  const fork = await Recipe.create({
    scope: targetScope,
    name: input.name ?? source.name,
    status: 'active',
    workingCopy,
    currentVersion: 0,
    activeVersionId: null,
    activeVersion: null,
    forkedFrom: {
      recipeId: source._id as Types.ObjectId,
      versionId: version._id as Types.ObjectId,
      version: version.version,
    },
    createdBy: userId,
  });

  return getRecipe(ctx, String(fork._id));
}

// ── Placement ─────────────────────────────────────────────────────────────────

/**
 * Every ACTIVE recipe that consumes `head` (working copy or live snapshot)
 * must still find it at-or-above their own scope after a move — the same
 * queries as the archive guard below, comparing scopes instead of refusing
 * outright. Only narrowing or sideways moves can break a consumer; a move
 * straight up covers everyone and skips the queries entirely.
 */
async function assertConsumersStillCovered(head: IRecipe, newScope: TenantScope): Promise<void> {
  if (!newScope.propertyId) return;

  const uncovered = (scope: IScope): boolean => {
    const propertyId = scope.propertyId ? String(scope.propertyId) : null;
    const locationId = scope.locationId ? String(scope.locationId) : null;
    if (propertyId !== newScope.propertyId) return true;
    return newScope.locationId != null && locationId !== newScope.locationId;
  };

  const consumers: Array<{ scope: IScope }> = await Recipe.find({
    'scope.orgId': head.scope.orgId,
    status: 'active',
    _id: { $ne: head._id },
    'workingCopy.ingredients.recipeId': head._id,
  })
    .select('scope')
    .lean();

  const referencingVersions = await RecipeVersion.find({
    'scope.orgId': head.scope.orgId,
    'content.ingredients.recipeId': head._id,
  })
    .select('_id')
    .lean();
  if (referencingVersions.length > 0) {
    consumers.push(
      ...(await Recipe.find({
        status: 'active',
        _id: { $ne: head._id },
        activeVersionId: { $in: referencingVersions.map((v) => v._id) },
      })
        .select('scope')
        .lean())
    );
  }

  const blocked = consumers.filter((consumer) => uncovered(consumer.scope)).length;
  if (blocked > 0) {
    // Names deliberately withheld — a consumer may be person-restricted, and
    // this mirrors the archive guard's name-free 409.
    throw new AppError(
      `${blocked} active ${blocked === 1 ? 'recipe uses' : 'recipes use'} this as a sub-recipe and would no longer see it. Move or update those first.`,
      409
    );
  }
}

/**
 * Moves a lineage to a new home in the tree — the one sanctioned mutation of
 * `scope`. Every denormalised copy moves in the same act (versions,
 * translations), which is what keeps the version model's "scope never
 * mutates" shortcut sound. Order matters for crash recovery: copies first,
 * head last — every read is gated by the head, so a half-applied move leaves
 * the OLD home governing everything and re-running the move completes it.
 *
 * Manager-gated: placement decides which kitchens see a recipe, which is an
 * org-structure decision, not a content edit. The caller must hold write tier
 * at both the current home (via loadForWrite) and the new one.
 */
export async function moveRecipe(
  ctx: TenantContext,
  id: string,
  input: MoveRecipeInput
): Promise<RecipeDetail> {
  assertRole(ctx, 'manager');
  const head = await loadForWrite(ctx, id, true);

  const newScope: TenantScope = {
    orgId: ctx.orgId,
    propertyId: input.propertyId ?? null,
    locationId: input.locationId ?? null,
  };
  if (newScope.locationId && !newScope.propertyId) {
    throw new AppError('A location-scoped recipe must also name its property', 400);
  }
  assertCanWriteAt(ctx, newScope);
  await assertScopeExists(newScope);

  const oldScope = shapeScope(head.scope);
  if (
    oldScope.propertyId === newScope.propertyId &&
    oldScope.locationId === newScope.locationId
  ) {
    return getRecipe(ctx, id);
  }

  const active = head.activeVersionId
    ? await RecipeVersion.findById(head.activeVersionId).lean()
    : null;
  const contents = [head.workingCopy, active?.content].filter(
    (content): content is IRecipeContent => content != null
  );

  // Everything this recipe consumes must sit at-or-above its NEW home. The
  // refs are all pre-existing, so they stay exempt from the person-level
  // access check — this is a scope re-validation, not a new attachment.
  for (const content of contents) {
    await validateSubRefs(ctx, newScope, content.ingredients, new Set(refIdsOf(content.ingredients)));
  }
  // …and everything that consumes IT must still see it.
  await assertConsumersStillCovered(head, newScope);

  // The allow-list must still make sense where the recipe is going.
  if (head.access) {
    await assertAccessListValid(newScope, head.access.userIds.map(String));
  }

  // Plating photos ride along — widen any that would no longer cover the new
  // audience (never narrows; see widenAssetsToCover).
  await widenAssetsToCover(
    newScope,
    contents.flatMap((content) => content.photoIds.map(String))
  );

  const scopeDoc = {
    orgId: head.scope.orgId,
    propertyId: newScope.propertyId ? new Types.ObjectId(newScope.propertyId) : null,
    locationId: newScope.locationId ? new Types.ObjectId(newScope.locationId) : null,
  };
  // Copies first, head last — see the docblock.
  await RecipeVersion.updateMany({ recipeId: head._id }, { $set: { scope: scopeDoc } });
  await RecipeTranslation.updateMany({ recipeId: head._id }, { $set: { scope: scopeDoc } });
  head.scope = scopeDoc as IScope;
  await head.save();

  return getRecipe(ctx, id);
}

// ── Archival ──────────────────────────────────────────────────────────────────

export async function archiveRecipe(ctx: TenantContext, id: string): Promise<void> {
  assertRole(ctx, 'manager');
  const head = await loadForWrite(ctx, id, true);

  // A recipe that other recipes consume cannot be archived out from under
  // them. Check working copies and active snapshots org-wide, and deliberately
  // NOT through the person-level access filter: a restricted consumer still
  // depends on this recipe, and archiving beneath it would corrupt it. The
  // 409 below may thereby reveal that *some* consumer the caller cannot see
  // exists — accepted; it names nothing.
  const usedByWorkingCopy = await Recipe.exists({
    'scope.orgId': head.scope.orgId,
    status: 'active',
    _id: { $ne: head._id },
    'workingCopy.ingredients.recipeId': head._id,
  });
  if (usedByWorkingCopy) {
    throw new AppError('This recipe is in use as a sub-recipe and cannot be archived', 409);
  }

  const referencingVersions = await RecipeVersion.find({
    'scope.orgId': head.scope.orgId,
    'content.ingredients.recipeId': head._id,
  })
    .select('_id')
    .lean();
  if (referencingVersions.length > 0) {
    const usedByActiveVersion = await Recipe.exists({
      status: 'active',
      _id: { $ne: head._id },
      activeVersionId: { $in: referencingVersions.map((v) => v._id) },
    });
    if (usedByActiveVersion) {
      throw new AppError('This recipe is in use as a sub-recipe and cannot be archived', 409);
    }
  }

  head.status = 'archived';
  await head.save();
}

export async function unarchiveRecipe(ctx: TenantContext, id: string): Promise<RecipeDetail> {
  assertRole(ctx, 'manager');
  const head = await loadForWrite(ctx, id, true);
  head.status = 'active';
  await head.save();
  return getRecipe(ctx, id);
}
