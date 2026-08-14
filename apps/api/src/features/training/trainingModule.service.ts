import { parseVideoEmbed, plainTextToDoc, roleAtLeast } from '@rit/shared';
import type {
  AccessCandidate,
  CreateTrainingInput,
  ListTrainingsQuery,
  MediaAssetView,
  MoveTrainingInput,
  PaginatedResponse,
  RichTextDoc,
  TenantContext,
  TenantScope,
  TrainingBlockInput,
  TrainingBlockView,
  TrainingCompletionRow,
  TrainingCompletionState,
  TrainingDetail,
  TrainingSummary,
  UpdateTrainingAccessInput,
  UpdateTrainingInput,
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
import {
  assertAccessListValid,
  dedupeAccessUserIds,
  personAccessFilter,
} from '../tenancy/personAccess';
import { assertAssetsAttachable, resolveAssets, widenAssetsToCover } from '../media/media.service';
import {
  autoTranslateTrainingOnPublish,
  beginAutoTrainingTranslation,
  trainingSourceHashOf,
  trainingTranslatableProjection,
} from '../translations/trainingTranslation.service';
import { TrainingTranslation } from '../translations/trainingTranslation.model';
import { User, SAFE_USER_FIELDS } from '../auth/auth.model';
import { Property } from '../tenancy/property.model';
import { Location } from '../tenancy/location.model';
import { Membership } from '../tenancy/membership.model';
import { TrainingModule } from './trainingModule.model';
import { TrainingCompletion } from './trainingCompletion.model';
import type {
  IScope,
  ITrainingBlock,
  ITrainingCompletion,
  ITrainingModule,
  IUser,
  UserName,
} from '../../types/index';

/**
 * Training modules: ordered content blocks (rich text, images, streamed video,
 * external embeds) behind a publish gate, plus per-user-per-location completion
 * records. Chefs author and publish; staff read published modules and mark them
 * complete. No version history — editing is in place, which keeps the feature
 * a fraction of the recipe service's weight.
 */

type LeanTraining = Omit<ITrainingModule, keyof Document> & { _id: unknown };
type LeanCompletion = Omit<ITrainingCompletion, keyof Document> & { _id: unknown };

// ── Small helpers ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget automatic translation, mirroring recipe publication: the
 * claim (`begin…`) is awaited so the module page can't offer a duplicate
 * "Translate" button, while the LLM work itself stays detached — publishing
 * the English must never wait on, or roll back for, the Spanish.
 */
async function scheduleAutoTranslation(trainingId: string, userId: string): Promise<void> {
  const willRun = await beginAutoTrainingTranslation(trainingId);
  if (!willRun) return;

  void autoTranslateTrainingOnPublish(trainingId, userId).catch((err) => {
    console.error('Automatic training translation could not be scheduled', err);
  });
}

/** Readers (below chef) see published modules only. */
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

/** Role + write-tier check: may `ctx` mutate a module living at `scope`? */
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

/**
 * Which completion records `ctx` may read. Completions store flat tenant ids
 * (they are facts about people, not scoped content), so this mirrors
 * `scopeReadFilter`'s downward-visibility rule by hand: a location chef sees
 * their own location's completions plus those recorded without a location.
 */
function completionReadFilter(ctx: TenantContext): Record<string, unknown> {
  const filter: Record<string, unknown> = { orgId: ctx.orgId };
  if (!ctx.propertyId) return filter;
  filter.propertyId = { $in: [null, ctx.propertyId] };
  if (!ctx.locationId) return filter;
  filter.locationId = { $in: [null, ctx.locationId] };
  return filter;
}

/**
 * A write target's property/location must actually exist in this org —
 * `scopeForWrite` checks tier containment, not existence. Same guard as
 * recipes: a scope pointing at a foreign or deleted property is a document
 * nobody can ever read.
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

// ── Blocks ────────────────────────────────────────────────────────────────────

function mediaIdsOf(blocks: ITrainingBlock[], kind: 'image' | 'video'): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.kind === kind && block.mediaId) ids.push(String(block.mediaId));
  }
  return ids;
}

/**
 * Validates every media reference in `blocks` against `targetScope`: image
 * blocks must point at readable photos, video blocks at readable videos, and
 * every asset must sit at-or-above the module's scope so no part of its
 * audience gets a broken player. Embed URLs were allow-list validated by Zod.
 */
async function assertBlockMediaAttachable(
  ctx: TenantContext,
  targetScope: TenantScope,
  blocks: ITrainingBlock[]
): Promise<void> {
  await assertAssetsAttachable(ctx, targetScope, mediaIdsOf(blocks, 'image'), 'photo');
  await assertAssetsAttachable(ctx, targetScope, mediaIdsOf(blocks, 'video'), 'video');
}

/** Builds stored blocks from validated client input. */
function buildBlocks(input: TrainingBlockInput[]): ITrainingBlock[] {
  return input.map((block) => {
    switch (block.kind) {
      case 'text':
        // `doc` is the sanitised copy richTextDocSchema parsed — unknown
        // nodes, marks and attributes are already gone.
        return { kind: 'text' as const, doc: block.doc, mediaId: null };
      case 'image':
      case 'video':
        return {
          kind: block.kind,
          mediaId: new Types.ObjectId(block.mediaId),
          caption: block.caption,
        };
      case 'embed':
        return { kind: 'embed' as const, url: block.url, caption: block.caption, mediaId: null };
    }
  });
}

/**
 * The rich-text document of a stored text block. Blocks written before the
 * rich-text editor stored plain text in `body`; they surface as plain
 * paragraphs — content is preserved, formatting starts fresh.
 */
function textDocOf(block: ITrainingBlock): RichTextDoc {
  if (block.doc) return block.doc;
  return plainTextToDoc(block.body ?? '');
}

/** Every media id referenced by `blocks`, for one batched asset resolve. */
async function blockMediaFor(blocks: ITrainingBlock[]): Promise<Map<string, MediaAssetView>> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.mediaId) ids.add(String(block.mediaId));
  }
  return resolveAssets([...ids]);
}

/**
 * Renders stored blocks for clients. Media blocks resolve their asset (null
 * when it was deleted out from under the module — viewers skip those). Embed
 * blocks re-derive provider and iframe src on the way out, so the embed src
 * a client renders is always the server's construction, never stored text.
 */
function shapeBlocks(
  blocks: ITrainingBlock[],
  media: Map<string, MediaAssetView>
): TrainingBlockView[] {
  const views: TrainingBlockView[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        views.push({ kind: 'text', doc: textDocOf(block) });
        break;
      case 'image':
      case 'video':
        views.push({
          kind: block.kind,
          media: block.mediaId ? (media.get(String(block.mediaId)) ?? null) : null,
          caption: block.caption ?? null,
        });
        break;
      case 'embed': {
        const embed = block.url ? parseVideoEmbed(block.url) : null;
        // A stored URL that no longer parses would mean the allow-list
        // narrowed since it was written; drop the block rather than iframe it.
        if (embed) {
          views.push({
            kind: 'embed',
            url: block.url!,
            provider: embed.provider,
            embedSrc: embed.embedSrc,
            caption: block.caption ?? null,
          });
        }
        break;
      }
    }
  }
  return views;
}

// ── Shaping ───────────────────────────────────────────────────────────────────

/** First image block that still resolves — the card art. */
function heroOf(blocks: ITrainingBlock[], media: Map<string, MediaAssetView>): MediaAssetView | null {
  for (const block of blocks) {
    if (block.kind !== 'image' || !block.mediaId) continue;
    const asset = media.get(String(block.mediaId));
    if (asset) return asset;
  }
  return null;
}

function shapeSummary(
  head: LeanTraining,
  media: Map<string, MediaAssetView>,
  myCompletionAt: Date | null
): TrainingSummary {
  return {
    _id: String(head._id),
    title: head.title,
    description: head.description,
    status: head.status,
    scope: shapeScope(head.scope),
    heroImage: heroOf(head.blocks, media),
    blockCount: head.blocks.length,
    videoCount: head.blocks.filter((b) => b.kind === 'video' || b.kind === 'embed').length,
    myCompletion: myCompletionAt ? myCompletionAt.toISOString() : null,
    restricted: head.access != null,
    publishedAt: head.publishedAt ? head.publishedAt.toISOString() : null,
    createdAt: head.createdAt.toISOString(),
    modifiedAt: head.modifiedAt.toISOString(),
  };
}

async function shapeDetail(
  ctx: TenantContext,
  userId: string,
  head: LeanTraining
): Promise<TrainingDetail> {
  const headId = String(head._id);
  const manage = canManage(ctx, shapeScope(head.scope));
  const [media, myCompletion, completedCount, accessUsers] = await Promise.all([
    blockMediaFor(head.blocks),
    TrainingCompletion.findOne({ orgId: ctx.orgId, trainingId: headId, userId })
      .sort({ completedAt: -1 })
      .lean(),
    manage
      ? TrainingCompletion.countDocuments({ ...completionReadFilter(ctx), trainingId: headId })
      : Promise.resolve(null),
    // The allow-list resolves for managers of the module only: who else is
    // trusted is itself managed information, not something a listed viewer
    // (let alone staff) is told.
    head.access && manage
      ? User.find({ _id: { $in: head.access.userIds } })
          .select('name email')
          .lean()
      : null,
  ]);

  return {
    ...shapeSummary(head, media, myCompletion?.completedAt ?? null),
    blocks: shapeBlocks(head.blocks, media),
    createdBy: String(head.createdBy),
    canManage: manage,
    completedCount,
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
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function listTrainings(
  ctx: TenantContext,
  userId: string,
  query: ListTrainingsQuery
): Promise<PaginatedResponse<TrainingSummary>> {
  const filter: Record<string, unknown> = {
    ...scopeReadFilter(ctx),
    // One filter drives the rows, the total AND the ?q= title regex, so a
    // person-restricted module neither lists, counts, nor answers title probes.
    ...personAccessFilter(ctx),
    // Readers never see drafts or archived modules, whatever they ask for.
    status: isReader(ctx) ? 'published' : query.status,
  };
  if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: 'i' };

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    TrainingModule.find(filter).sort({ title: 1 }).skip(skip).limit(query.limit).lean(),
    TrainingModule.countDocuments(filter),
  ]);

  // One media round-trip for the page's hero images, one for completion state.
  const [media, completions] = await Promise.all([
    blockMediaFor(rows.flatMap((row) => row.blocks.filter((b) => b.kind === 'image'))),
    rows.length > 0
      ? TrainingCompletion.find({
          orgId: ctx.orgId,
          userId,
          trainingId: { $in: rows.map((r) => r._id) },
        }).lean()
      : Promise.resolve([] as LeanCompletion[]),
  ]);

  const completedAt = new Map<string, Date>();
  for (const completion of completions) {
    const key = String(completion.trainingId);
    const prior = completedAt.get(key);
    if (!prior || completion.completedAt > prior) completedAt.set(key, completion.completedAt);
  }

  const items = rows.map((row) =>
    shapeSummary(row, media, completedAt.get(String(row._id)) ?? null)
  );
  return { items, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
}

export async function getTraining(
  ctx: TenantContext,
  userId: string,
  id: string
): Promise<TrainingDetail> {
  const head = await TrainingModule.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  }).lean();
  if (!head) throw new AppError('Not found', 404);
  // Unpublished work is invisible to readers, not forbidden — existence
  // hiding, as everywhere else.
  if (isReader(ctx) && head.status !== 'published') throw new AppError('Not found', 404);
  return shapeDetail(ctx, userId, head);
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createTraining(
  ctx: TenantContext,
  userId: string,
  input: CreateTrainingInput
): Promise<TrainingDetail> {
  assertRole(ctx, 'chef');
  const scope = scopeForWrite(ctx, {
    propertyId: input.propertyId ?? undefined,
    locationId: input.locationId ?? undefined,
  });
  await assertScopeExists(scope);
  const blocks = buildBlocks(input.blocks);
  await assertBlockMediaAttachable(ctx, scope, blocks);

  // Born restricted, when asked. An empty list is legitimate — it means the
  // creator plus the standing bypass set (admin and up), nobody else.
  let access: ITrainingModule['access'] = null;
  if (input.access != null) {
    const userIds = dedupeAccessUserIds(input.access.userIds);
    await assertAccessListValid(scope, userIds);
    access = { userIds: userIds.map((uid) => new Types.ObjectId(uid)) };
  }

  const training = await TrainingModule.create({
    scope,
    title: input.title,
    description: input.description,
    status: 'draft',
    blocks,
    publishedAt: null,
    access,
    createdBy: userId,
  });

  // The read-back always succeeds for the caller — `createdBy` is a bypass
  // branch of the access filter, even when they left themselves off the list.
  return getTraining(ctx, userId, String(training._id));
}

/** Loads a module for mutation: scoped + person-ACL-gated (404), write-tier checked (403), not archived (409). */
async function loadForWrite(
  ctx: TenantContext,
  id: string,
  allowArchived = false
): Promise<ITrainingModule> {
  const head = await TrainingModule.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  });
  if (!head) throw new AppError('Not found', 404);
  const scope = shapeScope(head.scope);
  assertCanWriteAt(ctx, { propertyId: scope.propertyId, locationId: scope.locationId });
  if (!allowArchived && head.status === 'archived') {
    throw new AppError('This training is archived. Unarchive it first.', 409);
  }
  return head;
}

export async function updateTraining(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: UpdateTrainingInput
): Promise<TrainingDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  // Modules are edited in place, so an edit to a published module reaches
  // staff immediately — which makes it a source change for translations, the
  // same way a live recipe's rename is. In an automatic scope it re-fires
  // translation; otherwise editing a live module would quietly strip its
  // Spanish (the stale-hash check hides it the moment the text differs).
  const beforeHash = trainingSourceHashOf(trainingTranslatableProjection(head));

  if (input.title !== undefined) head.title = input.title;
  if (input.description !== undefined) head.description = input.description;
  if (input.blocks !== undefined) {
    const blocks = buildBlocks(input.blocks);
    await assertBlockMediaAttachable(ctx, shapeScope(head.scope), blocks);
    head.blocks = blocks;
  }

  const editedWhileLive =
    head.status === 'published' &&
    trainingSourceHashOf(trainingTranslatableProjection(head)) !== beforeHash;

  await head.save();
  const detail = await getTraining(ctx, userId, id);
  if (editedWhileLive) await scheduleAutoTranslation(id, userId);
  return detail;
}

// ── Placement ─────────────────────────────────────────────────────────────────

/**
 * Moves a module to a new home in the tenant tree. Far simpler than a recipe
 * move — no version history to rewrite and no cross-module reference graph to
 * re-validate — so this is: write-tier at both homes, allow-list still valid
 * where it is going, block media widened to cover the new audience, one save.
 */
export async function moveTraining(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: MoveTrainingInput
): Promise<TrainingDetail> {
  assertRole(ctx, 'manager');
  const head = await loadForWrite(ctx, id, true);

  const newScope: TenantScope = {
    orgId: ctx.orgId,
    propertyId: input.propertyId ?? null,
    locationId: input.locationId ?? null,
  };
  if (newScope.locationId && !newScope.propertyId) {
    throw new AppError('A location-scoped training must also name its property', 400);
  }
  assertCanWriteAt(ctx, newScope);
  await assertScopeExists(newScope);

  const oldScope = shapeScope(head.scope);
  if (
    oldScope.propertyId === newScope.propertyId &&
    oldScope.locationId === newScope.locationId
  ) {
    return getTraining(ctx, userId, id);
  }

  // The allow-list must still make sense where the module is going.
  if (head.access) {
    await assertAccessListValid(newScope, head.access.userIds.map(String));
  }

  // Block media rides along — widen any asset that would no longer cover the
  // new audience (never narrows; see widenAssetsToCover).
  await widenAssetsToCover(
    newScope,
    head.blocks.filter((block) => block.mediaId).map((block) => String(block.mediaId))
  );

  const scopeDoc = {
    orgId: head.scope.orgId,
    propertyId: newScope.propertyId ? new Types.ObjectId(newScope.propertyId) : null,
    locationId: newScope.locationId ? new Types.ObjectId(newScope.locationId) : null,
  };
  // Copies first, head last — a crashed half-move leaves the translations
  // governed by the old home, and a retry is idempotent.
  await TrainingTranslation.updateMany({ trainingId: head._id }, { $set: { scope: scopeDoc } });
  head.scope = scopeDoc as IScope;
  await head.save();

  return getTraining(ctx, userId, id);
}

// ── Person-level access ───────────────────────────────────────────────────────

/**
 * Replaces the allow-list wholesale (PUT semantics), or clears it with null.
 *
 * `loadForWrite` is the entire gate: the caller must currently *read* the
 * module (creator / listed / admin+, else 404), hold chef+ within its write
 * tier (403), and the module must not be archived (409). Because only current
 * readers may edit the list and creator + admin/owner always remain readers,
 * no edit can ever lock everyone out.
 */
export async function updateTrainingAccess(
  ctx: TenantContext,
  userId: string,
  id: string,
  input: UpdateTrainingAccessInput
): Promise<TrainingDetail> {
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
  return getTraining(ctx, userId, id);
}

/**
 * The people the access picker may offer: every active member whose membership
 * can see this module's scope — by construction exactly the set
 * `assertAccessListValid` accepts. Same rationale as recipes: the tenancy
 * roster endpoint is manager-gated and exact-scope, which would miss org-wide
 * members and, for a property module, its locations' members.
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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** The publish gate: the moment this commits, staff can see the module. */
export async function publishTraining(
  ctx: TenantContext,
  userId: string,
  id: string
): Promise<TrainingDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);

  if (head.blocks.length === 0) {
    throw new AppError('Add at least one content block before publishing', 409);
  }

  head.status = 'published';
  head.publishedAt = new Date();
  await head.save();
  const detail = await getTraining(ctx, userId, id);
  await scheduleAutoTranslation(id, userId);
  return detail;
}

/** The recall lever: staff visibility drops the moment this commits. */
export async function unpublishTraining(
  ctx: TenantContext,
  userId: string,
  id: string
): Promise<TrainingDetail> {
  assertRole(ctx, 'chef');
  const head = await loadForWrite(ctx, id);
  head.status = 'draft';
  head.publishedAt = null;
  await head.save();
  return getTraining(ctx, userId, id);
}

export async function archiveTraining(ctx: TenantContext, id: string): Promise<void> {
  assertRole(ctx, 'manager');
  const head = await loadForWrite(ctx, id, true);
  head.status = 'archived';
  head.publishedAt = null;
  await head.save();
}

/**
 * Unarchiving lands on `draft`, never straight back to `published` — the
 * content sat unmaintained while archived, so re-publishing is a deliberate
 * review step. Completion records survive archival untouched.
 */
export async function unarchiveTraining(
  ctx: TenantContext,
  userId: string,
  id: string
): Promise<TrainingDetail> {
  assertRole(ctx, 'manager');
  const head = await loadForWrite(ctx, id, true);
  head.status = 'draft';
  await head.save();
  return getTraining(ctx, userId, id);
}

// ── Completion ────────────────────────────────────────────────────────────────

/**
 * Marks the module complete for the caller in their current location context.
 * Any member may complete — staff are the whole audience. Idempotent: the
 * upsert races safely against the unique index, and a second tap simply
 * returns the existing record.
 */
export async function completeTraining(
  ctx: TenantContext,
  userId: string,
  id: string
): Promise<TrainingCompletionState> {
  const head = await TrainingModule.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  })
    .select('status')
    .lean();
  if (!head) throw new AppError('Not found', 404);
  if (head.status !== 'published') {
    // Readers cannot know an unpublished module exists; managers get the truth.
    if (isReader(ctx)) throw new AppError('Not found', 404);
    throw new AppError('Only published trainings can be completed', 409);
  }

  const completion = await TrainingCompletion.findOneAndUpdate(
    { trainingId: id, userId, locationId: ctx.locationId ?? null },
    {
      $setOnInsert: {
        orgId: ctx.orgId,
        propertyId: ctx.propertyId ?? null,
        completedAt: new Date(),
      },
    },
    { new: true, upsert: true }
  ).lean();

  return { completed: true, completedAt: completion!.completedAt.toISOString() };
}

/** Removes the caller's completion(s) for this module — the accidental-tap undo. */
export async function uncompleteTraining(
  ctx: TenantContext,
  userId: string,
  id: string
): Promise<TrainingCompletionState> {
  const head = await TrainingModule.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  })
    .select('_id')
    .lean();
  if (!head) throw new AppError('Not found', 404);

  await TrainingCompletion.deleteMany({ orgId: ctx.orgId, trainingId: id, userId });
  return { completed: false, completedAt: null };
}

/**
 * The completion roster for one module, for chefs and managers. Narrowed by
 * `completionReadFilter`, so a location chef sees their own kitchen's
 * completions, not the whole property's.
 */
export async function listCompletions(
  ctx: TenantContext,
  id: string
): Promise<TrainingCompletionRow[]> {
  assertRole(ctx, 'chef');
  const head = await TrainingModule.findOne({
    _id: id,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  })
    .select('_id')
    .lean();
  if (!head) throw new AppError('Not found', 404);

  const completions = await TrainingCompletion.find({
    ...completionReadFilter(ctx),
    trainingId: id,
  })
    .sort({ completedAt: -1 })
    .limit(500)
    .lean();

  const userIds = [...new Set(completions.map((c) => String(c.userId)))];
  const users =
    userIds.length > 0
      ? await User.find({ _id: { $in: userIds } })
          .select(SAFE_USER_FIELDS)
          .lean()
      : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return completions.map((completion) => {
    const user = byId.get(String(completion.userId));
    return {
      userId: String(completion.userId),
      name: (user?.name as UserName | undefined) ?? null,
      email: user?.email ?? null,
      locationId: completion.locationId ? String(completion.locationId) : null,
      completedAt: completion.completedAt.toISOString(),
    };
  });
}
