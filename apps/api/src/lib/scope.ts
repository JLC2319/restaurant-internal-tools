import { roleAtLeast } from '@rit/shared';
import type { TenantContext, TenantRole, TenantScope, TenantTier } from '@rit/shared';
import { AppError } from './AppError';

/**
 * Tenant scoping — the one rule that makes this app multi-tenant.
 *
 * Every tenant-owned document carries an embedded `scope` sub-document:
 *
 *   scope: { orgId, propertyId: ObjectId | null, locationId: ObjectId | null }
 *
 * `propertyId` and `locationId` are stored as explicit `null` — never omitted —
 * when the document lives higher up the tree. Mongo would match a missing field
 * against `$in: [null, id]` all the same, but a consistently present field keeps
 * one index shape and makes "org-level" legible in the data rather than implied
 * by absence. Set all three on every insert; `scopeForWrite` does this for you.
 *
 * Visibility flows downward and only downward:
 *
 *   org-level content      → visible to everyone in the org
 *   property-level content → visible to that property and its locations
 *   location-level content → visible to that location only
 *
 * so an Independent Property's shared recipe book reaches all its restaurants,
 * while one restaurant's site-specific menu never leaks sideways to another.
 */

/** How wide a membership reaches. Derived from which ids the membership carries. */
export function tierOf(scope: Pick<TenantScope, 'propertyId' | 'locationId'>): TenantTier {
  if (scope.locationId) return 'location';
  if (scope.propertyId) return 'property';
  return 'org';
}

/**
 * The Mongo filter selecting every document `ctx` is allowed to *read*.
 *
 * Compose it into a feature query rather than hand-rolling scope conditions:
 *
 *   const docs = await Recipe.find({ ...scopeReadFilter(ctx), status: 'approved' })
 *
 * `path` names the scope sub-document; only override it if a model embeds the
 * scope somewhere other than `scope`. Typed loosely because the paths are
 * dotted strings — Mongoose's generic filter types cannot express them.
 */
export function scopeReadFilter(ctx: TenantContext, path = 'scope'): Record<string, unknown> {
  const filter: Record<string, unknown> = { [`${path}.orgId`]: ctx.orgId };

  // An org-level member sees the whole org, so no further narrowing.
  if (!ctx.propertyId) return filter;

  // A property member sees org-wide content plus their own property's.
  filter[`${path}.propertyId`] = { $in: [null, ctx.propertyId] };
  if (!ctx.locationId) return filter;

  // A location member additionally never sees a sibling location's content.
  filter[`${path}.locationId`] = { $in: [null, ctx.locationId] };
  return filter;
}

/**
 * The scope to stamp on a document the caller is creating. Defaults to the
 * caller's own scope; a caller may deliberately publish *downward* (an org
 * director writing a menu for one location) but never upward or sideways.
 */
export function scopeForWrite(
  ctx: TenantContext,
  target?: Partial<Pick<TenantScope, 'propertyId' | 'locationId'>>
): TenantScope {
  const propertyId = target?.propertyId ?? ctx.propertyId;
  const locationId = target?.locationId ?? ctx.locationId;

  assertCanWriteAt(ctx, { propertyId: propertyId ?? null, locationId: locationId ?? null });

  return { orgId: ctx.orgId, propertyId: propertyId ?? null, locationId: locationId ?? null };
}

/**
 * Throws unless `ctx` may write at `target`. Writing is allowed at the caller's
 * own tier or any tier below it — an org admin may write for a location, a
 * location manager may not write for the whole property.
 *
 * 403 rather than 404 here: the caller has already proven org membership, so
 * there is no existence to hide.
 */
export function assertCanWriteAt(
  ctx: TenantContext,
  target: Pick<TenantScope, 'propertyId' | 'locationId'>
): void {
  if (target.locationId && !target.propertyId) {
    throw new AppError('A location-scoped document must also name its property', 400);
  }

  // Org-level members may write anywhere inside their org.
  if (!ctx.propertyId) return;

  // Property members are confined to their own property (and its locations).
  if (target.propertyId !== ctx.propertyId) {
    throw new AppError('You cannot write outside your assigned scope', 403);
  }
  if (!ctx.locationId) return;

  // Location members are confined to their own location.
  if (target.locationId !== ctx.locationId) {
    throw new AppError('You cannot write outside your assigned scope', 403);
  }
}

/**
 * Throws unless the caller holds at least `minimum` in the active scope.
 * Platform admins bypass — they are us, not a customer.
 */
export function assertRole(ctx: TenantContext, minimum: TenantRole): void {
  if (ctx.isPlatformAdmin) return;
  if (!roleAtLeast(ctx.role, minimum)) {
    throw new AppError('Forbidden', 403);
  }
}
