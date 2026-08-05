import type {
  OrganizationSummary,
  PaginatedResponse,
  PlatformCreateOrganizationInput,
  PlatformListQuery,
  PlatformOrganizationDetail,
  PlatformOrganizationRow,
  PlatformStats,
  PlatformUpdateOrganizationInput,
  PlatformUpdateUserInput,
  PlatformUserRow,
  UserName,
} from '@rit/shared';
import { AppError } from '../../lib/AppError';
import { escapeRegex } from '../../lib/regex';
import { tierOf } from '../../lib/scope';
import { User, SAFE_USER_FIELDS } from '../auth/auth.model';
import { Organization } from '../tenancy/organization.model';
import { Property } from '../tenancy/property.model';
import { Location } from '../tenancy/location.model';
import { Membership } from '../tenancy/membership.model';
import {
  createOrganization as createOrgWithOwner,
  shapeLocation,
  shapeProperty,
} from '../tenancy/tenancy.service';
import type { IOrganization, IUser } from '../../types/index';

/**
 * Cross-tenant reads and writes for the platform console. Nothing here takes a
 * TenantContext — these functions deliberately see every org, which is exactly
 * why the router keeps them behind `requireSuperAdmin`.
 */

type LeanOrg = IOrganization & { _id: unknown; createdAt: Date };

type LeanUser = {
  _id: unknown;
  name: UserName;
  email: string;
  emailVerified: boolean;
  platformRole: IUser['platformRole'];
  status: IUser['status'];
  preferredLocale: IUser['preferredLocale'];
  phone?: string | null;
  jobTitle?: string | null;
  lastLoginAt?: Date;
  createdAt: Date;
};

function toUserRow(user: LeanUser, membershipCount: number): PlatformUserRow {
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    platformRole: user.platformRole,
    status: user.status,
    preferredLocale: user.preferredLocale,
    phone: user.phone ?? null,
    jobTitle: user.jobTitle ?? null,
    membershipCount,
    lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getStats(): Promise<PlatformStats> {
  const [users, organizations, properties, locations, activeMemberships] = await Promise.all([
    User.countDocuments(),
    Organization.countDocuments(),
    Property.countDocuments(),
    Location.countDocuments(),
    Membership.countDocuments({ status: 'active' }),
  ]);
  return { users, organizations, properties, locations, activeMemberships };
}

// ── Organizations ─────────────────────────────────────────────────────────────

const GROUP_BY_ORG = { $group: { _id: '$orgId', n: { $sum: 1 } } };

type OrgCount = { _id: unknown; n: number };

function toCountMap(rows: OrgCount[]): Map<string, number> {
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/** Decorates a page of orgs with their property/location/member counts. */
async function withOrgCounts(orgs: LeanOrg[]): Promise<PlatformOrganizationRow[]> {
  const orgIds = orgs.map((o) => o._id);
  const [properties, locations, members] = await Promise.all([
    Property.aggregate<OrgCount>([{ $match: { orgId: { $in: orgIds } } }, GROUP_BY_ORG]),
    Location.aggregate<OrgCount>([{ $match: { orgId: { $in: orgIds } } }, GROUP_BY_ORG]),
    Membership.aggregate<OrgCount>([
      { $match: { orgId: { $in: orgIds }, status: 'active' } },
      GROUP_BY_ORG,
    ]),
  ]);
  const [propertyCounts, locationCounts, memberCounts] = [properties, locations, members].map(
    toCountMap
  );

  return orgs.map((org) => {
    const id = String(org._id);
    return {
      _id: id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      locales: org.locales,
      createdAt: new Date(org.createdAt).toISOString(),
      counts: {
        properties: propertyCounts.get(id) ?? 0,
        locations: locationCounts.get(id) ?? 0,
        members: memberCounts.get(id) ?? 0,
      },
    };
  });
}

export async function listOrganizations(
  query: PlatformListQuery
): Promise<PaginatedResponse<PlatformOrganizationRow>> {
  const filter: Record<string, unknown> = {};
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { slug: rx }];
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    Organization.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
    Organization.countDocuments(filter),
  ]);

  return {
    items: await withOrgCounts(rows as LeanOrg[]),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function createOrganizationForOwner(
  input: PlatformCreateOrganizationInput
): Promise<OrganizationSummary> {
  const owner = await User.findOne({ email: input.ownerEmail }).select('_id status').lean();
  if (!owner) {
    throw new AppError('No account exists for that email — the owner must sign up first.', 404);
  }
  if (owner.status === 'suspended') {
    throw new AppError('That account is suspended and cannot own an organization.', 409);
  }

  return createOrgWithOwner(String(owner._id), { name: input.name, locales: input.locales });
}

export async function getOrganizationDetail(orgId: string): Promise<PlatformOrganizationDetail> {
  const org = await Organization.findById(orgId).lean();
  if (!org) throw new AppError('Organization not found', 404);

  const [properties, locations, memberships] = await Promise.all([
    Property.find({ orgId }).sort({ name: 1 }).lean(),
    Location.find({ orgId }).sort({ name: 1 }).lean(),
    Membership.find({ orgId, status: { $ne: 'revoked' } })
      .populate('userId', 'name email')
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const [row] = await withOrgCounts([org as LeanOrg]);

  return {
    org: row,
    properties: properties.map(shapeProperty),
    locations: locations.map(shapeLocation),
    members: memberships
      .filter((m) => m.userId) // a user deleted out from under a stale membership
      .map((m) => {
        const user = m.userId as unknown as { _id: unknown; name: UserName; email: string };
        const propertyId = m.propertyId ? String(m.propertyId) : null;
        const locationId = m.locationId ? String(m.locationId) : null;
        return {
          membershipId: String(m._id),
          role: m.role,
          status: m.status,
          tier: tierOf({ propertyId, locationId }),
          propertyId,
          locationId,
          user: { _id: String(user._id), name: user.name, email: user.email },
        };
      }),
  };
}

export async function updateOrganization(
  orgId: string,
  input: PlatformUpdateOrganizationInput
): Promise<OrganizationSummary> {
  // `en` is the authoring locale and always present — same rule as org creation.
  const patch =
    input.locales && !input.locales.includes('en')
      ? { ...input, locales: ['en', ...input.locales] }
      : input;

  const org = await Organization.findByIdAndUpdate(orgId, patch, {
    new: true,
    runValidators: true,
  }).lean();
  if (!org) throw new AppError('Organization not found', 404);

  return { _id: String(org._id), name: org.name, slug: org.slug, status: org.status };
}

// ── Users ─────────────────────────────────────────────────────────────────────

/** Active-membership count per user, for the user list's "orgs" column. */
async function membershipCountByUser(userIds: unknown[]): Promise<Map<string, number>> {
  const rows = await Membership.aggregate<OrgCount>([
    { $match: { userId: { $in: userIds }, status: 'active' } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);
  return toCountMap(rows);
}

export async function listUsers(
  query: PlatformListQuery
): Promise<PaginatedResponse<PlatformUserRow>> {
  const filter: Record<string, unknown> = {};
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ email: rx }, { 'name.first': rx }, { 'name.last': rx }];
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    User.find(filter)
      .select(SAFE_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const counts = await membershipCountByUser(rows.map((u) => u._id));

  return {
    items: rows.map((u) => toUserRow(u as unknown as LeanUser, counts.get(String(u._id)) ?? 0)),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function updateUser(
  actorId: string,
  userId: string,
  input: PlatformUpdateUserInput
): Promise<PlatformUserRow> {
  // A superAdmin must not be able to lock themselves out: any suspension or
  // demotion is done by *another* superAdmin, so one always remains standing.
  if (actorId === userId && (input.status === 'suspended' || input.platformRole === 'user')) {
    throw new AppError('You cannot suspend or demote your own account', 409);
  }

  const user = await User.findByIdAndUpdate(userId, input, { new: true, runValidators: true })
    .select(SAFE_USER_FIELDS)
    .lean();
  if (!user) throw new AppError('User not found', 404);

  const count = await Membership.countDocuments({ userId: user._id, status: 'active' });
  return toUserRow(user as unknown as LeanUser, count);
}
