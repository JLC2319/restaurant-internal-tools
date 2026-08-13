import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../app';

/**
 * Full HTTP round-trips for /api/recipes: tenant isolation, the staff/chef
 * visibility split, version numbering and immutability, restore, cycle
 * rejection, fork scope stamping, and the allergen sign-off lifecycle.
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

async function createLocation(
  ownerToken: string,
  orgId: string,
  propertyId: string,
  name: string
): Promise<string> {
  const response = await request(app)
    .post('/api/tenancy/locations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('X-Org-Id', orgId)
    .send({ propertyId, name });
  expect(response.status).toBe(201);
  return response.body._id;
}

function content(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: '',
    yield: { amount: 4, unit: 'qt' },
    ingredients: [],
    steps: [],
    allergens: [],
    dietary: [],
    ...overrides,
  };
}

function itemLine(name: string): Record<string, unknown> {
  return { kind: 'item', name, quantity: { amount: 1, unit: 'lb' } };
}

function subLine(recipeId: string): Record<string, unknown> {
  return { kind: 'recipe', recipeId, quantity: { amount: 1, unit: 'qt' } };
}

/** Shorthand: an authed, org-scoped request agent. */
function as(token: string, orgId: string) {
  return {
    get: (path: string) =>
      request(app).get(path).set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId),
    post: (path: string) =>
      request(app).post(path).set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId),
    patch: (path: string) =>
      request(app).patch(path).set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId),
    delete: (path: string) =>
      request(app).delete(path).set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId),
  };
}

async function createRecipe(
  token: string,
  orgId: string,
  name: string,
  body: Record<string, unknown> = {}
): Promise<string> {
  const response = await as(token, orgId)
    .post('/api/recipes')
    .send({ name, content: content(), ...body });
  expect(response.status).toBe(201);
  return response.body._id;
}

describe('tenant isolation', () => {
  it('never leaks one org\'s recipes to another', async () => {
    const ownerA = await registerAndLogin('iso-owner-a@example.com');
    const ownerB = await registerAndLogin('iso-owner-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Isolation Org A');
    const orgB = await createOrg(ownerB.token, 'Isolation Org B');

    await createRecipe(ownerA.token, orgA, 'A House Vinaigrette');
    const bRecipe = await createRecipe(ownerB.token, orgB, 'B Secret Sauce');

    const list = await as(ownerA.token, orgA).get('/api/recipes');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].name).toBe('A House Vinaigrette');

    // Existence hiding: the other org's recipe id answers 404, never 403.
    const probe = await as(ownerA.token, orgA).get(`/api/recipes/${bRecipe}`);
    expect(probe.status).toBe(404);
  });
});

describe('staff vs chef visibility', () => {
  let owner: { token: string };
  let chef: { token: string };
  let staff: { token: string };
  let orgId: string;
  let recipeId: string;

  beforeAll(async () => {
    owner = await registerAndLogin('vis-owner@example.com');
    orgId = await createOrg(owner.token, 'Visibility Org');
    chef = await addMember(owner.token, orgId, 'vis-chef@example.com', 'chef');
    staff = await addMember(owner.token, orgId, 'vis-staff@example.com', 'staff');

    recipeId = await createRecipe(chef.token, orgId, 'Bourbon Glaze', {
      content: content({
        ingredients: [itemLine('Bourbon'), itemLine('Butter')],
        allergens: ['milk'],
        steps: ['Reduce bourbon by half.', 'Mount with butter.'],
      }),
    });
  });

  it('hides an unpublished recipe from staff entirely', async () => {
    const list = await as(staff.token, orgId).get('/api/recipes');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(0);

    const detail = await as(staff.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(detail.status).toBe(404);
  });

  it('refuses staff the chef-only surfaces', async () => {
    const create = await as(staff.token, orgId)
      .post('/api/recipes')
      .send({ name: 'Staff Special', content: content() });
    expect(create.status).toBe(403);

    const versions = await as(staff.token, orgId).get(`/api/recipes/${recipeId}/versions`);
    expect(versions.status).toBe(403);
  });

  it('shows staff only the active snapshot with only approved allergen tags', async () => {
    // Approve one tag, then add a second that stays pending, save + activate.
    const approve = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/allergens/approve`)
      .send({});
    expect(approve.status).toBe(200);

    const update = await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({
        content: content({
          ingredients: [itemLine('Bourbon'), itemLine('Butter')],
          allergens: ['milk', 'sulphites'],
          steps: ['Reduce bourbon by half.', 'Mount with butter.'],
        }),
      });
    expect(update.status).toBe(200);
    // Ingredients unchanged → the approved milk stamp survives; sulphites is new.
    const tags = update.body.workingCopy.allergens;
    expect(tags.find((t: { allergen: string }) => t.allergen === 'milk').status).toBe('approved');
    expect(tags.find((t: { allergen: string }) => t.allergen === 'sulphites').status).toBe(
      'pending_review'
    );

    const saved = await as(chef.token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(saved.status).toBe(201);
    const activated = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/versions/${saved.body._id}/activate`)
      .send({});
    expect(activated.status).toBe(200);

    const detail = await as(staff.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.workingCopy).toBeNull();
    expect(detail.body.activeContent).not.toBeNull();
    // Only the approved tag reaches staff, and the recipe reads unverified.
    expect(detail.body.activeContent.allergens).toHaveLength(1);
    expect(detail.body.activeContent.allergens[0].allergen).toBe('milk');
    expect(detail.body.allergensVerified).toBe(false);
  });

  it('drops staff access the moment a recipe is deactivated', async () => {
    const deactivated = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/deactivate`)
      .send({});
    expect(deactivated.status).toBe(200);

    const detail = await as(staff.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(detail.status).toBe(404);
  });
});

describe('versioning', () => {
  let chef: { token: string };
  let orgId: string;

  beforeAll(async () => {
    const owner = await registerAndLogin('ver-owner@example.com');
    orgId = await createOrg(owner.token, 'Versioning Org');
    chef = await addMember(owner.token, orgId, 'ver-chef@example.com', 'chef');
  });

  it('numbers versions sequentially and keeps snapshots immutable', async () => {
    const recipeId = await createRecipe(chef.token, orgId, 'Marinara', {
      content: content({ ingredients: [itemLine('San Marzano tomatoes')] }),
    });

    const v1 = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/versions`)
      .send({ note: 'original spec' });
    expect(v1.status).toBe(201);
    expect(v1.body.version).toBe(1);

    const v2 = await as(chef.token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(v2.body.version).toBe(2);

    // Editing the working copy afterward must not touch the snapshots.
    const update = await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ content: content({ ingredients: [itemLine('Cherry tomatoes')] }) });
    expect(update.status).toBe(200);

    const v1Detail = await as(chef.token, orgId).get(
      `/api/recipes/${recipeId}/versions/${v1.body._id}`
    );
    expect(v1Detail.status).toBe(200);
    expect(v1Detail.body.content.ingredients[0].name).toBe('San Marzano tomatoes');
    expect(v1Detail.body.note).toBe('original spec');
  });

  it('restores an old version into the working copy without minting a new one', async () => {
    const recipeId = await createRecipe(chef.token, orgId, 'Focaccia', {
      content: content({ ingredients: [itemLine('00 flour')] }),
    });
    const v1 = await as(chef.token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(v1.status).toBe(201);

    await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ content: content({ ingredients: [itemLine('Bread flour')] }) });

    const restored = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/versions/${v1.body._id}/restore`)
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.workingCopy.ingredients[0].name).toBe('00 flour');

    const versions = await as(chef.token, orgId).get(`/api/recipes/${recipeId}/versions`);
    expect(versions.body).toHaveLength(1);
  });

  it('rejects reference cycles, including self-reference', async () => {
    const a = await createRecipe(chef.token, orgId, 'Veal Stock');
    const b = await createRecipe(chef.token, orgId, 'Demi-glace');

    // A consumes B — fine.
    const aRefsB = await as(chef.token, orgId)
      .patch(`/api/recipes/${a}`)
      .send({ content: content({ ingredients: [subLine(b)] }) });
    expect(aRefsB.status).toBe(200);

    // B consuming A closes the loop.
    const bRefsA = await as(chef.token, orgId)
      .patch(`/api/recipes/${b}`)
      .send({ content: content({ ingredients: [subLine(a)] }) });
    expect(bRefsA.status).toBe(409);

    const selfRef = await as(chef.token, orgId)
      .patch(`/api/recipes/${a}`)
      .send({ content: content({ ingredients: [subLine(a)] }) });
    expect(selfRef.status).toBe(409);
  });

  it('resets allergen approvals when the ingredient list changes', async () => {
    const recipeId = await createRecipe(chef.token, orgId, 'Aioli', {
      content: content({ ingredients: [itemLine('Egg yolk')], allergens: ['eggs'] }),
    });
    const approved = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/allergens/approve`)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.workingCopy.allergens[0].status).toBe('approved');
    expect(approved.body.workingCopy.allergens[0].approvedBy).not.toBeNull();

    const update = await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({
        content: content({
          ingredients: [itemLine('Egg yolk'), itemLine('Roasted garlic')],
          allergens: ['eggs'],
        }),
      });
    expect(update.status).toBe(200);
    expect(update.body.workingCopy.allergens[0].status).toBe('pending_review');
    expect(update.body.workingCopy.allergens[0].approvedBy).toBeNull();
  });
});

describe('forking', () => {
  let owner: { token: string };
  let orgId: string;
  let propertyId: string;
  let locationId: string;
  let sourceId: string;
  let activeVersionId: string;

  beforeAll(async () => {
    owner = await registerAndLogin('fork-owner@example.com');
    orgId = await createOrg(owner.token, 'Forking Org');
    propertyId = await createProperty(owner.token, orgId, 'Fork Property');
    locationId = await createLocation(owner.token, orgId, propertyId, 'Fork Location');

    sourceId = await createRecipe(owner.token, orgId, 'House Ranch', {
      content: content({ ingredients: [itemLine('Buttermilk')], allergens: ['milk'] }),
    });
    await as(owner.token, orgId).post(`/api/recipes/${sourceId}/allergens/approve`).send({});
    const saved = await as(owner.token, orgId).post(`/api/recipes/${sourceId}/versions`).send({});
    activeVersionId = saved.body._id;
    await as(owner.token, orgId)
      .post(`/api/recipes/${sourceId}/versions/${activeVersionId}/activate`)
      .send({});
  });

  it('creates a new lineage at the target scope with allergens reset', async () => {
    const forked = await as(owner.token, orgId)
      .post(`/api/recipes/${sourceId}/fork`)
      .send({ propertyId, locationId });
    expect(forked.status).toBe(201);

    expect(forked.body.scope).toEqual({ orgId, propertyId, locationId });
    expect(forked.body.forkedFrom).toEqual({
      recipeId: sourceId,
      versionId: activeVersionId,
      version: 1,
    });
    // A fresh lineage: no versions, nothing published, safety review restarts.
    expect(forked.body.currentVersion).toBe(0);
    expect(forked.body.activeVersionId).toBeNull();
    expect(forked.body.workingCopy.allergens[0].status).toBe('pending_review');
    expect(forked.body.workingCopy.allergens[0].approvedBy).toBeNull();

    // A member pinned to a sibling location must never see the fork.
    const siblingLocation = await createLocation(owner.token, orgId, propertyId, 'Sibling');
    const sibling = await addMember(owner.token, orgId, 'fork-sibling@example.com', 'chef', {
      propertyId,
      locationId: siblingLocation,
    });
    const probe = await request(app)
      .get(`/api/recipes/${forked.body._id}`)
      .set('Authorization', `Bearer ${sibling.token}`)
      .set('X-Org-Id', orgId)
      .set('X-Property-Id', propertyId)
      .set('X-Location-Id', siblingLocation);
    expect(probe.status).toBe(404);
  });

  it('refuses to fork an unpublished recipe without a named version', async () => {
    const unpublished = await createRecipe(owner.token, orgId, 'Unpublished Idea');
    const forked = await as(owner.token, orgId)
      .post(`/api/recipes/${unpublished}/fork`)
      .send({});
    expect(forked.status).toBe(409);
  });

  it('refuses a fork outside the caller\'s write scope', async () => {
    const otherProperty = await createProperty(owner.token, orgId, 'Other Property');
    const locationChef = await addMember(owner.token, orgId, 'fork-loc-chef@example.com', 'chef', {
      propertyId,
      locationId,
    });

    const forked = await request(app)
      .post(`/api/recipes/${sourceId}/fork`)
      .set('Authorization', `Bearer ${locationChef.token}`)
      .set('X-Org-Id', orgId)
      .set('X-Property-Id', propertyId)
      .set('X-Location-Id', locationId)
      .send({ propertyId: otherProperty });
    expect(forked.status).toBe(403);
  });
});

describe('scope rules for sub-recipes', () => {
  it('rejects a broad recipe referencing a narrower one', async () => {
    const owner = await registerAndLogin('scope-owner@example.com');
    const orgId = await createOrg(owner.token, 'Scope Org');
    const propertyId = await createProperty(owner.token, orgId, 'Scope Property');
    const locationId = await createLocation(owner.token, orgId, propertyId, 'Scope Location');

    const narrow = await createRecipe(owner.token, orgId, 'Location Special Sauce', {
      propertyId,
      locationId,
    });

    // An org-level recipe referencing a location-scoped sub would be unreadable
    // for everyone outside that location.
    const broad = await as(owner.token, orgId)
      .post('/api/recipes')
      .send({
        name: 'Org Standard Burger',
        content: content({ ingredients: [subLine(narrow)] }),
      });
    expect(broad.status).toBe(400);
  });
});

describe('archival', () => {
  let owner: { token: string };
  let chef: { token: string };
  let orgId: string;

  beforeAll(async () => {
    owner = await registerAndLogin('arch-owner@example.com');
    orgId = await createOrg(owner.token, 'Archive Org');
    chef = await addMember(owner.token, orgId, 'arch-chef@example.com', 'chef');
  });

  it('guards recipes that are in use, gates on manager, and archives softly', async () => {
    const sub = await createRecipe(chef.token, orgId, 'Chili Oil');
    const consumer = await createRecipe(chef.token, orgId, 'Dan Dan Noodles', {
      content: content({ ingredients: [subLine(sub)] }),
    });

    // In use → 409, even for the owner.
    const blocked = await as(owner.token, orgId).delete(`/api/recipes/${sub}`);
    expect(blocked.status).toBe(409);

    // Drop the reference, then a chef still may not archive (manager gate)...
    await as(chef.token, orgId)
      .patch(`/api/recipes/${consumer}`)
      .send({ content: content({ ingredients: [] }) });
    const asChef = await as(chef.token, orgId).delete(`/api/recipes/${sub}`);
    expect(asChef.status).toBe(403);

    // ...but the owner can, and the recipe drops out of the active list.
    const archived = await as(owner.token, orgId).delete(`/api/recipes/${sub}`);
    expect(archived.status).toBe(204);

    const activeList = await as(chef.token, orgId).get('/api/recipes');
    expect(
      activeList.body.items.find((r: { _id: string }) => r._id === sub)
    ).toBeUndefined();

    const archivedList = await as(chef.token, orgId).get('/api/recipes?status=archived');
    expect(archivedList.body.items.map((r: { _id: string }) => r._id)).toContain(sub);

    // Editing an archived recipe is refused until it is unarchived.
    const editArchived = await as(chef.token, orgId)
      .patch(`/api/recipes/${sub}`)
      .send({ name: 'Chili Crisp' });
    expect(editArchived.status).toBe(409);

    const unarchived = await as(owner.token, orgId).post(`/api/recipes/${sub}/unarchive`).send({});
    expect(unarchived.status).toBe(200);
    expect(unarchived.body.status).toBe('active');
  });
});

/**
 * The one-step publish for brand-new recipes, and the `recipePublishMode`
 * setting that governs it. What matters here is the shape of the shortcut: it
 * mints and activates in one call, it refuses on lineages staff already cook
 * from, and it never signs off an allergen tag the chef did not tick.
 */
describe('publish on save', () => {
  /** Sets the org-wide mode. Admin-only, so this uses the owner's token. */
  async function setOrgMode(token: string, orgId: string, mode: string): Promise<void> {
    const response = await as(token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { recipePublishMode: mode } });
    expect(response.status).toBe(200);
    expect(response.body.settings.recipePublishMode).toBe(mode);
  }

  it('mints v1 and puts it in front of staff in one call', async () => {
    const owner = await registerAndLogin('pub-owner@example.com');
    const orgId = await createOrg(owner.token, 'Publish Org');
    const staff = await addMember(owner.token, orgId, 'pub-staff@example.com', 'staff');

    // A new org starts on the shortcut — that is the onboarding case it exists
    // for, and it is the one default that differs from the inheritance floor.
    const mode = await as(owner.token, orgId).get('/api/recipes/publish-mode');
    expect(mode.status).toBe(200);
    expect(mode.body.mode).toBe('publish_on_save');

    const recipeId = await createRecipe(owner.token, orgId, 'Bourbon Glaze', {
      content: content({ ingredients: [itemLine('Bourbon')], steps: ['Reduce by half'] }),
    });

    const published = await as(owner.token, orgId)
      .post(`/api/recipes/${recipeId}/publish`)
      .send({ note: 'Opening menu' });
    expect(published.status).toBe(200);
    expect(published.body.activeVersion).toBe(1);
    expect(published.body.activeVersionId).not.toBeNull();
    expect(published.body.activeContent.steps).toEqual(['Reduce by half']);

    // The version carries the note, and is the one staff read.
    const versions = await as(owner.token, orgId).get(`/api/recipes/${recipeId}/versions`);
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0].note).toBe('Opening menu');
    expect(versions.body[0].isActive).toBe(true);

    const staffView = await as(staff.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(staffView.status).toBe(200);
    expect(staffView.body.activeContent.steps).toEqual(['Reduce by half']);
  });

  it('leaves allergen tags pending when the chef does not sign off', async () => {
    const owner = await registerAndLogin('pub-nosign@example.com');
    const orgId = await createOrg(owner.token, 'No Signoff Org');
    const staff = await addMember(owner.token, orgId, 'pub-nosign-staff@example.com', 'staff');

    const recipeId = await createRecipe(owner.token, orgId, 'Cream Sauce', {
      content: content({ ingredients: [itemLine('Heavy cream')], allergens: ['milk'] }),
    });

    const published = await as(owner.token, orgId)
      .post(`/api/recipes/${recipeId}/publish`)
      .send({});
    expect(published.status).toBe(200);
    expect(published.body.workingCopy.allergens[0].status).toBe('pending_review');
    expect(published.body.workingCopy.allergens[0].approvedBy).toBeNull();
    expect(published.body.allergensVerified).toBe(false);

    // SAFETY: the recipe is live, but staff see no allergen tags and the
    // unverified flag — publishing fast must never imply a sign-off.
    const staffView = await as(staff.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(staffView.body.activeContent.allergens).toEqual([]);
    expect(staffView.body.allergensVerified).toBe(false);
  });

  it('stamps the publishing chef when they do sign off', async () => {
    const owner = await registerAndLogin('pub-sign@example.com');
    const orgId = await createOrg(owner.token, 'Signoff Org');
    const chef = await addMember(owner.token, orgId, 'pub-sign-chef@example.com', 'chef');

    const recipeId = await createRecipe(chef.token, orgId, 'Almond Cake', {
      content: content({ ingredients: [itemLine('Almond flour')], allergens: ['tree_nuts'] }),
    });

    const published = await as(chef.token, orgId)
      .post(`/api/recipes/${recipeId}/publish`)
      .send({ approveAllergens: true });
    expect(published.status).toBe(200);

    // A real signature, and the approval is inside v1 rather than a version
    // behind it — the snapshot is taken after the sign-off, not before.
    const tag = published.body.workingCopy.allergens[0];
    expect(tag.status).toBe('approved');
    expect(tag.approvedBy).toBe(chef.userId);
    expect(published.body.allergensVerified).toBe(true);
    expect(published.body.activeContent.allergens[0].status).toBe('approved');
  });

  it('refuses on a lineage staff already cook from', async () => {
    const owner = await registerAndLogin('pub-live@example.com');
    const orgId = await createOrg(owner.token, 'Already Live Org');

    const recipeId = await createRecipe(owner.token, orgId, 'House Vinaigrette');
    expect((await as(owner.token, orgId).post(`/api/recipes/${recipeId}/publish`).send({})).status).toBe(
      200
    );

    // Changing what a kitchen is already reading stays two deliberate acts.
    const second = await as(owner.token, orgId).post(`/api/recipes/${recipeId}/publish`).send({});
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already live/i);
  });

  it('refuses entirely when the scope is set to manual', async () => {
    const owner = await registerAndLogin('pub-manual@example.com');
    const orgId = await createOrg(owner.token, 'Manual Org');
    await setOrgMode(owner.token, orgId, 'manual');

    const recipeId = await createRecipe(owner.token, orgId, 'Slow Braise');
    const attempt = await as(owner.token, orgId).post(`/api/recipes/${recipeId}/publish`).send({});
    expect(attempt.status).toBe(409);

    const mode = await as(owner.token, orgId).get('/api/recipes/publish-mode');
    expect(mode.body.mode).toBe('manual');
  });

  it('requires the sign-off tick under publish_on_save_verified', async () => {
    const owner = await registerAndLogin('pub-verified@example.com');
    const orgId = await createOrg(owner.token, 'Verified Org');
    await setOrgMode(owner.token, orgId, 'publish_on_save_verified');

    const recipeId = await createRecipe(owner.token, orgId, 'Peanut Sauce', {
      content: content({ ingredients: [itemLine('Peanut butter')], allergens: ['peanuts'] }),
    });

    const unsigned = await as(owner.token, orgId).post(`/api/recipes/${recipeId}/publish`).send({});
    expect(unsigned.status).toBe(409);

    // Nothing was published, and nothing was approved on the way to failing.
    const afterFailure = await as(owner.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(afterFailure.body.activeVersionId).toBeNull();
    expect(afterFailure.body.workingCopy.allergens[0].status).toBe('pending_review');

    const signed = await as(owner.token, orgId)
      .post(`/api/recipes/${recipeId}/publish`)
      .send({ approveAllergens: true });
    expect(signed.status).toBe(200);
    expect(signed.body.activeVersion).toBe(1);
    expect(signed.body.allergensVerified).toBe(true);
  });

  it('resolves the mode from the recipe\'s scope, not the caller\'s', async () => {
    const owner = await registerAndLogin('pub-scope@example.com');
    const orgId = await createOrg(owner.token, 'Scoped Publish Org');
    const propertyId = await createProperty(owner.token, orgId, 'Downtown');
    const locationId = await createLocation(owner.token, orgId, propertyId, 'Main St');

    // The property opts out; the org keeps the shortcut.
    const patched = await as(owner.token, orgId)
      .patch(`/api/tenancy/properties/${propertyId}`)
      .send({ settings: { recipePublishMode: 'manual' } });
    expect(patched.status).toBe(200);

    const propertyRecipe = await createRecipe(owner.token, orgId, 'Property Standard', {
      propertyId,
    });
    const orgRecipe = await createRecipe(owner.token, orgId, 'Org Standard');

    // Same caller, same active scope, two different answers — because the
    // setting follows the document, not the person writing it.
    const refused = await as(owner.token, orgId)
      .post(`/api/recipes/${propertyRecipe}/publish`)
      .send({});
    expect(refused.status).toBe(409);

    const allowed = await as(owner.token, orgId).post(`/api/recipes/${orgRecipe}/publish`).send({});
    expect(allowed.status).toBe(200);

    // The detail read reports the same resolution the publish call used, so the
    // editor cannot offer a shortcut the server would refuse.
    const detail = await as(owner.token, orgId).get(`/api/recipes/${propertyRecipe}`);
    expect(detail.body.publishMode).toBe('manual');

    // A location under that property inherits the opt-out.
    const locationRecipe = await createRecipe(owner.token, orgId, 'Location Special', {
      propertyId,
      locationId,
    });
    const locationDetail = await as(owner.token, orgId).get(`/api/recipes/${locationRecipe}`);
    expect(locationDetail.body.publishMode).toBe('manual');
  });

  it('is closed to staff', async () => {
    const owner = await registerAndLogin('pub-staff-gate@example.com');
    const orgId = await createOrg(owner.token, 'Publish Gate Org');
    const staff = await addMember(owner.token, orgId, 'pub-gate-staff@example.com', 'staff');

    const recipeId = await createRecipe(owner.token, orgId, 'Staff Cannot Publish');
    const attempt = await as(staff.token, orgId).post(`/api/recipes/${recipeId}/publish`).send({});
    expect(attempt.status).toBe(403);
    expect((await as(staff.token, orgId).get('/api/recipes/publish-mode')).status).toBe(403);
  });

  it('does not let "publish-mode" be read as a recipe id', async () => {
    // Route ordering: the literal path is registered before '/:id', or this
    // would 404 as a missing recipe instead of answering.
    const owner = await registerAndLogin('pub-route@example.com');
    const orgId = await createOrg(owner.token, 'Route Org');
    const response = await as(owner.token, orgId).get('/api/recipes/publish-mode');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('mode');
  });
});
