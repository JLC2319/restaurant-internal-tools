import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../app';
import { Recipe } from '../../features/recipes/recipe.model';
import { RecipeVersion } from '../../features/recipes/recipeVersion.model';
import { RecipeTranslation } from '../../features/translations/translation.model';
import {
  sourceHashOf,
  translatableProjection,
} from '../../features/translations/translation.service';

/**
 * Full HTTP round-trips for /api/translations (and the /api/drafts gates).
 *
 * The test env has no ANTHROPIC_API_KEY, so the routes that would spend money
 * answer 503 — which is itself under test. Translation documents are seeded
 * directly with the same projection/hash helpers the service uses, so the
 * review gate, staleness and isolation paths run against real documents
 * without an LLM in the loop.
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

async function addMember(
  ownerToken: string,
  orgId: string,
  email: string,
  role: string
): Promise<{ token: string; userId: string }> {
  const account = await registerAndLogin(email);
  const invited = await request(app)
    .post('/api/tenancy/members')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('X-Org-Id', orgId)
    .send({ email, role });
  expect(invited.status).toBe(201);
  return account;
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
  };
}

function content(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'A bright dressing',
    yield: { amount: 4, unit: 'qt' },
    ingredients: [{ kind: 'item', name: 'Olive oil', quantity: { amount: 1, unit: 'cup' } }],
    steps: ['Whisk everything.', 'Season to taste.'],
    allergens: [],
    dietary: [],
    ...overrides,
  };
}

/** Creates a recipe, saves a version and sets it live. Returns the recipe id. */
async function createLiveRecipe(token: string, orgId: string, name: string): Promise<string> {
  const created = await as(token, orgId).post('/api/recipes').send({ name, content: content() });
  expect(created.status).toBe(201);
  const recipeId = created.body._id as string;

  const version = await as(token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
  expect(version.status).toBe(201);
  const activated = await as(token, orgId)
    .post(`/api/recipes/${recipeId}/versions/${version.body._id}/activate`)
    .send({});
  expect(activated.status).toBe(200);
  return recipeId;
}

/**
 * Seeds a machine translation the way requestTranslation would store one,
 * using the service's own projection/hash helpers against the live version.
 */
async function seedTranslation(
  recipeId: string,
  requestedBy: string,
  status: 'pending_review' | 'approved' = 'pending_review',
  /** Seeds the auto_publish outcome: approved with nobody behind it. */
  autoApproved = false
): Promise<void> {
  const head = await Recipe.findById(recipeId).lean();
  const version = await RecipeVersion.findById(head!.activeVersionId).lean();
  const projection = translatableProjection(head!.name, version!.content);

  await RecipeTranslation.create({
    scope: head!.scope,
    recipeId: head!._id,
    locale: 'es',
    status,
    origin: 'machine',
    sourceVersionId: head!.activeVersionId,
    sourceVersion: head!.activeVersion,
    sourceHash: sourceHashOf(projection),
    payload: {
      name: 'Vinagreta de la casa',
      description: 'Un aderezo fresco',
      ingredients: projection.ingredients.map(() => ({ name: 'Aceite de oliva', note: null })),
      steps: projection.steps.map((_, index) => `Paso ${index + 1}`),
    },
    llmModel: 'test-model',
    requestedBy,
    requestedAt: new Date(),
    approvedBy: status === 'approved' && !autoApproved ? requestedBy : null,
    approvedAt: status === 'approved' ? new Date() : null,
    autoApproved,
  });
}

describe('LLM gating (no key configured in tests)', () => {
  it('answers 503 on the translate trigger, but still serves reads and approvals', async () => {
    const owner = await registerAndLogin('tr-gate-owner@example.com');
    const orgId = await createOrg(owner.token, 'Gate Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Gate Vinaigrette');

    const trigger = await as(owner.token, orgId)
      .post(`/api/translations/recipes/${recipeId}`)
      .send({});
    expect(trigger.status).toBe(503);

    const state = await as(owner.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(state.status).toBe(200);
    expect(state.body.enabled).toBe(false);
    expect(state.body.canManage).toBe(true);
    expect(state.body.translation).toBeNull();
  });

  it('gates AI drafting the same way', async () => {
    const owner = await registerAndLogin('draft-gate-owner@example.com');
    const orgId = await createOrg(owner.token, 'Draft Gate Org');

    const config = await as(owner.token, orgId).get('/api/drafts/config');
    expect(config.status).toBe(200);
    expect(config.body.enabled).toBe(false);

    const draft = await as(owner.token, orgId).post('/api/drafts/recipes').send({});
    expect(draft.status).toBe(503);
  });

  it('refuses the money-spending routes to staff outright', async () => {
    const owner = await registerAndLogin('tr-staff-owner@example.com');
    const orgId = await createOrg(owner.token, 'Staff Gate Org');
    const staff = await addMember(owner.token, orgId, 'tr-staff@example.com', 'staff');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Staff Gate Salsa');

    expect(
      (await as(staff.token, orgId).post(`/api/translations/recipes/${recipeId}`).send({})).status
    ).toBe(403);
    expect(
      (await as(staff.token, orgId).post(`/api/translations/recipes/${recipeId}/approve`).send({}))
        .status
    ).toBe(403);
    expect((await as(staff.token, orgId).post('/api/drafts/recipes').send({})).status).toBe(403);
  });
});

describe('automatic publishing', () => {
  it('reports the mode resolved for the recipe, so the UI can say what publishing will do', async () => {
    const owner = await registerAndLogin('tr-mode-owner@example.com');
    const orgId = await createOrg(owner.token, 'Mode Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Mode Vinaigrette');

    const before = await as(owner.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(before.body.publishMode).toBe('manual');

    await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { translationPublishMode: 'auto_review' } });

    const after = await as(owner.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(after.body.publishMode).toBe('auto_review');
  });

  // SAFETY: auto-published text does reach staff — that is what the org chose —
  // but it must arrive flagged, with no approver forged onto it.
  it('serves auto-published text to staff carrying its unreviewed flag', async () => {
    const owner = await registerAndLogin('tr-auto-owner@example.com');
    const orgId = await createOrg(owner.token, 'Auto Publish Org');
    const staff = await addMember(owner.token, orgId, 'tr-auto-staff@example.com', 'staff');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Auto Vinaigrette');
    await seedTranslation(recipeId, owner.userId, 'approved', true);

    const asStaff = await as(staff.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.translation).not.toBeNull();
    expect(asStaff.body.translation.autoApproved).toBe(true);
    expect(asStaff.body.translation.approvedBy).toBeNull();
  });

  it('records a real signature when a chef confirms auto-published text', async () => {
    const owner = await registerAndLogin('tr-confirm-owner@example.com');
    const orgId = await createOrg(owner.token, 'Auto Confirm Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Confirm Vinaigrette');
    await seedTranslation(recipeId, owner.userId, 'approved', true);

    const approved = await as(owner.token, orgId)
      .post(`/api/translations/recipes/${recipeId}/approve`)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.autoApproved).toBe(false);
    expect(approved.body.approvedBy).toBe(owner.userId);
  });
});

describe('the review gate', () => {
  it('hides pending translations from staff and publishes only on approval', async () => {
    const owner = await registerAndLogin('tr-gate2-owner@example.com');
    const orgId = await createOrg(owner.token, 'Review Org');
    const staff = await addMember(owner.token, orgId, 'tr-gate2-staff@example.com', 'staff');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Review Vinaigrette');
    await seedTranslation(recipeId, owner.userId);

    // Staff: nothing until a human approves.
    const staffBefore = await as(staff.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(staffBefore.status).toBe(200);
    expect(staffBefore.body.canManage).toBe(false);
    expect(staffBefore.body.translation).toBeNull();

    // The reviewer sees the pending document.
    const chefView = await as(owner.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(chefView.body.translation.status).toBe('pending_review');
    expect(chefView.body.translation.stale).toBe(false);
    expect(chefView.body.translation.origin).toBe('machine');

    // Approve, with the sign-off recorded.
    const approved = await as(owner.token, orgId)
      .post(`/api/translations/recipes/${recipeId}/approve`)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvedBy).toBe(owner.userId);

    // Staff now read the Spanish.
    const staffAfter = await as(staff.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(staffAfter.body.translation).not.toBeNull();
    expect(staffAfter.body.translation.payload.name).toBe('Vinagreta de la casa');
  });

  it('drops an edited translation back to pending review until re-approved', async () => {
    const owner = await registerAndLogin('tr-edit-owner@example.com');
    const orgId = await createOrg(owner.token, 'Edit Org');
    const staff = await addMember(owner.token, orgId, 'tr-edit-staff@example.com', 'staff');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Edit Vinaigrette');
    await seedTranslation(recipeId, owner.userId, 'approved');

    const edited = await as(owner.token, orgId)
      .patch(`/api/translations/recipes/${recipeId}`)
      .send({
        payload: {
          name: 'Vinagreta editada',
          description: 'Un aderezo fresco',
          ingredients: [{ name: 'Aceite de oliva extra', note: null }],
          steps: ['Paso 1 editado', 'Paso 2'],
        },
      });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('pending_review');
    expect(edited.body.origin).toBe('machine_edited');

    // The edit un-published it for staff.
    const staffView = await as(staff.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(staffView.body.translation).toBeNull();

    // Misaligned edits are refused — they would caption the wrong lines.
    const misaligned = await as(owner.token, orgId)
      .patch(`/api/translations/recipes/${recipeId}`)
      .send({
        payload: {
          name: 'Vinagreta',
          description: '',
          ingredients: [],
          steps: ['Paso 1'],
        },
      });
    expect(misaligned.status).toBe(409);
  });
});

describe('staleness', () => {
  it('knocks an approved translation back when a different version goes live', async () => {
    const owner = await registerAndLogin('tr-stale-owner@example.com');
    const orgId = await createOrg(owner.token, 'Stale Org');
    const staff = await addMember(owner.token, orgId, 'tr-stale-staff@example.com', 'staff');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Stale Vinaigrette');
    await seedTranslation(recipeId, owner.userId, 'approved');

    // Change the working copy and set a new version live.
    const updated = await as(owner.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({
        content: content({
          ingredients: [{ kind: 'item', name: 'Walnut oil', quantity: { amount: 1, unit: 'cup' } }],
        }),
      });
    expect(updated.status).toBe(200);
    const v2 = await as(owner.token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(v2.status).toBe(201);
    const activated = await as(owner.token, orgId)
      .post(`/api/recipes/${recipeId}/versions/${v2.body._id}/activate`)
      .send({});
    expect(activated.status).toBe(200);

    // The activation itself knocked the approval back — encoded as data.
    const chefView = await as(owner.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(chefView.body.translation.status).toBe('pending_review');
    expect(chefView.body.translation.stale).toBe(true);

    // And staff see nothing.
    const staffView = await as(staff.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(staffView.body.translation).toBeNull();

    // Approving the stale text is refused outright.
    const approve = await as(owner.token, orgId)
      .post(`/api/translations/recipes/${recipeId}/approve`)
      .send({});
    expect(approve.status).toBe(409);
  });

  it('hides an approved translation after a rename, even without a new version', async () => {
    const owner = await registerAndLogin('tr-rename-owner@example.com');
    const orgId = await createOrg(owner.token, 'Rename Org');
    const staff = await addMember(owner.token, orgId, 'tr-rename-staff@example.com', 'staff');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Original Name');
    await seedTranslation(recipeId, owner.userId, 'approved');

    const renamed = await as(owner.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ name: 'Renamed Vinaigrette' });
    expect(renamed.status).toBe(200);

    // Read-time hash check: the reviewer sees it stale, staff see nothing.
    const chefView = await as(owner.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(chefView.body.translation.stale).toBe(true);

    const staffView = await as(staff.token, orgId).get(`/api/translations/recipes/${recipeId}`);
    expect(staffView.body.translation).toBeNull();
  });
});

describe('tenant isolation', () => {
  it("never serves one org's translation to another", async () => {
    const ownerA = await registerAndLogin('tr-iso-a@example.com');
    const ownerB = await registerAndLogin('tr-iso-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Translation Org A');
    const orgB = await createOrg(ownerB.token, 'Translation Org B');
    const recipeA = await createLiveRecipe(ownerA.token, orgA, 'A Secret Mole');
    await seedTranslation(recipeA, ownerA.userId, 'approved');

    // Org B probing org A's recipe id: existence-hiding 404, both surfaces.
    expect((await as(ownerB.token, orgB).get(`/api/translations/recipes/${recipeA}`)).status).toBe(
      404
    );
    expect(
      (await as(ownerB.token, orgB).post(`/api/translations/recipes/${recipeA}/approve`).send({}))
        .status
    ).toBe(404);
  });
});
