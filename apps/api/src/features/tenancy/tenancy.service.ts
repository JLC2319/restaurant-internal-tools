import { roleAtLeast, toSlug } from '@rit/shared';
import type {
  CreateLocationInput,
  CreateOrganizationInput,
  CreatePropertyInput,
  InviteMemberInput,
  Locale,
  LocationSummary,
  MembershipSummary,
  OrganizationSummary,
  PropertySummary,
  TenantContext,
  TenantTree,
  UpdateLocationInput,
  UpdateMembershipInput,
  UpdateOrganizationInput,
  UpdatePropertyInput,
} from '@rit/shared';
import { AppError } from '../../lib/AppError';
import { assertRole, tierOf } from '../../lib/scope';
import { Organization } from './organization.model';
import { Property } from './property.model';
import { Location } from './location.model';
import { Membership } from './membership.model';
import { User } from '../auth/auth.model';

// ── Shaping ───────────────────────────────────────────────────────────────────

type Lean<T> = T & { _id: unknown };

export function shapeOrg(org: Lean<{ name: string; slug: string; status: string }>): OrganizationSummary {
  return {
    _id: String(org._id),
    name: org.name,
    slug: org.slug,
    status: org.status as OrganizationSummary['status'],
  };
}

export function shapeProperty(
  p: Lean<{ orgId: unknown; name: string; slug: string; status: string }>
): PropertySummary {
  return {
    _id: String(p._id),
    orgId: String(p.orgId),
    name: p.name,
    slug: p.slug,
    status: p.status as PropertySummary['status'],
  };
}

export function shapeLocation(
  l: Lean<{
    orgId: unknown;
    propertyId: unknown;
    name: string;
    slug: string;
    timezone: string;
    status: string;
  }>
): LocationSummary {
  return {
    _id: String(l._id),
    orgId: String(l.orgId),
    propertyId: String(l.propertyId),
    name: l.name,
    slug: l.slug,
    timezone: l.timezone,
    status: l.status as LocationSummary['status'],
  };
}

/**
 * Makes `base` unique within `scope` by appending -2, -3, … A slug collision is
 * routine (two properties both called "Flagship"), so it resolves silently
 * rather than making the caller retry with a different name.
 */
async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  const root = base || 'untitled';
  let candidate = root;
  let suffix = 1;
  while (await exists(candidate)) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}

// ── Organizations ─────────────────────────────────────────────────────────────

/**
 * Creates an org and makes the caller its owner in the same breath. An org with
 * no owner is unreachable — nobody could ever be invited into it — so the
 * membership is not optional.
 */
export async function createOrganization(
  userId: string,
  input: CreateOrganizationInput
): Promise<OrganizationSummary> {
  const slug = await uniqueSlug(input.slug ?? toSlug(input.name), async (candidate) =>
    Boolean(await Organization.exists({ slug: candidate }))
  );

  const locales: Locale[] = input.locales.includes('en')
    ? input.locales
    : ['en', ...input.locales];

  const org = await Organization.create({ name: input.name, slug, locales });

  await Membership.create({
    userId,
    orgId: org._id,
    propertyId: null,
    locationId: null,
    role: 'owner',
    status: 'active',
    joinedAt: new Date(),
  });

  return shapeOrg(org);
}

export async function getOrganization(ctx: TenantContext): Promise<OrganizationSummary> {
  const org = await Organization.findById(ctx.orgId).lean();
  if (!org) throw new AppError('Not found', 404);
  return shapeOrg(org);
}

export async function updateOrganization(
  ctx: TenantContext,
  input: UpdateOrganizationInput
): Promise<OrganizationSummary> {
  assertRole(ctx, 'admin');
  // Org settings are org-wide by definition — a property-scoped admin has no
  // business renaming the parent company.
  if (ctx.propertyId) throw new AppError('Forbidden', 403);

  const org = await Organization.findByIdAndUpdate(ctx.orgId, input, {
    new: true,
    runValidators: true,
  }).lean();
  if (!org) throw new AppError('Not found', 404);
  return shapeOrg(org);
}

/**
 * The org/property/location tree, narrowed to what the caller can see. Feeds
 * the scope switcher and the admin panel's tenant picker.
 */
export async function getTenantTree(ctx: TenantContext): Promise<TenantTree> {
  const org = await Organization.findById(ctx.orgId).lean();
  if (!org) throw new AppError('Not found', 404);

  const propertyFilter: Record<string, unknown> = { orgId: ctx.orgId };
  if (ctx.propertyId) propertyFilter._id = ctx.propertyId;

  const locationFilter: Record<string, unknown> = { orgId: ctx.orgId };
  if (ctx.propertyId) locationFilter.propertyId = ctx.propertyId;
  if (ctx.locationId) locationFilter._id = ctx.locationId;

  const [properties, locations] = await Promise.all([
    Property.find(propertyFilter).sort({ name: 1 }).lean(),
    Location.find(locationFilter).sort({ name: 1 }).lean(),
  ]);

  return {
    org: shapeOrg(org),
    properties: properties.map((p) => ({
      ...shapeProperty(p),
      locations: locations
        .filter((l) => String(l.propertyId) === String(p._id))
        .map(shapeLocation),
    })),
  };
}

// ── Properties ────────────────────────────────────────────────────────────────

export async function createProperty(
  ctx: TenantContext,
  input: CreatePropertyInput
): Promise<PropertySummary> {
  assertRole(ctx, 'admin');
  if (ctx.propertyId) throw new AppError('Forbidden', 403);

  const slug = await uniqueSlug(input.slug ?? toSlug(input.name), async (candidate) =>
    Boolean(await Property.exists({ orgId: ctx.orgId, slug: candidate }))
  );

  const property = await Property.create({ orgId: ctx.orgId, name: input.name, slug });
  return shapeProperty(property);
}

export async function listProperties(ctx: TenantContext): Promise<PropertySummary[]> {
  const filter: Record<string, unknown> = { orgId: ctx.orgId };
  if (ctx.propertyId) filter._id = ctx.propertyId;
  const properties = await Property.find(filter).sort({ name: 1 }).lean();
  return properties.map(shapeProperty);
}

export async function updateProperty(
  ctx: TenantContext,
  propertyId: string,
  input: UpdatePropertyInput
): Promise<PropertySummary> {
  assertRole(ctx, 'admin');
  if (ctx.propertyId && ctx.propertyId !== propertyId) throw new AppError('Not found', 404);

  const property = await Property.findOneAndUpdate({ _id: propertyId, orgId: ctx.orgId }, input, {
    new: true,
    runValidators: true,
  }).lean();
  if (!property) throw new AppError('Not found', 404);
  return shapeProperty(property);
}

// ── Locations ─────────────────────────────────────────────────────────────────

export async function createLocation(
  ctx: TenantContext,
  input: CreateLocationInput
): Promise<LocationSummary> {
  assertRole(ctx, 'admin');
  if (ctx.propertyId && ctx.propertyId !== input.propertyId) throw new AppError('Not found', 404);

  // The parent property is read rather than trusted from the body: `orgId` is
  // denormalised onto the location and the two must never disagree.
  const property = await Property.findOne({ _id: input.propertyId, orgId: ctx.orgId })
    .select('_id')
    .lean();
  if (!property) throw new AppError('Not found', 404);

  const slug = await uniqueSlug(input.slug ?? toSlug(input.name), async (candidate) =>
    Boolean(await Location.exists({ orgId: ctx.orgId, slug: candidate }))
  );

  const location = await Location.create({
    orgId: ctx.orgId,
    propertyId: input.propertyId,
    name: input.name,
    slug,
    timezone: input.timezone,
    address: input.address,
  });

  return shapeLocation(location);
}

export async function listLocations(
  ctx: TenantContext,
  propertyId?: string
): Promise<LocationSummary[]> {
  const filter: Record<string, unknown> = { orgId: ctx.orgId };
  if (ctx.propertyId) filter.propertyId = ctx.propertyId;
  else if (propertyId) filter.propertyId = propertyId;
  if (ctx.locationId) filter._id = ctx.locationId;

  const locations = await Location.find(filter).sort({ name: 1 }).lean();
  return locations.map(shapeLocation);
}

export async function updateLocation(
  ctx: TenantContext,
  locationId: string,
  input: UpdateLocationInput
): Promise<LocationSummary> {
  assertRole(ctx, 'manager');
  if (ctx.locationId && ctx.locationId !== locationId) throw new AppError('Not found', 404);

  const filter: Record<string, unknown> = { _id: locationId, orgId: ctx.orgId };
  if (ctx.propertyId) filter.propertyId = ctx.propertyId;

  const location = await Location.findOneAndUpdate(filter, input, {
    new: true,
    runValidators: true,
  }).lean();
  if (!location) throw new AppError('Not found', 404);
  return shapeLocation(location);
}

// ── Memberships ───────────────────────────────────────────────────────────────

/**
 * Every scope a user may act in, with the org/property/location resolved.
 * Returned at login so the web app can render the scope switcher without a
 * second round trip.
 */
export async function listMembershipsForUser(userId: string): Promise<MembershipSummary[]> {
  const memberships = await Membership.find({ userId, status: 'active' })
    .populate('orgId')
    .populate('propertyId')
    .populate('locationId')
    .lean();

  return memberships
    .filter((m) => m.orgId) // an org deleted out from under a stale membership
    .map((m) => {
      const property = m.propertyId ? shapeProperty(m.propertyId as never) : null;
      const location = m.locationId ? shapeLocation(m.locationId as never) : null;
      return {
        _id: String(m._id),
        role: m.role,
        status: m.status,
        tier: tierOf({ propertyId: property?._id ?? null, locationId: location?._id ?? null }),
        org: shapeOrg(m.orgId as never),
        property,
        location,
      };
    });
}

/** The member roster for the active scope. Identity only — never auth fields. */
export async function listMembers(ctx: TenantContext, page = 1, limit = 25) {
  assertRole(ctx, 'manager');

  const filter: Record<string, unknown> = { orgId: ctx.orgId };
  if (ctx.propertyId) filter.propertyId = ctx.propertyId;
  if (ctx.locationId) filter.locationId = ctx.locationId;

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    Membership.find(filter)
      .populate('userId', 'name email preferredLocale status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Membership.countDocuments(filter),
  ]);

  return { items: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Invites a user into a scope at or below the caller's own.
 *
 * Privilege escalation is the risk here: a manager must not be able to mint an
 * owner. `assertRole` proves the caller is at least an admin, and the second
 * check forbids granting a role more privileged than the caller's own.
 */
export async function inviteMember(
  ctx: TenantContext,
  actorId: string,
  input: InviteMemberInput
): Promise<{ membershipId: string; userExists: boolean }> {
  assertRole(ctx, 'admin');

  if (!ctx.isPlatformAdmin) {
    if (!roleAtLeast(ctx.role, input.role)) {
      throw new AppError('You cannot grant a role above your own', 403);
    }
  }

  const propertyId = input.propertyId ?? ctx.propertyId ?? null;
  const locationId = input.locationId ?? ctx.locationId ?? null;

  // Confine the invite to the caller's own subtree.
  if (ctx.propertyId && propertyId !== ctx.propertyId) throw new AppError('Not found', 404);
  if (ctx.locationId && locationId !== ctx.locationId) throw new AppError('Not found', 404);

  if (propertyId) {
    const property = await Property.exists({ _id: propertyId, orgId: ctx.orgId });
    if (!property) throw new AppError('Not found', 404);
  }
  if (locationId) {
    const location = await Location.exists({ _id: locationId, orgId: ctx.orgId, propertyId });
    if (!location) throw new AppError('Not found', 404);
  }

  const user = await User.findOne({ email: input.email }).select('_id').lean();
  if (!user) {
    // Invites for people without an account yet need the email-sending
    // infrastructure that Phase 1 does not have. Fail loudly rather than
    // silently dropping the invite.
    throw new AppError(
      'No account exists for that email. Pending-invite emails are not implemented yet.',
      501
    );
  }

  const existing = await Membership.findOne({
    userId: user._id,
    orgId: ctx.orgId,
    propertyId,
    locationId,
  }).lean();
  if (existing) throw new AppError('That user is already a member of this scope', 409);

  const membership = await Membership.create({
    userId: user._id,
    orgId: ctx.orgId,
    propertyId,
    locationId,
    role: input.role,
    // No invite email yet, so the membership is active immediately. When email
    // lands, flip this to 'invited' and add an acceptance route.
    status: 'active',
    invitedBy: actorId,
    joinedAt: new Date(),
  });

  return { membershipId: String(membership._id), userExists: true };
}

export async function updateMembership(
  ctx: TenantContext,
  membershipId: string,
  input: UpdateMembershipInput
): Promise<void> {
  assertRole(ctx, 'admin');

  const membership = await Membership.findOne({ _id: membershipId, orgId: ctx.orgId });
  if (!membership) throw new AppError('Not found', 404);

  if (!ctx.isPlatformAdmin) {
    // You may not promote above yourself, nor edit someone senior to you.
    if (!roleAtLeast(ctx.role, input.role) || !roleAtLeast(ctx.role, membership.role)) {
      throw new AppError('Forbidden', 403);
    }
  }

  // The last owner must stay an owner, or the org becomes unadministrable.
  if (membership.role === 'owner' && input.role !== 'owner') {
    const owners = await Membership.countDocuments({
      orgId: ctx.orgId,
      role: 'owner',
      status: 'active',
    });
    if (owners <= 1) throw new AppError('An organization must keep at least one owner', 409);
  }

  membership.role = input.role;
  await membership.save();
}

export async function revokeMembership(ctx: TenantContext, membershipId: string): Promise<void> {
  assertRole(ctx, 'admin');

  const membership = await Membership.findOne({ _id: membershipId, orgId: ctx.orgId });
  if (!membership) throw new AppError('Not found', 404);

  if (membership.role === 'owner') {
    const owners = await Membership.countDocuments({
      orgId: ctx.orgId,
      role: 'owner',
      status: 'active',
    });
    if (owners <= 1) throw new AppError('An organization must keep at least one owner', 409);
  }

  membership.status = 'revoked';
  await membership.save();
}
