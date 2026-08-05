import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../app';
import { Media } from '../../features/media/media.model';

/**
 * Full HTTP round-trips for the profile surface: PATCH /api/auth/me (the new
 * phone/jobTitle fields), the org profile (GET/PATCH /api/tenancy/organization
 * with logo/address/contact), and the shaped member roster — including the
 * role gates and tenant isolation both must enforce.
 */

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
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
  scope: { propertyId?: string; locationId?: string } = {}
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
        address: { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
        contact: { phone: '555-0101', email: 'Office@Bistro.com', website: 'https://bistro.example' },
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

    const propAdmin = await addMember(owner.token, orgId, 'org-gate-propadmin@example.com', 'admin', {
      propertyId,
    });
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
      (m: { user: { email: string } }) => m.user.email === 'roster-chef-a@example.com'
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
    const manager = await addMember(owner.token, orgId, 'roster-gate-manager@example.com', 'manager');

    const deniedStaff = await as(staff.token, orgId).get('/api/tenancy/members');
    expect(deniedStaff.status).toBe(403);

    const allowedManager = await as(manager.token, orgId).get('/api/tenancy/members');
    expect(allowedManager.status).toBe(200);

    // A manager may look but not touch.
    const staffRow = allowedManager.body.items.find(
      (m: { user: { email: string } }) => m.user.email === 'roster-gate-staff@example.com'
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
      (m: { user: { email: string } }) => m.user.email === 'roster-revoke-chef@example.com'
    );

    const revoked = await as(owner.token, orgId).delete(`/api/tenancy/members/${chefRow._id}`);
    expect(revoked.status).toBe(204);

    const after = await as(owner.token, orgId).get('/api/tenancy/members');
    const revokedRow = after.body.items.find(
      (m: { user: { email: string } }) => m.user.email === 'roster-revoke-chef@example.com'
    );
    expect(revokedRow.status).toBe('revoked');

    // A revoked membership no longer resolves a tenant context — the org reads
    // as nonexistent to them (existence hiding, as everywhere else).
    const denied = await as(chef.token, orgId).get('/api/tenancy/members');
    expect(denied.status).toBe(404);
  });
});
