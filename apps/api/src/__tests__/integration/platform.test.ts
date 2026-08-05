import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../app';
import { User } from '../../features/auth/auth.model';

/**
 * Full HTTP round-trips for the superAdmin console routes. The access rule is
 * the point of most of these: /api/platform must be invisible (404) to anyone
 * who is not platform staff.
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

async function makeSuperAdmin(email: string): Promise<void> {
  await User.updateOne({ email }, { platformRole: 'superAdmin' });
}

describe('platform access', () => {
  it('answers 404 — not 403 — for an ordinary authenticated user', async () => {
    const { token } = await registerAndLogin('customer@example.com');
    const response = await request(app)
      .get('/api/platform/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
  });

  it('answers 401 with no token at all', async () => {
    const response = await request(app).get('/api/platform/stats');
    expect(response.status).toBe(401);
  });

  it('serves stats to a superAdmin', async () => {
    const { token } = await registerAndLogin('staff@example.com');
    await makeSuperAdmin('staff@example.com');

    const response = await request(app)
      .get('/api/platform/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.users).toBeGreaterThanOrEqual(2);
    expect(response.body.organizations).toBe(0);
  });
});

describe('platform organizations', () => {
  it('creates an org owned by the named account, then lists and reads it', async () => {
    const { token } = await registerAndLogin('provisioner@example.com');
    await makeSuperAdmin('provisioner@example.com');
    const owner = await registerAndLogin('org-owner@example.com');

    const created = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Craig Restaurant Group', ownerEmail: 'org-owner@example.com' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('craig-restaurant-group');

    const list = await request(app)
      .get('/api/platform/organizations?q=craig')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].counts.members).toBe(1);

    const detail = await request(app)
      .get(`/api/platform/organizations/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.members).toHaveLength(1);
    expect(detail.body.members[0].role).toBe('owner');
    expect(detail.body.members[0].user._id).toBe(owner.userId);

    // The freshly-minted owner really can act in the org through tenant routes.
    const asOwner = await request(app)
      .get('/api/tenancy/organization')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Org-Id', created.body._id);
    expect(asOwner.status).toBe(200);
  });

  it('refuses to create an org for an email with no account', async () => {
    const { token } = await registerAndLogin('provisioner2@example.com');
    await makeSuperAdmin('provisioner2@example.com');

    const response = await request(app)
      .post('/api/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost Group', ownerEmail: 'nobody@example.com' });
    expect(response.status).toBe(404);
  });
});

describe('platform users', () => {
  it('suspends another user, after which their token stops working', async () => {
    const admin = await registerAndLogin('staff2@example.com');
    await makeSuperAdmin('staff2@example.com');
    const victim = await registerAndLogin('to-suspend@example.com');

    const response = await request(app)
      .patch(`/api/platform/users/${victim.userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'suspended' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('suspended');

    const asVictim = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${victim.token}`);
    expect(asVictim.status).toBe(403);
  });

  it('refuses to let a superAdmin suspend or demote themselves', async () => {
    const admin = await registerAndLogin('staff3@example.com');
    await makeSuperAdmin('staff3@example.com');

    const suspend = await request(app)
      .patch(`/api/platform/users/${admin.userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'suspended' });
    expect(suspend.status).toBe(409);

    const demote = await request(app)
      .patch(`/api/platform/users/${admin.userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ platformRole: 'user' });
    expect(demote.status).toBe(409);
  });

  it('searches users by email fragment', async () => {
    const admin = await registerAndLogin('staff4@example.com');
    await makeSuperAdmin('staff4@example.com');

    const response = await request(app)
      .get('/api/platform/users?q=to-suspend')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].email).toBe('to-suspend@example.com');
  });
});
