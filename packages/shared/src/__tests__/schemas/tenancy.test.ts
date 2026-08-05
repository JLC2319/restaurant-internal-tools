import { describe, it, expect } from 'vitest';
import { inviteMemberSchema, createLocationSchema } from '../../schemas/tenancy.js';
import { toSlug } from '../../schemas/common.js';
import { roleAtLeast } from '../../types/domain.js';

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
