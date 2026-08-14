import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import type { TenantContext, TenantRole } from '@rit/shared';
import { AppError } from '../lib/AppError';
import { tierOf, assertRole } from '../lib/scope';
import { Membership } from '../features/tenancy/membership.model';
import { User } from '../features/auth/auth.model';

const ORG_HEADER = 'x-org-id';
const PROPERTY_HEADER = 'x-property-id';
const LOCATION_HEADER = 'x-location-id';

function header(req: Request, name: string): string | null {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertObjectId(value: string, label: string): void {
  if (!Types.ObjectId.isValid(value)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
}

/**
 * Resolves which org / property / location the caller is acting in, and proves
 * they are entitled to it. Must run after `authenticate`.
 *
 * The client names the scope with three headers rather than putting the ids in
 * every path: `X-Org-Id` (required), plus optionally `X-Property-Id` and
 * `X-Location-Id` to narrow further. Headers keep the ids off the URL, so the
 * same route works at every tier and nothing tenant-identifying lands in access
 * logs or browser history.
 *
 * A user may hold several memberships in one org (a chef running two
 * locations). We take the *broadest* one as their entitlement, then apply any
 * narrowing the client asked for. Narrowing outside the entitlement is a 404,
 * not a 403 — a caller must not be able to probe which properties exist in an
 * org they are not in.
 */
export async function resolveTenant(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) {
    throw new AppError('Missing or invalid authorization header', 401);
  }

  const orgId = header(req, ORG_HEADER);
  if (!orgId) {
    throw new AppError(`Missing ${ORG_HEADER} header`, 400);
  }
  assertObjectId(orgId, ORG_HEADER);

  const requestedPropertyId = header(req, PROPERTY_HEADER);
  if (requestedPropertyId) assertObjectId(requestedPropertyId, PROPERTY_HEADER);
  const requestedLocationId = header(req, LOCATION_HEADER);
  if (requestedLocationId) assertObjectId(requestedLocationId, LOCATION_HEADER);

  const user = await User.findById(req.userId).select('platformRole').lean();
  if (!user) throw new AppError('Invalid or expired token', 401);
  const isPlatformAdmin = user.platformRole === 'superAdmin';

  const memberships = await Membership.find({
    userId: req.userId,
    orgId,
    status: 'active',
  })
    .select('role propertyId locationId')
    .lean();

  // Broadest first: an org-wide row beats a property row beats a location row.
  const entitlement = memberships.sort(
    (a, b) => scopeWidth(a) - scopeWidth(b)
  )[0];

  if (!entitlement && !isPlatformAdmin) {
    // Existence hiding: an outsider learns nothing about which orgs exist.
    throw new AppError('Not found', 404);
  }

  const grantedPropertyId = entitlement ? idToString(entitlement.propertyId) : null;
  const grantedLocationId = entitlement ? idToString(entitlement.locationId) : null;

  // Narrowing is allowed; widening is not. A platform admin has no membership
  // row, so their granted scope is the whole org and any narrowing is accepted.
  if (grantedPropertyId && requestedPropertyId && requestedPropertyId !== grantedPropertyId) {
    throw new AppError('Not found', 404);
  }
  if (grantedLocationId && requestedLocationId && requestedLocationId !== grantedLocationId) {
    throw new AppError('Not found', 404);
  }

  const propertyId = grantedPropertyId ?? requestedPropertyId;
  const locationId = grantedLocationId ?? requestedLocationId;

  if (locationId && !propertyId) {
    throw new AppError(`${LOCATION_HEADER} also requires ${PROPERTY_HEADER}`, 400);
  }

  const tenant: TenantContext = {
    // Guarded non-null above: the 401 throw at the top of this function.
    userId: req.userId,
    orgId,
    propertyId,
    locationId,
    role: (entitlement?.role as TenantRole) ?? 'owner',
    tier: tierOf({ propertyId, locationId }),
    isPlatformAdmin,
  };

  req.tenant = tenant;
  next();
}

/** Sort key: 0 = org-wide, 1 = property, 2 = location. */
function scopeWidth(m: { propertyId?: unknown; locationId?: unknown }): number {
  if (m.locationId) return 2;
  if (m.propertyId) return 1;
  return 0;
}

function idToString(value: unknown): string | null {
  return value ? String(value) : null;
}

/**
 * Requires at least `minimum` in the active scope. Must run after
 * `resolveTenant`.
 *
 *   router.post('/', authenticate, resolveTenant, requireRole('manager'), ...)
 */
export function requireRole(minimum: TenantRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.tenant) {
      throw new AppError('Tenant scope not resolved', 500);
    }
    assertRole(req.tenant, minimum);
    next();
  };
}
