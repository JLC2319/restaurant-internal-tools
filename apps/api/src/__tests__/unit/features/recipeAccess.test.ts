import { describe, it, expect } from 'vitest';
import type { TenantContext, TenantRole } from '@rit/shared';
import { canBypassRecipeAccess, recipeAccessFilter } from '../../../features/recipes/recipeAccess';

const USER = 'user-1';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    userId: USER,
    orgId: 'org-1',
    propertyId: null,
    locationId: null,
    role: 'chef',
    tier: 'org',
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('canBypassRecipeAccess', () => {
  // The product decision, pinned: admin-or-above only. Director and manager
  // sit between admin and chef in rank and are deliberately NOT bypassers.
  const expected: Record<TenantRole, boolean> = {
    owner: true,
    admin: true,
    director: false,
    manager: false,
    chef: false,
    staff: false,
  };

  for (const [role, bypasses] of Object.entries(expected) as [TenantRole, boolean][]) {
    it(`${role} ${bypasses ? 'bypasses' : 'does not bypass'} the allow-list`, () => {
      expect(canBypassRecipeAccess(ctx({ role }))).toBe(bypasses);
    });
  }

  it('platform staff bypass regardless of the resolved role', () => {
    expect(canBypassRecipeAccess(ctx({ role: 'staff', isPlatformAdmin: true }))).toBe(true);
  });
});

describe('recipeAccessFilter', () => {
  it('is a no-op for bypassers', () => {
    expect(recipeAccessFilter(ctx({ role: 'admin' }))).toEqual({});
    expect(recipeAccessFilter(ctx({ role: 'owner' }))).toEqual({});
    expect(recipeAccessFilter(ctx({ role: 'staff', isPlatformAdmin: true }))).toEqual({});
  });

  // The exact three branches: unrestricted (null matches a missing field too,
  // which is what keeps pre-feature documents visible with no backfill),
  // explicitly listed, and the creator lockout guard.
  it('narrows everyone else to unrestricted, listed, or their own recipes', () => {
    const expected = {
      $or: [{ access: null }, { 'access.userIds': USER }, { createdBy: USER }],
    };
    expect(recipeAccessFilter(ctx({ role: 'chef' }))).toEqual(expected);
    expect(recipeAccessFilter(ctx({ role: 'staff' }))).toEqual(expected);
    expect(recipeAccessFilter(ctx({ role: 'manager' }))).toEqual(expected);
    expect(recipeAccessFilter(ctx({ role: 'director' }))).toEqual(expected);
  });
});
