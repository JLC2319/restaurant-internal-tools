import { randomBytes } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { MediaAssetView, TenantContext, TenantScope } from '@rit/shared';
import type { Document } from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import { sniffImage } from '../../lib/imageMeta';
import { assertRole, scopeForWrite, scopeReadFilter } from '../../lib/scope';
import { Media } from './media.model';
import type { IMedia, IScope } from '../../types/index';

/**
 * Media: plating photos today, training video later. Binaries go to Cloudflare
 * R2 under a tenant-prefixed key; this service owns the record that indexes
 * them and the rules for who may attach one to what.
 *
 * The whole feature is optional infrastructure. Every entry point checks
 * `isMediaConfigured()` first rather than throwing at import time, so an
 * install with no R2 credentials still boots and every other feature works —
 * uploads just answer 503.
 */

type LeanMedia = Omit<IMedia, keyof Document> & { _id: unknown };

/** The uploaded file as multer's memory storage hands it over. */
export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

// ── Storage plumbing ──────────────────────────────────────────────────────────

/**
 * True when every piece of R2 config is present. `r2PublicUrl` counts: without
 * a delivery origin we could store an object and never hand back a URL for it,
 * which is a half-working feature rather than a disabled one.
 */
export function isMediaConfigured(): boolean {
  return Boolean(
    env.r2AccountId &&
      env.r2AccessKeyId &&
      env.r2SecretAccessKey &&
      env.r2BucketName &&
      env.r2PublicUrl
  );
}

function assertConfigured(): void {
  if (!isMediaConfigured()) {
    throw new AppError('Media storage is not configured on this server', 503);
  }
}

let client: S3Client | null = null;

/** Built on first use, not at import — see the note on optional config above. */
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
  }
  return client;
}

/**
 * Tenant-prefixed object key. The prefix is what lets a bucket policy fail
 * closed per tenant instead of globally, and the basename is random rather than
 * derived from the upload — a client filename never reaches storage.
 */
function buildKey(scope: TenantScope, ext: string): string {
  const property = scope.propertyId ?? '_';
  const location = scope.locationId ?? '_';
  return `${scope.orgId}/${property}/${location}/${randomBytes(16).toString('hex')}.${ext}`;
}

// ── Shaping ───────────────────────────────────────────────────────────────────

/** Clients get an assembled CDN URL; the storage key stays server-side. */
export function shapeAsset(asset: LeanMedia): MediaAssetView {
  return {
    _id: String(asset._id),
    kind: asset.kind,
    status: asset.status,
    url: `${env.r2PublicUrl}/${asset.key}`,
    mime: asset.mime,
    size: asset.size,
    width: asset.width ?? null,
    height: asset.height ?? null,
    createdAt: asset.createdAt.toISOString(),
  };
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Stores one plating photo and records it.
 *
 * SECURITY: the format is decided by `sniffImage` reading the file's own
 * header. The browser-supplied MIME type and filename are ignored entirely —
 * an upload that does not parse as one of our accepted image formats is
 * rejected, so nothing we later serve from a CDN origin can be a disguised
 * HTML or SVG document.
 *
 * The record is written only after the object lands, so the collection never
 * indexes bytes that are not there. The reverse leak — an orphaned object after
 * a failed insert — is the safe direction to fail.
 */
export async function uploadPhoto(
  ctx: TenantContext,
  userId: string,
  file: UploadedFile | undefined
): Promise<MediaAssetView> {
  assertConfigured();
  assertRole(ctx, 'chef');
  if (!file || file.size === 0) throw new AppError('No file was uploaded', 400);

  const meta = sniffImage(file.buffer);
  if (!meta) {
    throw new AppError('That file is not a JPEG, PNG or WebP image', 415);
  }

  const scope = scopeForWrite(ctx);
  const key = buildKey(scope, meta.ext);

  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.r2BucketName,
        Key: key,
        Body: file.buffer,
        ContentType: meta.mime,
        // Keys are random and never reused, so a stored object is immutable.
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (err) {
    console.error('R2 upload failed', err);
    throw new AppError('Could not store that photo. Please try again.', 502);
  }

  const asset = await Media.create({
    scope,
    kind: 'photo',
    status: 'ready',
    key,
    mime: meta.mime,
    size: file.size,
    width: meta.width,
    height: meta.height,
    uploadedBy: userId,
  });

  return shapeAsset(asset.toObject());
}

// ── Reads & attachment rules ──────────────────────────────────────────────────

/**
 * Resolves asset ids to views for display, keyed by id.
 *
 * Not scope-filtered, deliberately: attachment is validated against scope at
 * write time (`assertPhotosAttachable`), and a version snapshot must keep
 * rendering the plating it was saved with. Mirrors `subNamesFor` in the recipe
 * service, which resolves sub-recipe names the same way.
 */
export async function resolveAssets(ids: string[]): Promise<Map<string, MediaAssetView>> {
  if (ids.length === 0) return new Map();
  const assets = await Media.find({ _id: { $in: ids } }).lean();
  return new Map(assets.map((asset) => [String(asset._id), shapeAsset(asset)]));
}

/**
 * Validates that every id may be attached to a document living at `targetScope`.
 *
 * - the asset must exist inside the caller's read scope → 404 (existence
 *   hiding, as everywhere else);
 * - it must be a photo, not a video;
 * - its scope must sit at-or-above `targetScope`. Same rule as sub-recipes: a
 *   property recipe carrying one location's photo renders a broken image for
 *   every sibling location.
 */
export async function assertPhotosAttachable(
  ctx: TenantContext,
  targetScope: TenantScope,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;

  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw new AppError('The same photo is attached more than once', 400);
  }

  const assets = await Media.find({ _id: { $in: unique }, ...scopeReadFilter(ctx) })
    .select('kind scope')
    .lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));

  if (unique.some((id) => !byId.has(id))) throw new AppError('Photo not found', 404);

  for (const id of unique) {
    const asset = byId.get(id)!;
    if (asset.kind !== 'photo') throw new AppError('That asset is not a photo', 400);

    const scope: IScope = asset.scope;
    const propertyId = scope.propertyId ? String(scope.propertyId) : null;
    const locationId = scope.locationId ? String(scope.locationId) : null;
    if (
      (propertyId && propertyId !== targetScope.propertyId) ||
      (locationId && locationId !== targetScope.locationId)
    ) {
      throw new AppError(
        'That photo is scoped below this recipe — it would not load for part of this recipe’s audience',
        400
      );
    }
  }
}

// ── Deletion ──────────────────────────────────────────────────────────────────

/**
 * Removes an asset and its object.
 *
 * Nothing here rewrites the documents that referenced it: a version is
 * immutable, and a deleted asset simply drops out of the resolved photo list.
 * Deleting the record first means a failed R2 delete leaves an unreferenced
 * object rather than a record pointing at nothing.
 */
export async function deleteAsset(ctx: TenantContext, id: string): Promise<void> {
  assertConfigured();
  assertRole(ctx, 'chef');

  const asset = await Media.findOne({ _id: id, ...scopeReadFilter(ctx) }).lean();
  if (!asset) throw new AppError('Not found', 404);

  await Media.deleteOne({ _id: asset._id });

  try {
    await s3().send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: asset.key }));
  } catch (err) {
    // The record is already gone, so the asset is unreachable either way.
    // Log for bucket housekeeping rather than failing the caller's request.
    console.error('R2 delete failed for key', asset.key, err);
  }
}
