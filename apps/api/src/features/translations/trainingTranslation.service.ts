import { createHash } from 'node:crypto';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PUBLISHABLE_STATUS, docToPlainText, plainTextToDoc, roleAtLeast } from '@rit/shared';
import type {
  TargetLocale,
  TenantContext,
  TenantScope,
  TrainingTranslationPayloadInput,
  TrainingTranslationState,
  TrainingTranslationView,
  TranslationPublishMode,
} from '@rit/shared';
import { Types } from 'mongoose';
import type { Document } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { anthropic } from '../../lib/anthropic';
import { AppError } from '../../lib/AppError';
import { assertCanWriteAt, assertRole, scopeReadFilter } from '../../lib/scope';
import { personAccessFilter } from '../tenancy/personAccess';
import { TrainingModule } from '../training/trainingModule.model';
import { loadPublishConfig } from './translation.service';
import { TrainingTranslation } from './trainingTranslation.model';
import type {
  IScope,
  ITrainingBlock,
  ITrainingModule,
  ITrainingTranslation,
  ITrainingTranslationPayload,
} from '../../types/index';

/**
 * Training translation — the same mandatory human review gate as recipe
 * translation, adapted to modules that are edited in place. There is no
 * version history to pin a translation to, so `sourceHash` of the module's
 * translatable text is the entire staleness story: any edit to a published
 * module silently hides its approved translation until it is re-made or
 * re-approved.
 *
 * SAFETY: the payload is text only. Media assets, embeds and block structure
 * always render from the source module. Text blocks translate as *plain text*
 * — formatting does not survive translation, which is the honest trade
 * against an LLM hand-editing rich-text JSON.
 */

type LeanTraining = Omit<ITrainingModule, keyof Document> & { _id: Types.ObjectId };
type LeanTranslation = Omit<ITrainingTranslation, keyof Document> & { _id: unknown };

// ── Role helpers (mirrors trainingModule.service — not imported from it,
// which would create a service cycle: that service schedules auto runs). ──────

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

/** Role + write-tier check: may `ctx` manage translations of a module at `scope`? */
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

/** The translatable text of a module, aligned by index with its blocks. */
export interface TrainingTranslatableProjection {
  title: string;
  description: string;
  blocks: { text: string | null; caption: string | null }[];
}

/** The plain text of a stored text block, including the legacy `body` fallback. */
function blockPlainText(block: ITrainingBlock): string {
  return docToPlainText(block.doc ?? plainTextToDoc(block.body ?? ''));
}

/**
 * Projects the fields a translation covers. Text blocks project their plain
 * text; media/embed blocks project their caption (null when absent). Media
 * ids, embed URLs and block order are deliberately absent from the *values*
 * but the array is index-aligned, so reordering or re-typing blocks changes
 * the projection and correctly invalidates the translation.
 */
export function trainingTranslatableProjection(
  head: Pick<ITrainingModule, 'title' | 'description' | 'blocks'>,
): TrainingTranslatableProjection {
  return {
    title: head.title,
    description: head.description ?? '',
    blocks: head.blocks.map((block) => ({
      text: block.kind === 'text' ? blockPlainText(block) : null,
      caption: block.kind === 'text' ? null : (block.caption ?? null),
    })),
  };
}

/** Content-addressed identity of the text a translation was made from. */
export function trainingSourceHashOf(projection: TrainingTranslatableProjection): string {
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

/**
 * A translation is stale when the module's translatable text changed — there
 * is no version pointer to compare, the hash is everything. Stale approved
 * translations stay `approved` in the database (the approval was real) but
 * never render for staff.
 */
function isStale(head: LeanTraining, doc: LeanTranslation): boolean {
  return trainingSourceHashOf(trainingTranslatableProjection(head)) !== doc.sourceHash;
}

// ── The LLM call ──────────────────────────────────────────────────────────────

/**
 * What the model must return. Kept minimal for structured outputs; ceilings
 * and alignment are enforced by `sanitizeTrainingPayload` after parsing.
 */
const llmTrainingTranslationSchema = z.object({
  title: z.string(),
  description: z.string(),
  blocks: z.array(z.object({ text: z.string().nullable(), caption: z.string().nullable() })),
});

const TRAINING_TRANSLATION_SYSTEM = `You translate restaurant staff training material from English into Spanish. Use the working Spanish of a professional Latin American restaurant team — plain, direct, and unambiguous on the job.

Rules:
- Keep every number, temperature, time and measurement EXACTLY as written. Never convert units or round values.
- Do not translate proper nouns, brand names, product names, or terms of art that are already non-English ("mise en place", "sous vide").
- Your blocks array MUST align one-to-one with the source: the same number of entries in the same order.
- Where a source block's text is null, return null (it is an image or video). Where a source caption is null, return null. Never invent text that is not in the source.
- Preserve paragraph breaks and list lines within a block's text.
- This material trains safe food handling and service procedures — accuracy beats elegance. If a term is ambiguous, choose the reading a worker would act on safely.`;

/**
 * Clamps model output to the stored field ceilings and pins null-alignment to
 * the source blocks. Length mismatches are a hard failure — a misaligned
 * translation would caption the wrong block.
 */
export function sanitizeTrainingPayload(
  raw: z.infer<typeof llmTrainingTranslationSchema>,
  projection: TrainingTranslatableProjection,
): ITrainingTranslationPayload {
  const misaligned = () =>
    new AppError('The translation did not line up with the training. Please try again.', 502);

  if (raw.blocks.length !== projection.blocks.length) throw misaligned();

  const clamp = (value: string, max: number): string => value.trim().slice(0, max);

  const title = clamp(raw.title, 180);
  if (!title) throw misaligned();

  return {
    title,
    description: clamp(raw.description, 700),
    blocks: raw.blocks.map((block, index) => {
      const source = projection.blocks[index];
      // A text block must come back with text; a media block stays null
      // whatever the model said. Captions fall back to nothing rather than
      // inventing text.
      const text = source.text === null ? null : block.text ? clamp(block.text, 25000) : '';
      if (text === '') throw misaligned();
      return {
        text,
        caption:
          source.caption === null ? null : block.caption ? clamp(block.caption, 400) || null : null,
      };
    }),
  };
}

/** One whole-document call — block-by-block calls lose context and multiply cost. */
async function machineTranslate(
  projection: TrainingTranslatableProjection,
): Promise<ITrainingTranslationPayload> {
  let response;
  try {
    response = await anthropic().messages.parse({
      model: env.llmModel,
      max_tokens: 16000,
      system: TRAINING_TRANSLATION_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(projection) }],
      output_config: { format: zodOutputFormat(llmTrainingTranslationSchema) },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Machine training translation failed', err);
    throw new AppError('The translation service is unavailable right now. Please try again.', 502);
  }

  if (!response.parsed_output) {
    throw new AppError('The translation service returned no usable output. Please try again.', 502);
  }
  return sanitizeTrainingPayload(response.parsed_output, projection);
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeTranslation(doc: LeanTranslation, stale: boolean): TrainingTranslationView {
  return {
    _id: String(doc._id),
    trainingId: String(doc.trainingId),
    locale: doc.locale,
    status: doc.status,
    origin: doc.origin,
    stale,
    payload: {
      title: doc.payload.title,
      description: doc.payload.description,
      blocks: doc.payload.blocks.map((block) => ({
        text: block.text ?? null,
        caption: block.caption ?? null,
      })),
    },
    model: doc.llmModel ?? null,
    requestedBy: String(doc.requestedBy),
    requestedAt: doc.requestedAt.toISOString(),
    approvedBy: doc.approvedBy ? String(doc.approvedBy) : null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    autoApproved: doc.autoApproved === true,
    modifiedAt: doc.modifiedAt.toISOString(),
  };
}

// ── Loading helpers ───────────────────────────────────────────────────────────

async function loadHead(ctx: TenantContext, trainingId: string): Promise<LeanTraining> {
  // Composes the person-level ACL as well as scope: a translation is a
  // derivative of the module's full text, and this loader fronts every
  // translation read and write — gating it gates all five endpoints, above
  // all the staff-readable payload route, which carries no role gate.
  const head = await TrainingModule.findOne({
    _id: trainingId,
    ...scopeReadFilter(ctx),
    ...personAccessFilter(ctx),
  }).lean();
  if (!head) throw new AppError('Not found', 404);
  return head;
}

/** Chef+ acting within their write tier, on an unarchived module. */
async function loadHeadForManage(ctx: TenantContext, trainingId: string): Promise<LeanTraining> {
  assertRole(ctx, 'chef');
  const head = await loadHead(ctx, trainingId);
  const scope = shapeScope(head.scope);
  assertCanWriteAt(ctx, { propertyId: scope.propertyId, locationId: scope.locationId });
  if (head.status === 'archived') {
    throw new AppError('This training is archived. Unarchive it first.', 409);
  }
  return head;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Role-aware translation state. The review gate lives HERE, server-side:
 * anyone who cannot manage this module receives the translation only when it
 * is approved and still matches the source. Reviewers receive the full
 * document plus the computed `stale` flag.
 */
export async function getTrainingTranslationState(
  ctx: TenantContext,
  trainingId: string,
  locale: TargetLocale,
): Promise<TrainingTranslationState> {
  const head = await loadHead(ctx, trainingId);
  // Unpublished or archived work is invisible to readers — existence hiding,
  // mirroring getTraining.
  if (isReader(ctx) && head.status !== 'published') {
    throw new AppError('Not found', 404);
  }

  const manage = canManage(ctx, shapeScope(head.scope));
  const state: TrainingTranslationState = {
    enabled: env.translationEnabled,
    canManage: manage,
    publishMode: (await loadPublishConfig(head.scope, 'trainingTranslationPublishMode')).mode,
    ...autoTranslationFlags(head),
    translation: null,
  };

  const doc = await TrainingTranslation.findOne({
    trainingId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  }).lean();
  if (!doc) return state;

  const stale = isStale(head, doc);
  if (!manage) {
    const visible = doc.status === PUBLISHABLE_STATUS && !stale;
    return { ...state, translation: visible ? shapeTranslation(doc, false) : null };
  }
  return { ...state, translation: shapeTranslation(doc, stale) };
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Runs machine translation against the module's current text and stores the
 * result at `pending_review`. Never publishes on its own — approval is a
 * separate, human action. Re-running overwrites the payload and resets the
 * review state, which is what "Re-translate" means.
 */
export async function requestTrainingTranslation(
  ctx: TenantContext,
  userId: string,
  trainingId: string,
  locale: TargetLocale,
): Promise<TrainingTranslationView> {
  if (!env.translationEnabled) {
    throw new AppError('Machine translation is not configured on this server', 503);
  }
  const head = await loadHeadForManage(ctx, trainingId);
  if (head.status !== 'published') {
    throw new AppError(
      'This training is not published. Translation follows what staff read — publish it first.',
      409,
    );
  }

  // Everything user-deniable is checked above, before any money is spent.
  const projection = trainingTranslatableProjection(head);
  const payload = await machineTranslate(projection);

  const doc = await TrainingTranslation.findOneAndUpdate(
    { trainingId: head._id, locale },
    {
      $set: {
        scope: head.scope,
        status: 'pending_review',
        origin: 'machine',
        sourceHash: trainingSourceHashOf(projection),
        payload,
        llmModel: env.llmModel,
        requestedBy: new Types.ObjectId(userId),
        requestedAt: new Date(),
        approvedBy: null,
        approvedAt: null,
        autoApproved: false,
      },
    },
    { returnDocument: 'after', upsert: true },
  ).lean();

  // A chef translating by hand settles whatever the last automatic attempt did
  // or failed to do, so the marker (and the failure note it drives) goes.
  await TrainingModule.updateOne({ _id: head._id }, { $set: { autoTranslation: null } });

  return shapeTranslation(doc!, false);
}

/**
 * Saves a reviewer's edits. Editing makes the stored text something no one
 * has approved yet, so the status always returns to `pending_review` — the
 * reviewer approves the edited text as a second, explicit step.
 */
export async function updateTrainingTranslation(
  ctx: TenantContext,
  trainingId: string,
  locale: TargetLocale,
  payload: TrainingTranslationPayloadInput,
): Promise<TrainingTranslationView> {
  const head = await loadHeadForManage(ctx, trainingId);

  const doc = await TrainingTranslation.findOne({
    trainingId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  });
  if (!doc) throw new AppError('Not found', 404);

  // Edits align with the stored payload — it mirrors the source text the
  // translation was made from, which the module itself may since have left
  // behind. Aligning with anything else would caption the wrong blocks.
  if (payload.blocks.length !== doc.payload.blocks.length) {
    throw new AppError(
      'The edited translation does not line up with the training. Reload and try again.',
      409,
    );
  }

  doc.payload = {
    title: payload.title,
    description: payload.description,
    blocks: payload.blocks.map((block, index) => {
      const source = doc.payload.blocks[index];
      // Non-text blocks keep a null text (and caption-less blocks a null
      // caption) whatever the client sent.
      return {
        text: source.text === null ? null : (block.text ?? null),
        caption: source.caption === null ? null : (block.caption ?? null),
      };
    }),
  };
  doc.origin = 'machine_edited';
  doc.status = 'pending_review';
  doc.approvedBy = null;
  doc.approvedAt = null;
  // A person has now touched this text, so whatever auto-publish did to it
  // earlier no longer describes how it got here.
  doc.autoApproved = false;
  await doc.save();

  return shapeTranslation(doc.toObject(), isStale(head, doc.toObject()));
}

/**
 * The human sign-off. Approving a stale translation is refused outright: the
 * approver would be signing off text that no longer describes what staff
 * read. Record who and when — "who signed off on this" is the question that
 * matters after an incident.
 */
export async function approveTrainingTranslation(
  ctx: TenantContext,
  userId: string,
  trainingId: string,
  locale: TargetLocale,
): Promise<TrainingTranslationView> {
  const head = await loadHeadForManage(ctx, trainingId);

  const doc = await TrainingTranslation.findOne({
    trainingId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  });
  if (!doc) throw new AppError('Not found', 404);

  if (isStale(head, doc.toObject())) {
    throw new AppError(
      'The training has changed since this translation was made. Re-translate before approving.',
      409,
    );
  }

  doc.status = PUBLISHABLE_STATUS;
  doc.approvedBy = new Types.ObjectId(userId);
  doc.approvedAt = new Date();
  // A real signature replaces the auto-publish stamp — this is now reviewed
  // text, and the reader must stop badging it as unread.
  doc.autoApproved = false;
  await doc.save();

  return shapeTranslation(doc.toObject(), false);
}

/** Marks the translation rejected. The payload stays for the next attempt to learn from. */
export async function rejectTrainingTranslation(
  ctx: TenantContext,
  trainingId: string,
  locale: TargetLocale,
): Promise<TrainingTranslationView> {
  const head = await loadHeadForManage(ctx, trainingId);

  const doc = await TrainingTranslation.findOne({
    trainingId: head._id,
    locale,
    ...scopeReadFilter(ctx),
  });
  if (!doc) throw new AppError('Not found', 404);

  doc.status = 'rejected';
  doc.approvedBy = null;
  doc.approvedAt = null;
  doc.autoApproved = false;
  await doc.save();

  return shapeTranslation(doc.toObject(), isStale(head, doc.toObject()));
}

// ── Automatic translation (called by trainingModule.service) ──────────────────

/**
 * Machine-translates one locale of a module that has just been published (or
 * edited while published), writing the result at the status its scope's mode
 * dictates. Returns what it did, for the caller's log. Throws only on an LLM
 * failure — `autoTranslateTrainingOnPublish` is the thing that swallows.
 */
async function runAutoTranslation(
  head: LeanTraining,
  locale: TargetLocale,
  mode: TranslationPublishMode,
  actorUserId: string,
): Promise<'written' | 'skipped'> {
  const projection = trainingTranslatableProjection(head);
  const sourceHash = trainingSourceHashOf(projection);

  // Never overwrite a translation that already covers exactly this text. It
  // is what makes re-publishing unchanged content a no-op, and it protects a
  // chef's reviewed edits from being replaced by fresh machine output —
  // checked before the LLM call, so a no-op costs nothing.
  const existing = await TrainingTranslation.findOne({ trainingId: head._id, locale })
    .select('sourceHash')
    .lean();
  if (existing && existing.sourceHash === sourceHash) return 'skipped';

  const payload = await machineTranslate(projection);

  // The module may have moved on while the model was thinking: another edit,
  // or an unpublish. Writing now would stamp text staff no longer read — and
  // under auto_publish would stamp it *approved*. The later change's own run
  // produces the correct document.
  const current = await TrainingModule.findById(head._id)
    .select('title description blocks status')
    .lean();
  if (
    !current ||
    current.status !== 'published' ||
    trainingSourceHashOf(trainingTranslatableProjection(current)) !== sourceHash
  ) {
    return 'skipped';
  }

  // SAFETY: this is the one path that can reach `approved` without a person
  // reading the text, and only because the org explicitly chose auto_publish.
  // `approvedBy` stays null — there is no signature to record — and
  // `autoApproved` marks it so every surface can say the text is unreviewed.
  const autoPublish = mode === 'auto_publish';

  await TrainingTranslation.findOneAndUpdate(
    { trainingId: head._id, locale },
    {
      $set: {
        scope: head.scope,
        status: autoPublish ? PUBLISHABLE_STATUS : 'pending_review',
        origin: 'machine',
        sourceHash,
        payload,
        llmModel: env.llmModel,
        requestedBy: new Types.ObjectId(actorUserId),
        requestedAt: new Date(),
        approvedBy: null,
        approvedAt: autoPublish ? new Date() : null,
        autoApproved: autoPublish,
      },
    },
    { upsert: true },
  );

  return 'written';
}

/** Same timeout rationale as recipes: only a dead process leaves a marker this old. */
const AUTO_TRANSLATION_TIMEOUT_MS = 3 * 60_000;

/**
 * Claims the automatic run on the module, before the work starts — awaited by
 * the caller (unlike the translation itself) so the page never offers a
 * "Translate" button for work already in flight. Returns whether a run will
 * actually happen, so the caller only detaches the job when there is one.
 */
export async function beginAutoTrainingTranslation(
  trainingId: Types.ObjectId | string,
): Promise<boolean> {
  try {
    if (!env.translationEnabled) return false;

    const head = await TrainingModule.findById(trainingId).select('status scope').lean();
    if (!head || head.status !== 'published') return false;

    const { mode, targets } = await loadPublishConfig(head.scope, 'trainingTranslationPublishMode');
    if (mode === 'manual' || targets.length === 0) return false;

    await TrainingModule.updateOne(
      { _id: head._id },
      { $set: { autoTranslation: { status: 'running', startedAt: new Date() } } },
    );
    return true;
  } catch (err) {
    // Never block publishing on the bookkeeping — losing the marker costs a
    // duplicate-run button, not correctness.
    console.error('Could not mark automatic training translation as started', {
      trainingId: String(trainingId),
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

/** Clears the marker, or leaves `failed` behind for the UI to explain. */
async function endAutoTranslation(
  trainingId: Types.ObjectId | string,
  outcome: 'done' | 'failed',
): Promise<void> {
  try {
    const head = await TrainingModule.findById(trainingId).select('autoTranslation').lean();
    // Only ever clear our own run — a newer publish/edit may have claimed the
    // marker while this one was thinking.
    if (head?.autoTranslation?.status !== 'running') return;

    await TrainingModule.updateOne(
      { _id: trainingId },
      {
        $set: {
          autoTranslation:
            outcome === 'done' ? null : { ...head.autoTranslation, status: 'failed' as const },
        },
      },
    );
  } catch (err) {
    console.error('Could not clear the automatic training translation marker', {
      trainingId: String(trainingId),
      error: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Reads the run marker as the two booleans the UI needs. A `running` marker
 * older than the timeout is reported as a failure rather than as still
 * running — the job clears its own marker, so an old one means the process
 * carrying it is gone.
 */
function autoTranslationFlags(head: LeanTraining): {
  autoTranslating: boolean;
  autoTranslationFailed: boolean;
} {
  const marker = head.autoTranslation;
  if (!marker) return { autoTranslating: false, autoTranslationFailed: false };
  if (marker.status === 'failed') {
    return { autoTranslating: false, autoTranslationFailed: true };
  }
  const running = Date.now() - new Date(marker.startedAt).getTime() < AUTO_TRANSLATION_TIMEOUT_MS;
  return { autoTranslating: running, autoTranslationFailed: !running };
}

/**
 * The automatic half of the feature: publishing a module (or editing one that
 * is live) translates it by itself, when its scope is configured for it.
 *
 * Called detached from the request that triggered it — an LLM call takes
 * seconds and can fail, and neither is a reason for "Publish" to hang or roll
 * back. Nothing here throws: a failure leaves the module exactly as `manual`
 * mode would, with the chef's "Translate" button still there to press. It
 * does, however, always clear the marker `beginAutoTrainingTranslation` set.
 */
export async function autoTranslateTrainingOnPublish(
  trainingId: Types.ObjectId | string,
  actorUserId: string,
): Promise<void> {
  try {
    if (!env.translationEnabled) return;

    const head = await TrainingModule.findById(trainingId).lean();
    if (!head || head.status !== 'published') {
      await endAutoTranslation(trainingId, 'failed');
      return;
    }

    const { mode, targets } = await loadPublishConfig(head.scope, 'trainingTranslationPublishMode');
    if (mode === 'manual') {
      await endAutoTranslation(trainingId, 'done');
      return;
    }

    for (const locale of targets) {
      // Sequential: one module's locales share a rate-limit budget, and there
      // is no user waiting on this.
      await runAutoTranslation(head, locale, mode, actorUserId);
    }
    await endAutoTranslation(trainingId, 'done');
  } catch (err) {
    // Swallowed by design — see the doc comment. Logged loudly because the
    // chef gets no error toast for something they did not press a button for.
    console.error('Automatic training translation failed', {
      trainingId: String(trainingId),
      error: err instanceof Error ? err.message : err,
    });
    await endAutoTranslation(trainingId, 'failed');
  }
}
