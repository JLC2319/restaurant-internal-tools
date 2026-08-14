import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { connectToTestDb, disconnectTestDb } from './db';
import { Media } from '../../features/media/media.model';

/**
 * Full HTTP round-trips for the profile surface: PATCH /api/auth/me (the new
 * phone/jobTitle fields), the org profile (GET/PATCH /api/tenancy/organization
 * with logo/address/contact), and the shaped member roster — including the
 * role gates and tenant isolation both must enforce.
 */

beforeAll(async () => {
  await connectToTestDb('tenancy');
}, 120_000);

afterAll(async () => {
  await disconnectTestDb();
});

const PASSWORD = 'a-long-enough-password';

async function registerAndLogin(email: string): Promise<{ token: string; userId: string }> {
  const registered = await request(app)
    .post('/api/auth/register')
    .send({ name: { first: 'Test', last: 'User' }, email, password: PASSWORD });
  expect(registered.status).toBe(201);

  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { token: login.body.token, userId: login.body.user._id };
}

async function createOrg(token: string, name: string): Promise<string> {
  const response = await request(app)
    .post('/api/tenancy/organizations')
    .set('Authorization', `Bearer ${token}`)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body._id;
}

/** Registers a fresh account and invites it into the org at `role`. */
async function addMember(
  ownerToken: string,
  orgId: string,
  email: string,
  role: string,
  scope: { propertyId?: string; locationId?: string } = {},
): Promise<{ token: string; userId: string }> {
  const account = await registerAndLogin(email);
  const invited = await request(app)
    .post('/api/tenancy/members')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('X-Org-Id', orgId)
    .send({ email, role, ...scope });
  expect(invited.status).toBe(201);
  return account;
}

async function createProperty(ownerToken: string, orgId: string, name: string): Promise<string> {
  const response = await request(app)
    .post('/api/tenancy/properties')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('X-Org-Id', orgId)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body._id;
}

/** Shorthand: an authed, scoped request agent. */
function as(token: string, orgId: string, propertyId?: string) {
  const headers = (r: request.Test) => {
    r.set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId);
    if (propertyId) r.set('X-Property-Id', propertyId);
    return r;
  };
  return {
    get: (path: string) => headers(request(app).get(path)),
    post: (path: string) => headers(request(app).post(path)),
    patch: (path: string) => headers(request(app).patch(path)),
    delete: (path: string) => headers(request(app).delete(path)),
  };
}

/** Inserts a photo Media record directly — the R2 binary is irrelevant here. */
async function insertPhoto(orgId: string, userId: string): Promise<string> {
  const asset = await Media.create({
    scope: { orgId, propertyId: null, locationId: null },
    kind: 'photo',
    status: 'ready',
    key: `${orgId}/_/_/${Math.random().toString(16).slice(2)}.jpg`,
    mime: 'image/jpeg',
    size: 1234,
    width: 100,
    height: 100,
    uploadedBy: userId,
  });
  return String(asset._id);
}

describe('user profile (PATCH /api/auth/me)', () => {
  it('round-trips phone and job title, and clears them with null', async () => {
    const { token } = await registerAndLogin('profile-fields@example.com');

    const updated = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '555-0100', jobTitle: 'Sous Chef', preferredLocale: 'es' });
    expect(updated.status).toBe(200);
    expect(updated.body.phone).toBe('555-0100');
    expect(updated.body.jobTitle).toBe('Sous Chef');
    expect(updated.body.preferredLocale).toBe('es');

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.phone).toBe('555-0100');
    expect(me.body.jobTitle).toBe('Sous Chef');

    const cleared = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: null, jobTitle: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.phone).toBeNull();
    expect(cleared.body.jobTitle).toBeNull();
  });

  it('rejects an empty patch and never returns secret fields', async () => {
    const { token } = await registerAndLogin('profile-empty@example.com');

    const empty = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(empty.status).toBe(400);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.passwordHash).toBeUndefined();
    expect(me.body.emailVerificationToken).toBeUndefined();
  });
});

describe('organization profile', () => {
  it('returns the full profile and round-trips name, address and contact', async () => {
    const owner = await registerAndLogin('org-owner@example.com');
    const orgId = await createOrg(owner.token, 'Profile Bistro Group');

    const before = await as(owner.token, orgId).get('/api/tenancy/organization');
    expect(before.status).toBe(200);
    expect(before.body.locales).toEqual(['en', 'es']);
    expect(before.body.logo).toBeNull();
    expect(before.body.address).toBeNull();
    expect(before.body.contact).toEqual({ phone: null, email: null, website: null });

    const updated = await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({
        name: 'Profile Bistro Group LLC',
        address: {
          line1: '1 Main St',
          city: 'Austin',
          region: 'TX',
          postalCode: '78701',
          country: 'US',
        },
        contact: {
          phone: '555-0101',
          email: 'Office@Bistro.com',
          website: 'https://bistro.example',
        },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Profile Bistro Group LLC');
    expect(updated.body.address.city).toBe('Austin');
    expect(updated.body.contact.email).toBe('office@bistro.com');
    expect(updated.body.contact.website).toBe('https://bistro.example');
  });

  it('keeps English in the locale list even when a patch drops it', async () => {
    const owner = await registerAndLogin('org-locales@example.com');
    const orgId = await createOrg(owner.token, 'Locales Group');

    const updated = await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ locales: ['es'] });
    expect(updated.status).toBe(200);
    expect(updated.body.locales).toContain('en');
    expect(updated.body.locales).toContain('es');
  });

  it('refuses org edits below admin and from a property scope', async () => {
    const owner = await registerAndLogin('org-gate-owner@example.com');
    const orgId = await createOrg(owner.token, 'Gated Group');
    const propertyId = await createProperty(owner.token, orgId, 'Flagship');

    const manager = await addMember(owner.token, orgId, 'org-gate-manager@example.com', 'manager');
    const denied = await as(manager.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ name: 'Hijacked' });
    expect(denied.status).toBe(403);

    const propAdmin = await addMember(
      owner.token,
      orgId,
      'org-gate-propadmin@example.com',
      'admin',
      {
        propertyId,
      },
    );
    const deniedScoped = await as(propAdmin.token, orgId, propertyId)
      .patch('/api/tenancy/organization')
      .send({ name: 'Hijacked From Property' });
    expect(deniedScoped.status).toBe(403);

    // Reading stays open to any member — the page is visible to everyone.
    const read = await as(manager.token, orgId).get('/api/tenancy/organization');
    expect(read.status).toBe(200);
  });

  it('attaches an org-owned photo as logo and rejects a foreign one', async () => {
    const ownerA = await registerAndLogin('logo-owner-a@example.com');
    const ownerB = await registerAndLogin('logo-owner-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Logo Org A');
    const orgB = await createOrg(ownerB.token, 'Logo Org B');

    const photoA = await insertPhoto(orgA, ownerA.userId);
    const photoB = await insertPhoto(orgB, ownerB.userId);

    const attached = await as(ownerA.token, orgA)
      .patch('/api/tenancy/organization')
      .send({ logoMediaId: photoA });
    expect(attached.status).toBe(200);
    expect(attached.body.logo?._id).toBe(photoA);

    // Another org's asset must read as nonexistent, not forbidden.
    const foreign = await as(ownerA.token, orgA)
      .patch('/api/tenancy/organization')
      .send({ logoMediaId: photoB });
    expect(foreign.status).toBe(404);

    const cleared = await as(ownerA.token, orgA)
      .patch('/api/tenancy/organization')
      .send({ logoMediaId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.logo).toBeNull();
  });
});

describe('translation publish mode settings', () => {
  /** Creates a location under `propertyId` and returns its id. */
  async function createLocation(
    token: string,
    orgId: string,
    propertyId: string,
    name: string,
  ): Promise<string> {
    const response = await as(token, orgId)
      .post('/api/tenancy/locations')
      .send({ propertyId, name });
    expect(response.status).toBe(201);
    return response.body._id;
  }

  it('defaults every tier to manual, so nothing starts translating by itself', async () => {
    const owner = await registerAndLogin('tpm-default@example.com');
    const orgId = await createOrg(owner.token, 'Publish Mode Defaults');
    const propertyId = await createProperty(owner.token, orgId, 'Flagship');
    const locationId = await createLocation(owner.token, orgId, propertyId, 'Plano');

    const org = await as(owner.token, orgId).get('/api/tenancy/organization');
    expect(org.body.settings.translationPublishMode).toBe('manual');

    const tree = await as(owner.token, orgId).get('/api/tenancy/tree');
    const property = tree.body.properties.find((p: { _id: string }) => p._id === propertyId);
    const location = property.locations.find((l: { _id: string }) => l._id === locationId);
    // Children start at "inherit", not at a copy of the org's value — copying
    // would pin them and make the org setting unchangeable in effect.
    expect(property.settings.translationPublishMode).toBeNull();
    expect(location.settings.translationPublishMode).toBeNull();
  });

  it('round-trips overrides at every tier and clears them back to inherit', async () => {
    const owner = await registerAndLogin('tpm-roundtrip@example.com');
    const orgId = await createOrg(owner.token, 'Publish Mode Roundtrip');
    const propertyId = await createProperty(owner.token, orgId, 'Fast Casual');
    const locationId = await createLocation(owner.token, orgId, propertyId, 'Uptown');

    const org = await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { translationPublishMode: 'auto_review' } });
    expect(org.status).toBe(200);
    expect(org.body.settings.translationPublishMode).toBe('auto_review');

    const property = await as(owner.token, orgId)
      .patch(`/api/tenancy/properties/${propertyId}`)
      .send({ settings: { translationPublishMode: 'auto_publish' } });
    expect(property.status).toBe(200);
    expect(property.body.settings.translationPublishMode).toBe('auto_publish');

    const location = await as(owner.token, orgId)
      .patch(`/api/tenancy/locations/${locationId}`)
      .send({ settings: { translationPublishMode: 'manual' } });
    expect(location.status).toBe(200);
    expect(location.body.settings.translationPublishMode).toBe('manual');

    // null is a real value here: stop overriding, follow the parent again.
    const cleared = await as(owner.token, orgId)
      .patch(`/api/tenancy/locations/${locationId}`)
      .send({ settings: { translationPublishMode: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.translationPublishMode).toBeNull();
  });

  it('leaves the rest of a document alone when only settings are patched', async () => {
    const owner = await registerAndLogin('tpm-partial@example.com');
    const orgId = await createOrg(owner.token, 'Publish Mode Partial');

    await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ name: 'Renamed Group', locales: ['en'] });

    const patched = await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { translationPublishMode: 'auto_publish' } });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Renamed Group');
    expect(patched.body.locales).toEqual(['en']);
    expect(patched.body.settings.translationPublishMode).toBe('auto_publish');
  });

  it('rejects an unknown mode', async () => {
    const owner = await registerAndLogin('tpm-bad@example.com');
    const orgId = await createOrg(owner.token, 'Publish Mode Bad Input');

    const response = await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { translationPublishMode: 'whenever' } });
    expect(response.status).toBe(400);
  });

  // A manager may rename their restaurant; deciding that machine-translated
  // Spanish reaches the line unread is not theirs to make.
  it('lets a manager edit a location but not its publish mode', async () => {
    const owner = await registerAndLogin('tpm-owner@example.com');
    const orgId = await createOrg(owner.token, 'Publish Mode Roles');
    const propertyId = await createProperty(owner.token, orgId, 'Property');
    const locationId = await createLocation(owner.token, orgId, propertyId, 'Riverside');

    const manager = await addMember(owner.token, orgId, 'tpm-manager@example.com', 'manager', {
      propertyId,
      locationId,
    });

    const rename = await as(manager.token, orgId)
      .patch(`/api/tenancy/locations/${locationId}`)
      .send({ name: 'Riverside Grill' });
    expect(rename.status).toBe(200);

    const escalate = await as(manager.token, orgId)
      .patch(`/api/tenancy/locations/${locationId}`)
      .send({ settings: { translationPublishMode: 'auto_publish' } });
    expect(escalate.status).toBe(403);

    // And the refusal is real, not just a status code.
    const tree = await as(owner.token, orgId).get('/api/tenancy/tree');
    const location = tree.body.properties[0].locations[0];
    expect(location.settings.translationPublishMode).toBeNull();
  });

  it("never lets one org's admin touch another org's settings", async () => {
    const ownerA = await registerAndLogin('tpm-iso-a@example.com');
    const ownerB = await registerAndLogin('tpm-iso-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Isolation Org A');
    const orgB = await createOrg(ownerB.token, 'Isolation Org B');
    const propertyB = await createProperty(ownerB.token, orgB, 'B Property');

    await as(ownerB.token, orgB)
      .patch('/api/tenancy/organization')
      .send({ settings: { translationPublishMode: 'auto_publish' } });

    // Existence hiding: B's property must read as nonexistent from A, not
    // forbidden — and A's own org must be untouched by B's setting.
    const cross = await as(ownerA.token, orgA)
      .patch(`/api/tenancy/properties/${propertyB}`)
      .send({ settings: { translationPublishMode: 'manual' } });
    expect(cross.status).toBe(404);

    const orgAProfile = await as(ownerA.token, orgA).get('/api/tenancy/organization');
    expect(orgAProfile.body.settings.translationPublishMode).toBe('manual');

    const orgBProfile = await as(ownerB.token, orgB).get('/api/tenancy/organization');
    expect(orgBProfile.body.settings.translationPublishMode).toBe('auto_publish');
  });
});

describe('member roster', () => {
  it("returns shaped rows and never leaks another org's members", async () => {
    const ownerA = await registerAndLogin('roster-owner-a@example.com');
    const ownerB = await registerAndLogin('roster-owner-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Roster Org A');
    const orgB = await createOrg(ownerB.token, 'Roster Org B');
    await addMember(ownerA.token, orgA, 'roster-chef-a@example.com', 'chef');
    await addMember(ownerB.token, orgB, 'roster-chef-b@example.com', 'chef');

    const roster = await as(ownerA.token, orgA).get('/api/tenancy/members');
    expect(roster.status).toBe(200);
    expect(roster.body.items).toHaveLength(2);

    const emails = roster.body.items.map((m: { user: { email: string } }) => m.user.email);
    expect(emails).toContain('roster-owner-a@example.com');
    expect(emails).toContain('roster-chef-a@example.com');
    expect(emails).not.toContain('roster-chef-b@example.com');

    const row = roster.body.items.find(
      (m: { user: { email: string } }) => m.user.email === 'roster-chef-a@example.com',
    );
    expect(row.role).toBe('chef');
    expect(row.status).toBe('active');
    expect(row.tier).toBe('org');
    expect(row.user.name.first).toBe('Test');
    expect(row.user.jobTitle).toBeNull();
    // Identity only — the row must never carry auth material.
    expect(row.user.passwordHash).toBeUndefined();
    expect(row.user.preferredLocale).toBeUndefined();
  });

  it('gates the roster at manager and role changes at admin', async () => {
    const owner = await registerAndLogin('roster-gate-owner@example.com');
    const orgId = await createOrg(owner.token, 'Roster Gate Org');
    const staff = await addMember(owner.token, orgId, 'roster-gate-staff@example.com', 'staff');
    const manager = await addMember(
      owner.token,
      orgId,
      'roster-gate-manager@example.com',
      'manager',
    );

    const deniedStaff = await as(staff.token, orgId).get('/api/tenancy/members');
    expect(deniedStaff.status).toBe(403);

    const allowedManager = await as(manager.token, orgId).get('/api/tenancy/members');
    expect(allowedManager.status).toBe(200);

    // A manager may look but not touch.
    const staffRow = allowedManager.body.items.find(
      (m: { user: { email: string } }) => m.user.email === 'roster-gate-staff@example.com',
    );
    const deniedPatch = await as(manager.token, orgId)
      .patch(`/api/tenancy/members/${staffRow._id}`)
      .send({ role: 'chef' });
    expect(deniedPatch.status).toBe(403);
  });

  it('revoking a member shows up in the roster and blocks their access', async () => {
    const owner = await registerAndLogin('roster-revoke-owner@example.com');
    const orgId = await createOrg(owner.token, 'Roster Revoke Org');
    const chef = await addMember(owner.token, orgId, 'roster-revoke-chef@example.com', 'chef');

    const roster = await as(owner.token, orgId).get('/api/tenancy/members');
    const chefRow = roster.body.items.find(
      (m: { user: { email: string } }) => m.user.email === 'roster-revoke-chef@example.com',
    );

    const revoked = await as(owner.token, orgId).delete(`/api/tenancy/members/${chefRow._id}`);
    expect(revoked.status).toBe(204);

    const after = await as(owner.token, orgId).get('/api/tenancy/members');
    const revokedRow = after.body.items.find(
      (m: { user: { email: string } }) => m.user.email === 'roster-revoke-chef@example.com',
    );
    expect(revokedRow.status).toBe('revoked');

    // A revoked membership no longer resolves a tenant context — the org reads
    // as nonexistent to them (existence hiding, as everywhere else).
    const denied = await as(chef.token, orgId).get('/api/tenancy/members');
    expect(denied.status).toBe(404);
  });
});

describe('membership placement changes', () => {
  let owner: { token: string; userId: string };
  let orgId: string;
  let p1: string;
  let p2: string;

  async function rowFor(
    email: string,
  ): Promise<{ _id: string; propertyId: string | null; locationId: string | null; role: string }> {
    const roster = await as(owner.token, orgId).get('/api/tenancy/members');
    expect(roster.status).toBe(200);
    const row = roster.body.items.find(
      (r: { user: { email: string } | null }) => r.user?.email === email,
    );
    expect(row).toBeTruthy();
    return row;
  }

  beforeAll(async () => {
    owner = await registerAndLogin('mp-owner@example.com');
    orgId = await createOrg(owner.token, 'Move Members Org');
    p1 = await createProperty(owner.token, orgId, 'Move P1');
    p2 = await createProperty(owner.token, orgId, 'Move P2');
  }, 120_000);

  it('moves a member to a property, flipping what they can see; role rides untouched', async () => {
    const staff = await addMember(owner.token, orgId, 'mp-staff@example.com', 'staff');

    // A P2 recipe, published, so visibility is observable from the reader list.
    const recipe = await as(owner.token, orgId)
      .post('/api/recipes')
      .send({ name: 'P2 Special', content: { yield: { amount: 1, unit: 'qt' } }, propertyId: p2 });
    expect(recipe.status).toBe(201);
    // Staff are readers — they only see published lineages, so put v1 live.
    const saved = await as(owner.token, orgId)
      .post(`/api/recipes/${recipe.body._id}/versions`)
      .send({});
    expect(saved.body._id).toBeTruthy();
    const activated = await as(owner.token, orgId)
      .post(`/api/recipes/${recipe.body._id}/versions/${saved.body._id}/activate`)
      .send();
    expect(activated.status).toBe(200);

    // Org-wide staff see P2 content…
    const before = await as(staff.token, orgId).get('/api/recipes');
    expect(before.body.items.map((r: { name: string }) => r.name)).toContain('P2 Special');

    const row = await rowFor('mp-staff@example.com');
    const moved = await as(owner.token, orgId)
      .patch(`/api/tenancy/members/${row._id}`)
      .send({ propertyId: p1, locationId: null });
    expect(moved.status).toBe(204);

    // …a P1 member does not.
    const after = await as(staff.token, orgId).get('/api/recipes');
    expect(after.body.items.map((r: { name: string }) => r.name)).not.toContain('P2 Special');

    const updated = await rowFor('mp-staff@example.com');
    expect(updated.propertyId).toBe(p1);
    expect(updated.role).toBe('staff');

    // Role-only patches keep working and leave placement alone.
    const promoted = await as(owner.token, orgId)
      .patch(`/api/tenancy/members/${row._id}`)
      .send({ role: 'chef' });
    expect(promoted.status).toBe(204);
    const promotedRow = await rowFor('mp-staff@example.com');
    expect(promotedRow.role).toBe('chef');
    expect(promotedRow.propertyId).toBe(p1);
  });

  it('confines a property admin to their own subtree, both directions', async () => {
    const p1Admin = await addMember(owner.token, orgId, 'mp-p1-admin@example.com', 'admin', {
      propertyId: p1,
    });
    const orgStaff = await addMember(owner.token, orgId, 'mp-org-staff@example.com', 'staff');
    const p1Staff = await addMember(owner.token, orgId, 'mp-p1-staff@example.com', 'staff', {
      propertyId: p1,
    });

    // May not pull an org-wide member down into their property…
    const orgRow = await rowFor('mp-org-staff@example.com');
    const pullDown = await as(p1Admin.token, orgId)
      .patch(`/api/tenancy/members/${orgRow._id}`)
      .send({ propertyId: p1, locationId: null });
    expect(pullDown.status).toBe(404);

    // …nor push one of their own out to a sibling or up to the org.
    const p1Row = await rowFor('mp-p1-staff@example.com');
    expect(
      (
        await as(p1Admin.token, orgId)
          .patch(`/api/tenancy/members/${p1Row._id}`)
          .send({ propertyId: p2, locationId: null })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(p1Admin.token, orgId)
          .patch(`/api/tenancy/members/${p1Row._id}`)
          .send({ propertyId: null, locationId: null })
      ).status,
    ).toBe(404);
  });

  it('rejects malformed and clashing placements', async () => {
    await addMember(owner.token, orgId, 'mp-clash@example.com', 'staff');
    const row = await rowFor('mp-clash@example.com');

    // A location without its property is a scope no read filter can match.
    const orphanLocation = await as(owner.token, orgId)
      .patch(`/api/tenancy/members/${row._id}`)
      .send({ propertyId: null, locationId: p1 });
    expect(orphanLocation.status).toBe(400);

    // A second membership already sits at P1 for this user → the move clashes.
    const second = await as(owner.token, orgId)
      .post('/api/tenancy/members')
      .send({ email: 'mp-clash@example.com', role: 'staff', propertyId: p1 });
    expect(second.status).toBe(201);
    const clash = await as(owner.token, orgId)
      .patch(`/api/tenancy/members/${row._id}`)
      .send({ propertyId: p1, locationId: null });
    expect(clash.status).toBe(409);
  });
});
