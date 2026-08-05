import { createHash } from 'node:crypto';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PUBLISHABLE_STATUS, roleAtLeast } from '@rit/shared';
import type {
  RecipeTranslationState,
  RecipeTranslationView,
  TargetLocale,
  TenantContext,
  TenantScope,
  TranslationPayloadInput,
} from '@rit/shared';
import { Types } from 'mongoose';
import type { Document } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { anthropic } from '../../lib/anthropic';
import { AppError } from '../../lib/AppError';
import { assertCanWriteAt, assertRole, scopeReadFilter } from '../../lib/scope';
import { Recipe } from '../recipes/recipe.model';
import { RecipeVersion } from '../recipes/recipeVersion.model';
import { RecipeTranslation } from './translation.model';
import type {
  IRecipe,
  IRecipeContent,
  IRecipeTranslation,
  IScope,
  ITranslationPayload,
} from '../../types/index';

/**
 * Recipe translation with a mandatory human review gate — the demo
 * centrepiece. The LLM produces a `pending_review` document; only a chef's
 * explicit approval makes it staff-visible, and any change to the live source
 * (a different version set live, a rename) makes it stale and invisible again.
 *
 * SAFETY: the payload is text only. Quantities, units, photos and allergen
 * *tags* always render from the source version — the LLM translates labels'
 * text downstream via a static dictionary and never decides which tags apply.
 */

// `_id` stays concretely typed here (unlike recipe.service's `unknown`)
// because translation filters key on the head's id.
type LeanRecipe = Omit<IRecipe, keyof Document> & { _id: Types.ObjectId };
type LeanTranslation = Omit<IRecipeTranslation, keyof Document> & { _id: unknown };

// ── Role helpers (mirrors recipe.service — not imported from it, which would
// create a service cycle: recipe.service calls invalidateForActiveVersion). ──

/** Readers (below chef) only ever see approved, current translations. */
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

/** Role + write-tier check: may `ctx` manage translations of a recipe at `scope`? */
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

// ── Source projection & staleness ─────────────────────────────────────────────

/** The translatable text of a recipe, aligned by index with the source arrays. */
export interface TranslatableProjection {
  name: string;
  description: string;
  ingredients: { name: string | null; note: string | null }[];
  steps: string[];
}

/**
 * Projects the fields a translation covers. Sub-recipe lines project a null
 * name — their display name belongs to the referenced lineage. Quantities and
 * enums are deliberately absent: they are not translated, so changing them
 * must not invalidate a translation (changing them requires a new live
 * version anyway, which `sourceVersionId` catches).
 */
export function translatableProjection(
  name: string,
  content: Pick<IRecipeContent, 'description' | 'ingredients' | 'steps'>
): TranslatableProjection {
  return {
    name,
    description: content.description ?? '',
    ingredients: content.ingredients.map((line) => ({
      name: line.kind === 'item' ? (line.name ?? '') : null,
      note: line.note ?? null,
    })),
    steps: [...content.steps],
  };
}

/** Content-addressed identity of the text a translation was made from. */
export function sourceHashOf(projection: TranslatableProjection): string {
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

/**
 * A translation is stale when the live pointer moved or the live *text*
 * changed (a head rename reaches staff without a new version, so the version
 * id alone is not enough). Stale approved translations stay `approved` in the
 * database — the approval was real — but never render for staff.
 */
async function isStale(head: LeanRecipe, doc: LeanTranslation): Promise<boolean> {
  if (!head.activeVersionId || String(doc.sourceVersionId) !== String(head.activeVersionId)) {
    return true;
  }
  const version = await RecipeVersion.findById(head.activeVersionId).select('content').lean();
  if (!version) return true;
  return sourceHashOf(translatableProjection(head.name, version.content)) !== doc.sourceHash;
}

// ── The LLM call ──────────────────────────────────────────────────────────────

/**
 * What the model must return. Kept minimal for structured outputs; ceilings
 * and alignment are enforced by `sanitizePayload` after parsing.
 */
const llmTranslationSchema = z.object({
  name: z.string(),
  description: z.string(),
  ingredients: z.array(z.object({ name: z.string().nullable(), note: z.string().nullable() })),
  steps: z.array(z.string()),
});

const TRANSLATION_SYSTEM = `You translate restaurant recipes from English into Spanish for back-of-house kitchen staff. Use the working Spanish of a professional Latin American line cook — plain, direct, and unambiguous on the line.

Rules:
- Keep every number, temperature, time and measurement EXACTLY as written. Never convert units or round values.
- Do not translate proper nouns, brand names, or dish names that are already non-English ("mole", "beurre blanc", "mise en place").
- Your arrays MUST align one-to-one with the source: the same number of ingredients in the same order, and the same number of steps in the same order.
- Where a source ingredient name is null, return null (it is a sub-recipe reference). Where a source note is null, return null. Never invent text that is not in the source.
- This text guides food preparation and allergen awareness in a working kitchen — accuracy beats elegance. If a term is ambiguous, choose the reading a cook would act on safely.`;

/**
 * Clamps model output to the stored field ceilings and pins the null-alignment
 * of sub-recipe lines. Length mismatches are a hard failure — a misaligned
 * translation would caption the wrong ingredient.
 */
export function sanitizePayload(
  raw: z.infer<typeof llmTranslationSchema>,
  projection: TranslatableProjection
): ITranslationPayload {
  const misaligned = () =>
    new AppError('The translation did not line up with the recipe. Please try again.', 502);

  if (
    raw.ingredients.length !== projection.ingredients.length ||
    raw.steps.length !== projection.steps.length
  ) {
    throw misaligned();
  }

  const clamp = (value: string, max: number): string => value.trim().slice(0, max);

  const name = clamp(raw.name, 160);
  if (!name) throw misaligned();

  return {
    name,
    description: clamp(raw.description, 3000),
    ingredients: raw.ingredients.map((ing, index) => {
      const source = projection.ingredients[index];
      return {
        // A sub-recipe line stays null whatever the model said; an item line
        // falls back to nothing rather than inventing text.
        name: source.name === null ? null : ing.name ? clamp(ing.name, 160) || null : null,
        note: source.note === null ? null : ing.note ? clamp(ing.note, 400) || null : null,
      };
    }),
    steps: raw.steps.map((step) => {
      const value = clamp(step, 3000);
      if (!value) throw misaligned();
      return value;
    }),
  };
}

/** One whole-document call — field-by-field calls lose context and multiply cost. */
async function machineTranslate(projection: TranslatableProjection): Promise<ITranslationPayload> {
  let response;
  try {
    response = await anthropic().messages.parse({
      model: env.llmModel,
      max_tokens: 8192,
      system: TRANSLATION_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(projection) }],
      output_config: { format: zodOutputFormat(llmTranslationSchema) },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Machine translation failed', err);
    throw new AppError('The translation service is unavailable right now. Please try again.', 502);
  }

  if (!response.parsed_output) {
    throw new AppError('The translation service returned no usable output. Please try again.', 502);
  }
  return sanitizePayload(response.parsed_output, projection);
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeTranslation(doc: LeanTranslation, stale: boolean): RecipeTranslationView {
  return {
    _id: String(doc._id),
    recipeId: String(doc.recipeId),
    locale: doc.locale,
    status: doc.status,
    origin: doc.origin,
    sourceVersion: doc.sourceVersion,
    stale,
    payload: {
      name: doc.payload.name,
      description: doc.payload.description,
      ingredients: doc.payload.ingredients.map((ing) => ({
        name: ing.name ?? null,
        note: ing.note ?? null,
      })),
      steps: [...doc.payload.steps],
    },
    model: doc.llmModel ?? null,
    requestedBy: String(doc.requestedBy),
    requestedAt: doc.requestedAt.toISOString(),
    approvedBy: doc.approvedBy ? String(doc.approvedBy) : null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    modifiedAt: doc.modifiedAt.toISOString(),
  };
}

// ── Loading helpers ───────────────────────────────────────────────────────────

async function loadHead(ctx: TenantContext, recipeId: string): Promise<LeanRecipe> {
  const head = await Recipe.findOne({ _id: recipeId, ...scopeReadFilter(ctx) }).lean();
  if (!head) throw new AppError('Not found', 404);
  return head;
}

/** Chef+ acting within their write tier, on an unarchived recipe. */
async function loadHeadForManage(ctx: TenantContext, recipeId: string): Promise<LeanRecipe> {
  assertRole(ctx, 'chef');
  const head = await loadHead(ctx, recipeId);
  const scope = shapeScope(head.scope);
  assertCanWriteAt(ctx, { propertyId: scope.propertyId, locationId: scope.locationId });
  if (head.status === 'archived') {
    throw new AppError('This recipe is archived. Unarchive it first.', 409);
  }
  return head;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Role-aware translation state. The review gate lives HERE, server-side:
 * anyone who cannot manage this recipe receives the translation only when it
 * is approved and still matches the live source. Reviewers receive the full
 * document plus the computed `stale` flag.
 */
export async function getTranslationState(
  ctx: TenantContext,
  recipeId: string,
  locale: TargetLocale
): Promise<RecipeTranslationState> {
  const head = await loadHead(ctx, recipeId);
  // Unpublished or archived work is invisible to readers — existence hiding,
  // mirroring getRecipe.
  if (isReader(ctx) && (head.status !== 'active' || !head.activeVersionId)) {
    throw new AppError('Not found', 404);
  }

  const manage = canManage(ctx, shapeScope(head.scope));
  const state: RecipeTranslationState = {
    enabled: env.translationEnabled,
    canManage: manage,
    translation: null,
  };

  const doc = await RecipeTranslation.findOne({
    recipeId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  }).lean();
  if (!doc) return state;

  const stale = await isStale(head, doc);
  if (!manage) {
    const visible = doc.status === PUBLISHABLE_STATUS && !stale;
    return { ...state, translation: visible ? shapeTranslation(doc, false) : null };
  }
  return { ...state, translation: shapeTranslation(doc, stale) };
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Runs machine translation against the LIVE version and stores the result at
 * `pending_review`. Never publishes on its own — approval is a separate,
 * human action. Re-running overwrites the payload and resets the review
 * state, which is what "Re-translate" means.
 */
export async function requestTranslation(
  ctx: TenantContext,
  userId: string,
  recipeId: string,
  locale: TargetLocale
): Promise<RecipeTranslationView> {
  if (!env.translationEnabled) {
    throw new AppError('Machine translation is not configured on this server', 503);
  }
  const head = await loadHeadForManage(ctx, recipeId);
  if (!head.activeVersionId) {
    throw new AppError(
      'This recipe has no live version. Translation follows what staff read — set a version live first.',
      409
    );
  }

  const version = await RecipeVersion.findById(head.activeVersionId).lean();
  if (!version) throw new AppError('Not found', 404);

  // Everything user-deniable is checked above, before any money is spent.
  const projection = translatableProjection(head.name, version.content);
  const payload = await machineTranslate(projection);

  const doc = await RecipeTranslation.findOneAndUpdate(
    { recipeId: head._id, locale },
    {
      $set: {
        scope: head.scope,
        status: 'pending_review',
        origin: 'machine',
        sourceVersionId: head.activeVersionId,
        sourceVersion: head.activeVersion ?? version.version,
        sourceHash: sourceHashOf(projection),
        payload,
        llmModel: env.llmModel,
        requestedBy: new Types.ObjectId(userId),
        requestedAt: new Date(),
        approvedBy: null,
        approvedAt: null,
      },
    },
    { returnDocument: 'after', upsert: true }
  ).lean();

  return shapeTranslation(doc!, false);
}

/**
 * Saves a reviewer's edits. Editing makes the stored text something no one
 * has approved yet, so the status always returns to `pending_review` — the
 * reviewer approves the edited text as a second, explicit step.
 */
export async function updateTranslation(
  ctx: TenantContext,
  recipeId: string,
  locale: TargetLocale,
  payload: TranslationPayloadInput
): Promise<RecipeTranslationView> {
  const head = await loadHeadForManage(ctx, recipeId);

  const doc = await RecipeTranslation.findOne({
    recipeId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  });
  if (!doc) throw new AppError('Not found', 404);

  // Edits align with the version the translation was made from — aligning
  // with anything else would caption the wrong ingredient lines.
  const version = await RecipeVersion.findById(doc.sourceVersionId).select('content').lean();
  if (!version) throw new AppError('Not found', 404);
  if (
    payload.ingredients.length !== version.content.ingredients.length ||
    payload.steps.length !== version.content.steps.length
  ) {
    throw new AppError(
      'The edited translation does not line up with the source version. Reload and try again.',
      409
    );
  }

  doc.payload = {
    name: payload.name,
    description: payload.description,
    ingredients: payload.ingredients.map((ing, index) => {
      const source = version.content.ingredients[index];
      // Sub-recipe lines keep a null name whatever the client sent.
      return {
        name: source.kind === 'item' ? (ing.name ?? null) : null,
        note: ing.note ?? null,
      };
    }),
    steps: payload.steps,
  };
  doc.origin = 'machine_edited';
  doc.status = 'pending_review';
  doc.approvedBy = null;
  doc.approvedAt = null;
  await doc.save();

  return shapeTranslation(doc.toObject(), await isStale(head, doc.toObject()));
}

/**
 * The human sign-off. Approving a stale translation is refused outright: the
 * approver would be signing off text that no longer describes what staff
 * read. Record who and when — "who signed off on this" is the question that
 * matters after an incident.
 */
export async function approveTranslation(
  ctx: TenantContext,
  userId: string,
  recipeId: string,
  locale: TargetLocale
): Promise<RecipeTranslationView> {
  const head = await loadHeadForManage(ctx, recipeId);

  const doc = await RecipeTranslation.findOne({
    recipeId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  });
  if (!doc) throw new AppError('Not found', 404);

  if (await isStale(head, doc.toObject())) {
    throw new AppError(
      'The live recipe has changed since this translation was made. Re-translate before approving.',
      409
    );
  }

  doc.status = PUBLISHABLE_STATUS;
  doc.approvedBy = new Types.ObjectId(userId);
  doc.approvedAt = new Date();
  await doc.save();

  return shapeTranslation(doc.toObject(), false);
}

/** Marks the translation rejected. The payload stays for the next attempt to learn from. */
export async function rejectTranslation(
  ctx: TenantContext,
  recipeId: string,
  locale: TargetLocale
): Promise<RecipeTranslationView> {
  const head = await loadHeadForManage(ctx, recipeId);

  const doc = await RecipeTranslation.findOne({
    recipeId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  });
  if (!doc) throw new AppError('Not found', 404);

  doc.status = 'rejected';
  doc.approvedBy = null;
  doc.approvedAt = null;
  await doc.save();

  return shapeTranslation(doc.toObject(), await isStale(head, doc.toObject()));
}

// ── Invalidation (called by recipe.service) ───────────────────────────────────

/**
 * Setting a different version live knocks approved translations back to
 * `pending_review` — otherwise the Spanish silently describes the old recipe.
 * Re-activating the same version leaves the approval standing: it was made
 * against exactly that content. The read-time staleness check remains the
 * belt-and-braces guard for everything else (e.g. head renames).
 */
export async function invalidateForActiveVersion(
  recipeId: Types.ObjectId | string,
  newActiveVersionId: Types.ObjectId | string
): Promise<void> {
  await RecipeTranslation.updateMany(
    {
      recipeId,
      status: PUBLISHABLE_STATUS,
      sourceVersionId: { $ne: newActiveVersionId },
    },
    { $set: { status: 'pending_review', approvedBy: null, approvedAt: null } }
  );
}
