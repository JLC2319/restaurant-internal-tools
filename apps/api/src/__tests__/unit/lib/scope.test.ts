import { describe, it, expect } from 'vitest';
import type { TenantContext } from '@rit/shared';
import { scopeReadFilter, scopeForWrite, assertCanWriteAt, assertRole, tierOf } from '../../../lib/scope';
import { AppError } from '../../../lib/AppError';

const ORG = 'org-1';
const PROP = 'prop-1';
const OTHER_PROP = 'prop-2';
const LOC = 'loc-1';
const OTHER_LOC = 'loc-2';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    orgId: ORG,
    propertyId: null,
    locationId: null,
    role: 'admin',
    tier: 'org',
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('tierOf', () => {
  it('derives the tier from which ids are present', () => {
    expect(tierOf({ propertyId: null, locationId: null })).toBe('org');
    expect(tierOf({ propertyId: PROP, locationId: null })).toBe('property');
    expect(tierOf({ propertyId: PROP, locationId: LOC })).toBe('location');
  });
});

describe('scopeReadFilter', () => {
  it('narrows an org member to their org only', () => {
    expect(scopeReadFilter(ctx())).toEqual({ 'scope.orgId': ORG });
  });

  // A property member must still see the org's shared recipe book, which is
  // why the filter is `$in: [null, id]` rather than an equality match.
  it('lets a property member see org-level content as well as their own', () => {
    expect(scopeReadFilter(ctx({ propertyId: PROP, tier: 'property' }))).toEqual({
      'scope.orgId': ORG,
      'scope.propertyId': { $in: [null, PROP] },
    });
  });

  it('confines a location member to their own location and everything above it', () => {
    expect(
      scopeReadFilter(ctx({ propertyId: PROP, locationId: LOC, tier: 'location' }))
    ).toEqual({
      'scope.orgId': ORG,
      'scope.propertyId': { $in: [null, PROP] },
      'scope.locationId': { $in: [null, LOC] },
    });
  });

  it('honours a custom scope path', () => {
    expect(scopeReadFilter(ctx(), 'template.scope')).toEqual({ 'template.scope.orgId': ORG });
  });
});

describe('assertCanWriteAt', () => {
  it('lets an org member write anywhere inside their org', () => {
    expect(() => assertCanWriteAt(ctx(), { propertyId: PROP, locationId: LOC })).not.toThrow();
  });

  it('stops a property member writing into a sibling property', () => {
    expect(() =>
      assertCanWriteAt(ctx({ propertyId: PROP, tier: 'property' }), {
        propertyId: OTHER_PROP,
        locationId: null,
      })
    ).toThrow(AppError);
  });

  it('stops a location member writing into a sibling location', () => {
    expect(() =>
      assertCanWriteAt(ctx({ propertyId: PROP, locationId: LOC, tier: 'location' }), {
        propertyId: PROP,
        locationId: OTHER_LOC,
      })
    ).toThrow(AppError);
  });

  it('lets a property member write down into their own location', () => {
    expect(() =>
      assertCanWriteAt(ctx({ propertyId: PROP, tier: 'property' }), {
        propertyId: PROP,
        locationId: LOC,
      })
    ).not.toThrow();
  });

  it('rejects a location without its parent property', () => {
    expect(() => assertCanWriteAt(ctx(), { propertyId: null, locationId: LOC })).toThrow(
      /must also name its property/
    );
  });
});

describe('scopeForWrite', () => {
  it('defaults to the caller’s own scope', () => {
    expect(scopeForWrite(ctx({ propertyId: PROP, locationId: LOC, tier: 'location' }))).toEqual({
      orgId: ORG,
      propertyId: PROP,
      locationId: LOC,
    });
  });

  it('always returns explicit nulls rather than omitting the fields', () => {
    const scope = scopeForWrite(ctx());
    expect(scope).toEqual({ orgId: ORG, propertyId: null, locationId: null });
    expect(Object.keys(scope).sort()).toEqual(['locationId', 'orgId', 'propertyId']);
  });

  it('lets an org member target a specific location', () => {
    expect(scopeForWrite(ctx(), { propertyId: PROP, locationId: LOC })).toEqual({
      orgId: ORG,
      propertyId: PROP,
      locationId: LOC,
    });
  });

  it('refuses a target outside the caller’s subtree', () => {
    expect(() =>
      scopeForWrite(ctx({ propertyId: PROP, tier: 'property' }), { propertyId: OTHER_PROP })
    ).toThrow(AppError);
  });
});

describe('assertRole', () => {
  it('accepts a role at or above the bar', () => {
    expect(() => assertRole(ctx({ role: 'admin' }), 'manager')).not.toThrow();
    expect(() => assertRole(ctx({ role: 'manager' }), 'manager')).not.toThrow();
  });

  it('rejects a role below the bar', () => {
    expect(() => assertRole(ctx({ role: 'staff' }), 'manager')).toThrow(AppError);
  });

  it('lets a platform admin through regardless', () => {
    expect(() => assertRole(ctx({ role: 'staff', isPlatformAdmin: true }), 'owner')).not.toThrow();
  });
});
