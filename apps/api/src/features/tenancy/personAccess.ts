import { roleAtLeast } from '@rit/shared';
import type { TenantContext, TenantScope } from '@rit/shared';
import { AppError } from '../../lib/AppError';
import { membershipReadersFilter } from '../../lib/scope';
import { Membership } from './membership.model';

/**
 * Person-level access — the layer *under* tenancy scope, shared by every
 * entity that supports an allow-list (recipes, trainings).
 *
 * A document may carry `access: { userIds }`, restricting it to those people
 * plus a fixed bypass set. The predicate here only ever narrows what
 * `scopeReadFilter` already allows; it can never widen it, because callers
 * compose the two filters in the same query.
 *
 * The field contract: an opted-in model stores the list at `access` (null —
 * and, on documents that predate the feature, absent — meaning everyone in
 * scope) and its creator at `createdBy`. Lives in the tenancy feature because
 * validating a list is a Membership query, and so feature services can import
 * it without cycles through each other.
 */

/**
 * Whether `ctx` sees every document in scope regardless of allow-lists.
 *
 * Admin-or-above only — directors and managers do NOT bypass (a deliberate
 * product decision: leadership can always recover a document, middle roles are
 * excluded unless listed). The platform check is explicit rather than relying
 * on resolveTenant's membership-less `role: 'owner'` fallback.
 */
export function canBypassPersonAccess(ctx: TenantContext): boolean {
  return ctx.isPlatformAdmin || roleAtLeast(ctx.role, 'admin');
}

/**
 * The Mongo filter fragment enforcing the allow-list, spread into a query
 * beside `scopeReadFilter(ctx)`:
 *
 *   Recipe.findOne({ _id: id, ...scopeReadFilter(ctx), ...personAccessFilter(ctx) })
 *
 * `{ access: null }` matches both an explicit null and a missing field, so
 * every document that predates the feature stays visible with no backfill.
 * The creator branch is the lockout guard: whoever made a document can always
 * still see it, however the list is edited.
 *
 * NOTE: contributes a top-level `$or`. No current call site carries another
 * one; if a future query does, wrap both in `$and` or the spreads clobber.
 */
export function personAccessFilter(ctx: TenantContext): Record<string, unknown> {
  if (canBypassPersonAccess(ctx)) return {};
  return {
    $or: [
      { access: null },
      { 'access.userIds': ctx.userId },
      { createdBy: ctx.userId },
    ],
  };
}

/** The allow-list ids as unique strings, order preserved. */
export function dedupeAccessUserIds(userIds: string[]): string[] {
  return [...new Set(userIds)];
}

/**
 * Rejects an allow-list containing anyone who could not actually see the
 * document: listing a user whose memberships never reach `scope` (wrong
 * property, revoked, another org) would be a dead entry that silently grants
 * nothing — better to fail the write loudly than store an ACL that lies.
 *
 * One query: every *active* membership in this org, for these users, whose
 * visibility includes a document at `scope`; any requested id not covered is
 * named in the 400.
 */
export async function assertAccessListValid(
  scope: TenantScope,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;

  const rows = await Membership.find({
    orgId: scope.orgId,
    status: 'active',
    userId: { $in: userIds },
    ...membershipReadersFilter(scope),
  })
    .select('userId')
    .lean();

  const covered = new Set(rows.map((row) => String(row.userId)));
  const missing = userIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new AppError(
      `These users cannot see this scope: ${missing.join(', ')}`,
      400
    );
  }
}
