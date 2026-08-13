import { describe, it, expect } from 'vitest';
import {
  inviteMemberSchema,
  createLocationSchema,
  updateLocationSchema,
  updateOrganizationSchema,
  updatePropertySchema,
} from '../../schemas/tenancy.js';
import { toSlug } from '../../schemas/common.js';
import {
  DEFAULT_RECIPE_PUBLISH_MODE,
  DEFAULT_TRANSLATION_PUBLISH_MODE,
  NEW_ORG_RECIPE_PUBLISH_MODE,
  resolveRecipePublishMode,
  resolveTranslationPublishMode,
  roleAtLeast,
} from '../../types/domain.js';

const OID = '507f1f77bcf86cd799439011';
const OTHER_OID = '507f1f77bcf86cd799439012';

describe('inviteMemberSchema', () => {
  it('accepts an org-scoped invite with neither id', () => {
    const result = inviteMemberSchema.safeParse({ email: 'chef@example.com', role: 'director' });
    expect(result.success).toBe(true);
  });

  it('accepts a location-scoped invite that names its property', () => {
    const result = inviteMemberSchema.safeParse({
      email: 'chef@example.com',
      role: 'manager',
      propertyId: OID,
      locationId: OTHER_OID,
    });
    expect(result.success).toBe(true);
  });

  // A location without its property produces a scope no read filter can match,
  // so the membership would silently grant nothing.
  it('rejects a location-scoped invite with no property', () => {
    const result = inviteMemberSchema.safeParse({
      email: 'chef@example.com',
      role: 'manager',
      locationId: OID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['propertyId']);
  });

  it('rejects an unknown role', () => {
    const result = inviteMemberSchema.safeParse({ email: 'a@b.com', role: 'sous_chef' });
    expect(result.success).toBe(false);
  });
});

describe('createLocationSchema', () => {
  it('defaults the timezone rather than leaving it unset', () => {
    const result = createLocationSchema.safeParse({ propertyId: OID, name: '60 Vines Plano' });
    expect(result.success).toBe(true);
    expect(result.data?.timezone).toBe('America/Chicago');
  });

  it('rejects a malformed property id', () => {
    const result = createLocationSchema.safeParse({ propertyId: 'nope', name: '60 Vines Plano' });
    expect(result.success).toBe(false);
  });
});

describe('translation publish mode settings', () => {
  it('accepts a mode on the org', () => {
    const result = updateOrganizationSchema.safeParse({
      settings: { translationPublishMode: 'auto_review' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = updateOrganizationSchema.safeParse({
      settings: { translationPublishMode: 'auto_everything' },
    });
    expect(result.success).toBe(false);
  });

  // The org is the floor of inheritance: "inherit" is meaningless there and
  // would leave resolution with nothing to land on.
  it('refuses a null mode on the org but allows it on a property or location', () => {
    expect(
      updateOrganizationSchema.safeParse({ settings: { translationPublishMode: null } }).success
    ).toBe(false);
    expect(
      updatePropertySchema.safeParse({ settings: { translationPublishMode: null } }).success
    ).toBe(true);
    expect(
      updateLocationSchema.safeParse({ settings: { translationPublishMode: null } }).success
    ).toBe(true);
  });

  it('counts a settings-only patch as a change', () => {
    // The `No changes supplied` refine must see the settings key, or the one
    // field a client can send alone would always 400.
    expect(
      updatePropertySchema.safeParse({ settings: { translationPublishMode: 'manual' } }).success
    ).toBe(true);
  });
});

describe('resolveTranslationPublishMode', () => {
  it('takes the narrowest set value', () => {
    expect(resolveTranslationPublishMode('manual', 'auto_review', 'auto_publish')).toBe(
      'auto_publish'
    );
    expect(resolveTranslationPublishMode('manual', 'auto_review', null)).toBe('auto_review');
    expect(resolveTranslationPublishMode('auto_publish', null, null)).toBe('auto_publish');
  });

  it('skips an unset tier rather than stopping at it', () => {
    // A location with no override under a property with no override still
    // reaches the org — this is the common shape for a brand-new location.
    expect(resolveTranslationPublishMode('auto_review', null, null)).toBe('auto_review');
  });

  it('lets a narrower scope opt back down to manual', () => {
    expect(resolveTranslationPublishMode('auto_publish', 'manual', null)).toBe('manual');
    expect(resolveTranslationPublishMode('auto_publish', 'auto_publish', 'manual')).toBe('manual');
  });

  // Documents written before the setting existed have no value at any tier.
  it('falls back to the safe default when nothing is set anywhere', () => {
    expect(resolveTranslationPublishMode(undefined)).toBe(DEFAULT_TRANSLATION_PUBLISH_MODE);
    expect(DEFAULT_TRANSLATION_PUBLISH_MODE).toBe('manual');
  });
});

describe('recipe publish mode settings', () => {
  it('accepts a mode on the org', () => {
    const result = updateOrganizationSchema.safeParse({
      settings: { recipePublishMode: 'publish_on_save' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = updateOrganizationSchema.safeParse({
      settings: { recipePublishMode: 'publish_everything' },
    });
    expect(result.success).toBe(false);
  });

  it('refuses a null mode on the org but allows it on a property or location', () => {
    expect(
      updateOrganizationSchema.safeParse({ settings: { recipePublishMode: null } }).success
    ).toBe(false);
    expect(updatePropertySchema.safeParse({ settings: { recipePublishMode: null } }).success).toBe(
      true
    );
    expect(updateLocationSchema.safeParse({ settings: { recipePublishMode: null } }).success).toBe(
      true
    );
  });

  // Both settings must survive one patch naming only the other — the API writes
  // dot-notation keys precisely so a partial patch cannot clear its neighbour.
  it('accepts a patch naming either setting alone', () => {
    expect(
      updateLocationSchema.safeParse({ settings: { recipePublishMode: 'manual' } }).success
    ).toBe(true);
    expect(
      updateLocationSchema.safeParse({ settings: { translationPublishMode: 'manual' } }).success
    ).toBe(true);
  });
});

describe('resolveRecipePublishMode', () => {
  it('takes the narrowest set value', () => {
    expect(
      resolveRecipePublishMode('manual', 'publish_on_save', 'publish_on_save_verified')
    ).toBe('publish_on_save_verified');
    expect(resolveRecipePublishMode('manual', 'publish_on_save', null)).toBe('publish_on_save');
    expect(resolveRecipePublishMode('publish_on_save', null, null)).toBe('publish_on_save');
  });

  it('lets a narrower scope opt back out of the shortcut', () => {
    // One location that wants every recipe reviewed the slow way can say so,
    // whatever the group above it does.
    expect(resolveRecipePublishMode('publish_on_save', null, 'manual')).toBe('manual');
    expect(resolveRecipePublishMode('publish_on_save', 'manual', null)).toBe('manual');
  });

  // Orgs written before the setting existed have no value at any tier, and must
  // keep behaving the way their chefs already know.
  it('falls back to manual when nothing is set anywhere', () => {
    expect(resolveRecipePublishMode(undefined)).toBe(DEFAULT_RECIPE_PUBLISH_MODE);
    expect(DEFAULT_RECIPE_PUBLISH_MODE).toBe('manual');
  });

  // ...while a *new* org is stamped with the shortcut at creation. The split is
  // the whole reason there are two constants; collapsing them silently changes
  // behaviour for every existing tenant.
  it('starts new orgs on the shortcut', () => {
    expect(NEW_ORG_RECIPE_PUBLISH_MODE).toBe('publish_on_save');
    expect(NEW_ORG_RECIPE_PUBLISH_MODE).not.toBe(DEFAULT_RECIPE_PUBLISH_MODE);
  });
});

describe('roleAtLeast', () => {
  it('treats a more privileged role as satisfying a lower bar', () => {
    expect(roleAtLeast('admin', 'manager')).toBe(true);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });

  it('rejects a less privileged role', () => {
    expect(roleAtLeast('staff', 'chef')).toBe(false);
    expect(roleAtLeast('manager', 'director')).toBe(false);
  });
});

describe('toSlug', () => {
  it('strips accents and punctuation', () => {
    expect(toSlug('60 Vines — Plano, TX')).toBe('60-vines-plano-tx');
    expect(toSlug('Café Crème')).toBe('cafe-creme');
  });
});
