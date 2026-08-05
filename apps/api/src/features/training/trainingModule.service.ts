import { parseVideoEmbed, plainTextToDoc, roleAtLeast } from '@rit/shared';
import type {
  CreateTrainingInput,
  ListTrainingsQuery,
  MediaAssetView,
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
  UpdateTrainingInput,
} from '@rit/shared';
import { Types } from 'mongoose';
import type { Document } from 'mongoose';
import { AppError } from '../../lib/AppError';
import { escapeRegex } from '../../lib/regex';
import { assertCanWriteAt, assertRole, scopeForWrite, scopeReadFilter } from '../../lib/scope';
import { assertAssetsAttachable, resolveAssets } from '../media/media.service';
import { User, SAFE_USER_FIELDS } from '../auth/auth.model';
import { Property } from '../tenancy/property.model';
import { Location } from '../tenancy/location.model';
import { TrainingModule } from './trainingModule.model';
import { TrainingCompletion } from './trainingCompletion.model';
import type {
  IScope,
  ITrainingBlock,
  ITrainingCompletion,
  ITrainingModule,
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
  const [media, myCompletion, completedCount] = await Promise.all([
    blockMediaFor(head.blocks),
    TrainingCompletion.findOne({ orgId: ctx.orgId, trainingId: headId, userId })
      .sort({ completedAt: -1 })
      .lean(),
    manage
      ? TrainingCompletion.countDocuments({ ...completionReadFilter(ctx), trainingId: headId })
      : Promise.resolve(null),
  ]);

  return {
    ...shapeSummary(head, media, myCompletion?.completedAt ?? null),
    blocks: shapeBlocks(head.blocks, media),
    createdBy: String(head.createdBy),
    canManage: manage,
    completedCount,
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
  const head = await TrainingModule.findOne({ _id: id, ...scopeReadFilter(ctx) }).lean();
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

  const training = await TrainingModule.create({
    scope,
    title: input.title,
    description: input.description,
    status: 'draft',
    blocks,
    publishedAt: null,
    createdBy: userId,
  });

  return getTraining(ctx, userId, String(training._id));
}

/** Loads a module for mutation: scoped (404), write-tier checked (403), not archived (409). */
async function loadForWrite(
  ctx: TenantContext,
  id: string,
  allowArchived = false
): Promise<ITrainingModule> {
  const head = await TrainingModule.findOne({ _id: id, ...scopeReadFilter(ctx) });
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

  if (input.title !== undefined) head.title = input.title;
  if (input.description !== undefined) head.description = input.description;
  if (input.blocks !== undefined) {
    const blocks = buildBlocks(input.blocks);
    await assertBlockMediaAttachable(ctx, shapeScope(head.scope), blocks);
    head.blocks = blocks;
  }

  await head.save();
  return getTraining(ctx, userId, id);
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
  return getTraining(ctx, userId, id);
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
  const head = await TrainingModule.findOne({ _id: id, ...scopeReadFilter(ctx) })
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
  const head = await TrainingModule.findOne({ _id: id, ...scopeReadFilter(ctx) })
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
  const head = await TrainingModule.findOne({ _id: id, ...scopeReadFilter(ctx) })
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
