import {
  DEFAULT_RECIPE_PUBLISH_MODE,
  DEFAULT_TRANSLATION_PUBLISH_MODE,
  resolveRecipePublishMode,
  roleAtLeast,
  toSlug,
} from '@rit/shared';
import type {
  CreateLocationInput,
  CreateOrganizationInput,
  CreatePropertyInput,
  InviteMemberInput,
  Locale,
  LocationSummary,
  MembershipSummary,
  OrganizationProfile,
  OrganizationSummary,
  OrgMemberRow,
  PaginatedResponse,
  PropertySummary,
  RecipePublishMode,
  TenantContext,
  TenantTree,
  UpdateLocationInput,
  UpdateMembershipInput,
  TenantSettings,
  TenantSettingsOverride,
  UpdateOrganizationInput,
  UpdatePropertyInput,
} from '@rit/shared';
import { Types } from 'mongoose';
import { AppError } from '../../lib/AppError';
import { assertRole, tierOf } from '../../lib/scope';
import { Organization } from './organization.model';
import { Property } from './property.model';
import { Location } from './location.model';
import { Membership } from './membership.model';
import { User } from '../auth/auth.model';
import { Media } from '../media/media.model';
import { shapeAsset } from '../media/media.service';
import type { IOrganization, IUser } from '../../types/index';

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

/**
 * Settings as a client sees them. Documents written before a setting existed
 * have no value for it, so every field is defaulted here rather than trusted —
 * the org is the floor of inheritance and must never hand back `undefined`.
 */
function shapeSettings(settings: Partial<TenantSettings> | null | undefined): TenantSettings {
  return {
    translationPublishMode: settings?.translationPublishMode ?? DEFAULT_TRANSLATION_PUBLISH_MODE,
    recipePublishMode: settings?.recipePublishMode ?? DEFAULT_RECIPE_PUBLISH_MODE,
  };
}

/** The same, for a tier that inherits: an unset field stays `null`. */
function shapeSettingsOverride(
  settings: Partial<TenantSettingsOverride> | null | undefined
): TenantSettingsOverride {
  return {
    translationPublishMode: settings?.translationPublishMode ?? null,
    recipePublishMode: settings?.recipePublishMode ?? null,
  };
}

/**
 * Resolves `recipePublishMode` for a document living at `scope`, narrowest tier
 * first (location → property → org).
 *
 * Keyed on the **document's** scope, never the caller's `TenantContext`: a
 * property's shared recipe book must behave the same way whoever writes into
 * it, and a chef switching their active scope must not change what saving does
 * to a recipe they did not move. The mirror of `resolvePublishModeForScope` in
 * the translations service, which does the same job for that setting.
 */
export async function resolveRecipePublishModeForScope(scope: {
  orgId: unknown;
  propertyId?: unknown;
  locationId?: unknown;
}): Promise<RecipePublishMode> {
  const [org, property, location] = await Promise.all([
    Organization.findById(scope.orgId).select('settings').lean(),
    scope.propertyId ? Property.findById(scope.propertyId).select('settings').lean() : null,
    scope.locationId ? Location.findById(scope.locationId).select('settings').lean() : null,
  ]);

  return resolveRecipePublishMode(
    org?.settings?.recipePublishMode ?? DEFAULT_RECIPE_PUBLISH_MODE,
    property?.settings?.recipePublishMode ?? null,
    location?.settings?.recipePublishMode ?? null
  );
}

export function shapeProperty(
  p: Lean<{
    orgId: unknown;
    name: string;
    slug: string;
    status: string;
    settings?: Partial<TenantSettingsOverride> | null;
  }>
): PropertySummary {
  return {
    _id: String(p._id),
    orgId: String(p.orgId),
    name: p.name,
    slug: p.slug,
    status: p.status as PropertySummary['status'],
    settings: shapeSettingsOverride(p.settings),
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
    settings?: Partial<TenantSettingsOverride> | null;
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
    settings: shapeSettingsOverride(l.settings),
  };
}

/**
 * Moves a `settings` patch onto dot-notation keys of `update`.
 *
 * Handing Mongoose `{ settings: { … } }` whole REPLACES the sub-document, so a
 * client that sends one setting would silently clear every other one. Only
 * keys the client actually sent are written; `null` is a real value here
 * (an override cleared back to "inherit"), so only `undefined` is skipped.
 */
function applySettingsPatch(
  update: Record<string, unknown>,
  settings: Record<string, unknown> | undefined
): void {
  delete update.settings;
  if (!settings) return;
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) update[`settings.${key}`] = value;
  }
}

/**
 * Settings are an admin act at every tier, even where the surrounding update
 * is not. A location manager may rename their restaurant or fix its timezone;
 * deciding whether machine-translated Spanish reaches the line without anyone
 * reading it is not theirs to make.
 */
function assertMayChangeSettings(ctx: TenantContext, settings: unknown): void {
  if (settings !== undefined) assertRole(ctx, 'admin');
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

type LeanOrg = Omit<IOrganization, keyof import('mongoose').Document> & {
  _id: unknown;
  createdAt: Date;
};

/** The full org profile: summary plus locales, logo, address and contact. */
async function shapeOrgProfile(org: LeanOrg): Promise<OrganizationProfile> {
  // Resolved per read rather than stored, like recipe photos — a logo asset
  // deleted out from under the org simply renders as "no logo".
  const logoAsset = org.logoMediaId ? await Media.findById(org.logoMediaId).lean() : null;

  return {
    ...shapeOrg(org),
    locales: org.locales,
    settings: shapeSettings(org.settings),
    logo: logoAsset ? shapeAsset(logoAsset) : null,
    address: org.address
      ? {
          line1: org.address.line1 ?? null,
          line2: org.address.line2 ?? null,
          city: org.address.city ?? null,
          region: org.address.region ?? null,
          postalCode: org.address.postalCode ?? null,
          country: org.address.country ?? null,
        }
      : null,
    contact: {
      phone: org.contact?.phone ?? null,
      email: org.contact?.email ?? null,
      website: org.contact?.website ?? null,
    },
    createdAt: org.createdAt.toISOString(),
  };
}

export async function getOrganization(ctx: TenantContext): Promise<OrganizationProfile> {
  const org = await Organization.findById(ctx.orgId).lean();
  if (!org) throw new AppError('Not found', 404);
  return shapeOrgProfile(org);
}

export async function updateOrganization(
  ctx: TenantContext,
  input: UpdateOrganizationInput
): Promise<OrganizationProfile> {
  assertRole(ctx, 'admin');
  // Org settings are org-wide by definition — a property-scoped admin has no
  // business renaming the parent company.
  if (ctx.propertyId) throw new AppError('Forbidden', 403);

  const update: Record<string, unknown> = { ...input };
  applySettingsPatch(update, input.settings);

  // `en` is the authoring locale and can never be switched off — the same
  // guarantee createOrganization makes.
  if (input.locales && !input.locales.includes('en')) {
    update.locales = ['en', ...input.locales];
  }

  // The logo must be a photo this org owns. 404 (not 403) for a foreign
  // asset — existence hiding, as everywhere else.
  if (input.logoMediaId) {
    const asset = await Media.findOne({
      _id: input.logoMediaId,
      'scope.orgId': ctx.orgId,
      kind: 'photo',
    })
      .select('_id')
      .lean();
    if (!asset) throw new AppError('Logo photo not found', 404);
  }

  const org = await Organization.findByIdAndUpdate(ctx.orgId, update, {
    new: true,
    runValidators: true,
  }).lean();
  if (!org) throw new AppError('Not found', 404);
  return shapeOrgProfile(org);
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

  const update: Record<string, unknown> = { ...input };
  applySettingsPatch(update, input.settings);

  const property = await Property.findOneAndUpdate({ _id: propertyId, orgId: ctx.orgId }, update, {
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
  assertMayChangeSettings(ctx, input.settings);
  if (ctx.locationId && ctx.locationId !== locationId) throw new AppError('Not found', 404);

  const filter: Record<string, unknown> = { _id: locationId, orgId: ctx.orgId };
  if (ctx.propertyId) filter.propertyId = ctx.propertyId;

  const update: Record<string, unknown> = { ...input };
  applySettingsPatch(update, input.settings);

  const location = await Location.findOneAndUpdate(filter, update, {
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
export async function listMembers(
  ctx: TenantContext,
  page = 1,
  limit = 25
): Promise<PaginatedResponse<OrgMemberRow>> {
  assertRole(ctx, 'manager');

  const filter: Record<string, unknown> = { orgId: ctx.orgId };
  if (ctx.propertyId) filter.propertyId = ctx.propertyId;
  if (ctx.locationId) filter.locationId = ctx.locationId;

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    Membership.find(filter)
      .populate('userId', 'name email jobTitle status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Membership.countDocuments(filter),
  ]);

  const items = rows.map((m): OrgMemberRow => {
    const user = m.userId as unknown as Pick<
      IUser,
      '_id' | 'name' | 'email' | 'jobTitle' | 'status'
    > | null;
    const propertyId = m.propertyId ? String(m.propertyId) : null;
    const locationId = m.locationId ? String(m.locationId) : null;
    return {
      _id: String(m._id),
      role: m.role,
      status: m.status,
      tier: tierOf({ propertyId, locationId }),
      propertyId,
      locationId,
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
      user: user
        ? {
            _id: String(user._id),
            name: user.name,
            email: user.email,
            jobTitle: user.jobTitle ?? null,
            status: user.status,
          }
        : null,
    };
  });

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
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
    // You may not edit someone senior to you, nor promote above yourself.
    if (!roleAtLeast(ctx.role, membership.role)) throw new AppError('Forbidden', 403);
    if (input.role !== undefined && !roleAtLeast(ctx.role, input.role)) {
      throw new AppError('Forbidden', 403);
    }
  }

  if (input.role !== undefined) {
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
  }

  // A placement change is a full statement: both ids, null = the wider tier.
  if (input.propertyId !== undefined || input.locationId !== undefined) {
    const propertyId = input.propertyId ?? null;
    const locationId = input.locationId ?? null;
    if (locationId && !propertyId) {
      throw new AppError('A location-scoped membership must also name its property', 400);
    }

    if (!ctx.isPlatformAdmin) {
      // Confined to the caller's subtree twice over — where the member is now
      // AND where they are going. A property admin can neither pull an
      // org-wide member down into their property nor push one of their own
      // members out of it. 404, not 403: same existence hiding as invites.
      const currentPropertyId = membership.propertyId ? String(membership.propertyId) : null;
      const currentLocationId = membership.locationId ? String(membership.locationId) : null;
      if (
        ctx.propertyId &&
        (currentPropertyId !== ctx.propertyId || propertyId !== ctx.propertyId)
      ) {
        throw new AppError('Not found', 404);
      }
      if (
        ctx.locationId &&
        (currentLocationId !== ctx.locationId || locationId !== ctx.locationId)
      ) {
        throw new AppError('Not found', 404);
      }
    }

    if (propertyId) {
      const property = await Property.exists({ _id: propertyId, orgId: ctx.orgId });
      if (!property) throw new AppError('Not found', 404);
    }
    if (locationId) {
      const location = await Location.exists({ _id: locationId, orgId: ctx.orgId, propertyId });
      if (!location) throw new AppError('Not found', 404);
    }

    // One membership per exact scope; the unique index is the backstop.
    const clash = await Membership.exists({
      _id: { $ne: membership._id },
      userId: membership.userId,
      orgId: ctx.orgId,
      propertyId,
      locationId,
    });
    if (clash) throw new AppError('They already have a membership at that scope', 409);

    // NOTE: recipe allow-lists validate membership reach only when written.
    // Moving a member can strand their entries on recipes their new placement
    // cannot see — those entries grant nothing (the ACL only narrows scope)
    // and surface in the recipe's access panel for pruning.
    membership.propertyId = propertyId ? new Types.ObjectId(propertyId) : null;
    membership.locationId = locationId ? new Types.ObjectId(locationId) : null;
  }

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
