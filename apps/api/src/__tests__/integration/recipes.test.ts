import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { connectToTestDb, disconnectTestDb } from './db';
import { Recipe } from '../../features/recipes/recipe.model';

/**
 * Full HTTP round-trips for /api/recipes: tenant isolation, the staff/chef
 * visibility split, version numbering and immutability, restore, cycle
 * rejection, fork scope stamping, and the allergen sign-off lifecycle.
 */

beforeAll(async () => {
  await connectToTestDb('recipes');
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

async function createLocation(
  ownerToken: string,
  orgId: string,
  propertyId: string,
  name: string,
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
    put: (path: string) =>
      request(app).put(path).set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId),
    delete: (path: string) =>
      request(app).delete(path).set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId),
  };
}

async function createRecipe(
  token: string,
  orgId: string,
  name: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const response = await as(token, orgId)
    .post('/api/recipes')
    .send({ name, content: content(), ...body });
  expect(response.status).toBe(201);
  return response.body._id;
}

describe('tenant isolation', () => {
  it("never leaks one org's recipes to another", async () => {
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
      'pending_review',
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
      `/api/recipes/${recipeId}/versions/${v1.body._id}`,
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
    const forked = await as(owner.token, orgId).post(`/api/recipes/${unpublished}/fork`).send({});
    expect(forked.status).toBe(409);
  });

  it("refuses a fork outside the caller's write scope", async () => {
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
    expect(activeList.body.items.find((r: { _id: string }) => r._id === sub)).toBeUndefined();

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
    expect(
      (await as(owner.token, orgId).post(`/api/recipes/${recipeId}/publish`).send({})).status,
    ).toBe(200);

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

  it("resolves the mode from the recipe's scope, not the caller's", async () => {
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

describe('person-level access restriction', () => {
  let owner: { token: string; userId: string };
  let admin: { token: string; userId: string };
  let manager: { token: string; userId: string };
  let chefCreator: { token: string; userId: string };
  let chefListed: { token: string; userId: string };
  let chefOutsider: { token: string; userId: string };
  let staffListed: { token: string; userId: string };
  let staffOutsider: { token: string; userId: string };
  let p2Chef: { token: string; userId: string };
  let orgId: string;
  let p1: string;
  let p2: string;
  let l1: string;
  let secretId: string;
  let secretV1: string;

  async function publish(token: string, recipeId: string): Promise<string> {
    const saved = await as(token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(saved.body._id).toBeTruthy();
    const activated = await as(token, orgId)
      .post(`/api/recipes/${recipeId}/versions/${saved.body._id}/activate`)
      .send();
    expect(activated.status).toBe(200);
    return saved.body._id;
  }

  async function restrict(
    token: string,
    recipeId: string,
    userIds: string[],
  ): Promise<request.Response> {
    return as(token, orgId).put(`/api/recipes/${recipeId}/access`).send({ access: { userIds } });
  }

  beforeAll(async () => {
    owner = await registerAndLogin('acl-owner@example.com');
    orgId = await createOrg(owner.token, 'ACL Org');
    p1 = await createProperty(owner.token, orgId, 'Sixty Vines');
    p2 = await createProperty(owner.token, orgId, 'Whiskey Cake');
    l1 = await createLocation(owner.token, orgId, p1, 'Sixty Vines Dallas');

    admin = await addMember(owner.token, orgId, 'acl-admin@example.com', 'admin');
    manager = await addMember(owner.token, orgId, 'acl-manager@example.com', 'manager');
    chefCreator = await addMember(owner.token, orgId, 'acl-creator@example.com', 'chef');
    chefListed = await addMember(owner.token, orgId, 'acl-listed@example.com', 'chef');
    chefOutsider = await addMember(owner.token, orgId, 'acl-outsider@example.com', 'chef');
    staffListed = await addMember(owner.token, orgId, 'acl-staff-listed@example.com', 'staff', {
      propertyId: p1,
      locationId: l1,
    });
    staffOutsider = await addMember(owner.token, orgId, 'acl-staff-out@example.com', 'staff');
    p2Chef = await addMember(owner.token, orgId, 'acl-p2-chef@example.com', 'chef', {
      propertyId: p2,
    });

    // The fixture: an org-level recipe, published so staff can read it, then
    // restricted to one chef and one location-tier staff member. The creator
    // deliberately leaves themselves off the list.
    secretId = await createRecipe(chefCreator.token, orgId, 'Secret Demi', {
      content: content({ ingredients: [itemLine('Veal stock')], steps: ['Reduce by half.'] }),
    });
    secretV1 = await publish(chefCreator.token, secretId);
    const restricted = await restrict(chefCreator.token, secretId, [
      chefListed.userId,
      staffListed.userId,
    ]);
    expect(restricted.status).toBe(200);
    expect(restricted.body.restricted).toBe(true);
  }, 120_000);

  it('shows a restricted recipe to listed members, with reader shaping intact for staff', async () => {
    const chefList = await as(chefListed.token, orgId).get('/api/recipes');
    expect(chefList.body.items.map((r: { name: string }) => r.name)).toContain('Secret Demi');

    const staffDetail = await as(staffListed.token, orgId).get(`/api/recipes/${secretId}`);
    expect(staffDetail.status).toBe(200);
    expect(staffDetail.body.restricted).toBe(true);
    expect(staffDetail.body.activeContent).not.toBeNull();
    // Staff shaping is unchanged by the ACL: no working copy, no allow-list.
    expect(staffDetail.body.workingCopy).toBeNull();
    expect(staffDetail.body.access).toBeNull();

    const staffList = await as(staffListed.token, orgId).get('/api/recipes?live=true');
    expect(staffList.body.items.map((r: { name: string }) => r.name)).toContain('Secret Demi');
  });

  it('hides it entirely from unlisted members — list, detail, versions, writes, fork', async () => {
    const list = await as(chefOutsider.token, orgId).get('/api/recipes');
    expect(list.body.items.map((r: { name: string }) => r.name)).not.toContain('Secret Demi');

    expect((await as(chefOutsider.token, orgId).get(`/api/recipes/${secretId}`)).status).toBe(404);
    expect(
      (await as(chefOutsider.token, orgId).get(`/api/recipes/${secretId}/versions`)).status,
    ).toBe(404);
    expect(
      (await as(chefOutsider.token, orgId).get(`/api/recipes/${secretId}/versions/${secretV1}`))
        .status,
    ).toBe(404);
    expect(
      (
        await as(chefOutsider.token, orgId)
          .patch(`/api/recipes/${secretId}`)
          .send({ name: 'Stolen Demi' })
      ).status,
    ).toBe(404);
    expect(
      (await as(chefOutsider.token, orgId).post(`/api/recipes/${secretId}/fork`).send({})).status,
    ).toBe(404);
    expect((await restrict(chefOutsider.token, secretId, [chefOutsider.userId])).status).toBe(404);

    const staffList = await as(staffOutsider.token, orgId).get('/api/recipes?live=true');
    expect(staffList.body.items.map((r: { name: string }) => r.name)).not.toContain('Secret Demi');
  });

  it('does not answer name probes through ?q= for unlisted members', async () => {
    const probe = await as(chefOutsider.token, orgId).get('/api/recipes?q=Secret');
    expect(probe.body.total).toBe(0);
    const listed = await as(chefListed.token, orgId).get('/api/recipes?q=Secret');
    expect(listed.body.total).toBe(1);
  });

  it('always keeps the creator in, even when they left themselves off the list', async () => {
    const detail = await as(chefCreator.token, orgId).get(`/api/recipes/${secretId}`);
    expect(detail.status).toBe(200);
    // The creator manages it, so the allow-list itself is visible to them.
    expect(detail.body.access.userIds).toEqual(
      expect.arrayContaining([chefListed.userId, staffListed.userId]),
    );
    const rename = await as(chefCreator.token, orgId)
      .patch(`/api/recipes/${secretId}`)
      .send({ name: 'Secret Demi' });
    expect(rename.status).toBe(200);
  });

  it('lets admins and owners through, but not managers', async () => {
    const adminDetail = await as(admin.token, orgId).get(`/api/recipes/${secretId}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.restricted).toBe(true);
    expect(adminDetail.body.access).not.toBeNull();

    // Idempotent re-PUT of the same list: proves admins may manage access.
    const rePut = await restrict(admin.token, secretId, [chefListed.userId, staffListed.userId]);
    expect(rePut.status).toBe(200);

    expect((await as(owner.token, orgId).get(`/api/recipes/${secretId}`)).status).toBe(200);
    expect((await as(manager.token, orgId).get(`/api/recipes/${secretId}`)).status).toBe(404);
  });

  it('refuses access edits from listed members below chef', async () => {
    const attempt = await restrict(staffListed.token, secretId, [staffListed.userId]);
    expect(attempt.status).toBe(403);
  });

  it('rejects allow-list entries whose membership cannot see the recipe scope', async () => {
    const p1Recipe = await createRecipe(owner.token, orgId, 'P1 House Rub', { propertyId: p1 });

    // A sibling property's chef never sees a P1 recipe — listing them lies.
    const sibling = await restrict(owner.token, p1Recipe, [p2Chef.userId]);
    expect(sibling.status).toBe(400);
    expect(sibling.body.message).toMatch(/cannot see/);

    // Someone from another org entirely, ditto — even on an org-level recipe.
    const strangerOwner = await registerAndLogin('acl-stranger@example.com');
    await createOrg(strangerOwner.token, 'ACL Other Org');
    expect((await restrict(owner.token, secretId, [strangerOwner.userId])).status).toBe(400);

    // A location member below the recipe's property, and an org-wide member,
    // are both genuinely covered — accepted.
    const valid = await restrict(owner.token, p1Recipe, [staffListed.userId, chefOutsider.userId]);
    expect(valid.status).toBe(200);
    expect(valid.body.access.userIds).toHaveLength(2);
  });

  it('offers exactly the coverable people as picker candidates', async () => {
    const p1Recipe = await createRecipe(owner.token, orgId, 'P1 Staff Meal', { propertyId: p1 });
    const candidates = await as(owner.token, orgId).get(
      `/api/recipes/${p1Recipe}/access/candidates`,
    );
    expect(candidates.status).toBe(200);
    const emails = candidates.body.map((c: { email: string }) => c.email);
    expect(emails).toContain('acl-outsider@example.com'); // org-wide member
    expect(emails).toContain('acl-staff-listed@example.com'); // L1 under P1
    expect(emails).not.toContain('acl-p2-chef@example.com'); // sibling property

    // The endpoint is gated like any other read of the recipe…
    expect(
      (await as(chefOutsider.token, orgId).get(`/api/recipes/${secretId}/access/candidates`))
        .status,
    ).toBe(404);
    // …and by role.
    expect(
      (await as(staffListed.token, orgId).get(`/api/recipes/${secretId}/access/candidates`)).status,
    ).toBe(403);
  });

  it('clears the restriction with access: null', async () => {
    const dish = await createRecipe(chefCreator.token, orgId, 'Sometimes Secret');
    expect((await restrict(chefCreator.token, dish, [])).status).toBe(200);
    expect((await as(chefOutsider.token, orgId).get(`/api/recipes/${dish}`)).status).toBe(404);

    const cleared = await as(chefCreator.token, orgId)
      .put(`/api/recipes/${dish}/access`)
      .send({ access: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.restricted).toBe(false);
    expect((await as(chefOutsider.token, orgId).get(`/api/recipes/${dish}`)).status).toBe(200);
  });

  it('forks into an unrestricted lineage, and hides the origin from non-readers', async () => {
    const forked = await as(chefListed.token, orgId)
      .post(`/api/recipes/${secretId}/fork`)
      .send({ name: 'Open Demi' });
    expect(forked.status).toBe(201);
    expect(forked.body.restricted).toBe(false);
    expect(forked.body.forkedFrom.recipeId).toBe(secretId);

    // Anyone may read the fork now — but only readers of the source learn
    // where it came from; everyone else just sees "a fork of something".
    const outsiderView = await as(chefOutsider.token, orgId).get(`/api/recipes/${forked.body._id}`);
    expect(outsiderView.status).toBe(200);
    expect(outsiderView.body.isFork).toBe(true);
    expect(outsiderView.body.forkedFrom).toBeNull();

    const adminView = await as(admin.token, orgId).get(`/api/recipes/${forked.body._id}`);
    expect(adminView.body.forkedFrom?.recipeId).toBe(secretId);
  });

  it('grandfathers existing sub-recipe refs but blocks new ones', async () => {
    // Board Sauce references Secret Glaze while the glaze is still open…
    const glaze = await createRecipe(chefCreator.token, orgId, 'Secret Glaze');
    const board = await createRecipe(chefOutsider.token, orgId, 'Board Sauce', {
      content: content({ ingredients: [subLine(glaze)], steps: ['Combine.'] }),
    });
    expect((await restrict(chefCreator.token, glaze, [])).status).toBe(200);

    // …so resaving Board Sauce keeps working for its unlisted editor,
    const resave = await as(chefOutsider.token, orgId)
      .patch(`/api/recipes/${board}`)
      .send({
        content: content({ ingredients: [subLine(glaze)], steps: ['Whisk, then combine.'] }),
      });
    expect(resave.status).toBe(200);

    // the glaze's NAME still renders on the line (approved, name-only leak),
    const detail = await as(chefOutsider.token, orgId).get(`/api/recipes/${board}`);
    expect(detail.body.workingCopy.ingredients[0].name).toBe('Secret Glaze');

    // but referencing it from anywhere new answers like it does not exist.
    const probe = await as(chefOutsider.token, orgId)
      .post('/api/recipes')
      .send({
        name: 'Glaze Thief',
        content: content({ ingredients: [subLine(glaze)] }),
      });
    expect(probe.status).toBe(404);
  });

  it('gates translation reads behind the same predicate', async () => {
    expect(
      (await as(chefOutsider.token, orgId).get(`/api/translations/recipes/${secretId}?locale=es`))
        .status,
    ).toBe(404);
    expect(
      (await as(chefListed.token, orgId).get(`/api/translations/recipes/${secretId}?locale=es`))
        .status,
    ).toBe(200);
  });

  it('treats documents that predate the feature as unrestricted', async () => {
    const legacy = await createRecipe(chefCreator.token, orgId, 'Legacy Dish');
    expect((await restrict(chefCreator.token, legacy, [])).status).toBe(200);
    expect((await as(chefOutsider.token, orgId).get(`/api/recipes/${legacy}`)).status).toBe(404);

    // Strip the field entirely, as any pre-feature document stores it.
    await Recipe.updateOne({ _id: legacy }, { $unset: { access: 1 } });
    const detail = await as(chefOutsider.token, orgId).get(`/api/recipes/${legacy}`);
    expect(detail.status).toBe(200);
    expect(detail.body.restricted).toBe(false);
  });

  it('changes nothing about cross-org isolation', async () => {
    const otherOwner = await registerAndLogin('acl-other-org@example.com');
    const otherOrg = await createOrg(otherOwner.token, 'ACL Foreign Org');
    expect((await as(otherOwner.token, otherOrg).get(`/api/recipes/${secretId}`)).status).toBe(404);
  });

  it('accepts an allow-list at creation, validated the same way', async () => {
    const born = await as(chefCreator.token, orgId)
      .post('/api/recipes')
      .send({
        name: 'Born Secret',
        content: content(),
        access: { userIds: [chefListed.userId] },
      });
    expect(born.status).toBe(201);
    expect(born.body.restricted).toBe(true);
    expect((await as(chefOutsider.token, orgId).get(`/api/recipes/${born.body._id}`)).status).toBe(
      404,
    );

    const invalid = await as(owner.token, orgId)
      .post('/api/recipes')
      .send({
        name: 'Bad Bind',
        content: content(),
        propertyId: p1,
        access: { userIds: [p2Chef.userId] },
      });
    expect(invalid.status).toBe(400);
  });
});

describe('moving a recipe between scopes', () => {
  let owner: { token: string; userId: string };
  let p1Staff: { token: string; userId: string };
  let p2Staff: { token: string; userId: string };
  let p2Chef: { token: string; userId: string };
  let orgId: string;
  let p1: string;
  let p2: string;
  let l1: string;

  async function publishHere(token: string, recipeId: string): Promise<void> {
    const saved = await as(token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(saved.body._id).toBeTruthy();
    const activated = await as(token, orgId)
      .post(`/api/recipes/${recipeId}/versions/${saved.body._id}/activate`)
      .send();
    expect(activated.status).toBe(200);
  }

  function move(
    token: string,
    recipeId: string,
    placement: { propertyId: string | null; locationId: string | null },
  ) {
    return as(token, orgId).put(`/api/recipes/${recipeId}/scope`).send(placement);
  }

  beforeAll(async () => {
    owner = await registerAndLogin('mv-owner@example.com');
    orgId = await createOrg(owner.token, 'Move Recipes Org');
    p1 = await createProperty(owner.token, orgId, 'Move Vines');
    p2 = await createProperty(owner.token, orgId, 'Move Cake');
    l1 = await createLocation(owner.token, orgId, p1, 'Move Vines Dallas');
    p1Staff = await addMember(owner.token, orgId, 'mv-p1-staff@example.com', 'staff', {
      propertyId: p1,
    });
    p2Staff = await addMember(owner.token, orgId, 'mv-p2-staff@example.com', 'staff', {
      propertyId: p2,
    });
    p2Chef = await addMember(owner.token, orgId, 'mv-p2-chef@example.com', 'chef', {
      propertyId: p2,
    });
  }, 120_000);

  it('moves an org recipe into a property: siblings lose it, the new home keeps it', async () => {
    const id = await createRecipe(owner.token, orgId, 'Wandering Rub');
    await publishHere(owner.token, id);

    expect(
      (await as(p2Staff.token, orgId).get('/api/recipes')).body.items.map(
        (r: { name: string }) => r.name,
      ),
    ).toContain('Wandering Rub');

    const moved = await move(owner.token, id, { propertyId: p1, locationId: null });
    expect(moved.status).toBe(200);
    expect(moved.body.scope.propertyId).toBe(p1);

    expect(
      (await as(p1Staff.token, orgId).get('/api/recipes')).body.items.map(
        (r: { name: string }) => r.name,
      ),
    ).toContain('Wandering Rub');
    const p2View = await as(p2Staff.token, orgId).get('/api/recipes');
    expect(p2View.body.items.map((r: { name: string }) => r.name)).not.toContain('Wandering Rub');
    expect((await as(p2Staff.token, orgId).get(`/api/recipes/${id}`)).status).toBe(404);
  });

  it('rewrites version snapshots with the head, so history follows the move', async () => {
    const id = await createRecipe(owner.token, orgId, 'Climbing Stock', {
      propertyId: p1,
      locationId: l1,
    });
    await publishHere(owner.token, id);

    // Straight up: location → org-wide.
    const moved = await move(owner.token, id, { propertyId: null, locationId: null });
    expect(moved.status).toBe(200);

    // A chef at the SIBLING property can now read the lineage's history — the
    // denormalised version scopes must have moved with the head for this to
    // return anything at all.
    const versions = await as(p2Chef.token, orgId).get(`/api/recipes/${id}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body).toHaveLength(1);
  });

  it('refuses to move out from under active consumers', async () => {
    const sauce = await createRecipe(owner.token, orgId, 'Mother Sauce');
    const dish = await createRecipe(owner.token, orgId, 'Org Dish', {
      content: content({ ingredients: [subLine(sauce)] }),
    });

    const blocked = await move(owner.token, sauce, { propertyId: p1, locationId: null });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/sub-recipe/);

    // Move the consumer down first, then the sauce may follow.
    expect((await move(owner.token, dish, { propertyId: p1, locationId: null })).status).toBe(200);
    expect((await move(owner.token, sauce, { propertyId: p1, locationId: null })).status).toBe(200);

    // But not below it: the dish sits property-wide, the sauce would be
    // location-only and unreadable for the rest of the property.
    const tooDeep = await move(owner.token, sauce, { propertyId: p1, locationId: l1 });
    expect(tooDeep.status).toBe(409);
  });

  it('refuses a move that would strand what the recipe itself consumes', async () => {
    const localSub = await createRecipe(owner.token, orgId, 'P1 Base', { propertyId: p1 });
    const localDish = await createRecipe(owner.token, orgId, 'P1 Dish', {
      propertyId: p1,
      content: content({ ingredients: [subLine(localSub)] }),
    });

    const up = await move(owner.token, localDish, { propertyId: null, locationId: null });
    expect(up.status).toBe(400);
    expect(up.body.message).toMatch(/scoped below/);
  });

  it('re-validates the allow-list against the new home', async () => {
    const secret = await createRecipe(owner.token, orgId, 'Traveling Secret');
    const restricted = await as(owner.token, orgId)
      .put(`/api/recipes/${secret}/access`)
      .send({ access: { userIds: [p2Staff.userId] } });
    expect(restricted.status).toBe(200);

    // P2's staff member cannot see a P1 recipe — the list would lie there.
    const bad = await move(owner.token, secret, { propertyId: p1, locationId: null });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/cannot see/);

    // At their own property the same list is fine.
    expect((await move(owner.token, secret, { propertyId: p2, locationId: null })).status).toBe(
      200,
    );
  });

  it('gates moves at manager role and write tier', async () => {
    const id = await createRecipe(owner.token, orgId, 'Immovable Object', { propertyId: p2 });

    // Chef: right property, wrong role.
    expect((await move(p2Chef.token, id, { propertyId: null, locationId: null })).status).toBe(403);

    const p2Manager = await addMember(owner.token, orgId, 'mv-p2-manager@example.com', 'manager', {
      propertyId: p2,
    });
    // Property manager: may not move it up to the org, nor sideways.
    expect((await move(p2Manager.token, id, { propertyId: null, locationId: null })).status).toBe(
      403,
    );
    expect((await move(p2Manager.token, id, { propertyId: p1, locationId: null })).status).toBe(
      403,
    );
  });
});
