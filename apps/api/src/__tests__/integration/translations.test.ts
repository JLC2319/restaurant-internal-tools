import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { connectToTestDb, disconnectTestDb } from './db';
import { Recipe } from '../../features/recipes/recipe.model';
import { RecipeVersion } from '../../features/recipes/recipeVersion.model';
import { RecipeTranslation } from '../../features/translations/translation.model';
import {
  sourceHashOf,
  translatableProjection,
} from '../../features/translations/translation.service';
import { TrainingModule } from '../../features/training/trainingModule.model';
import { TrainingTranslation } from '../../features/translations/trainingTranslation.model';
import {
  trainingSourceHashOf,
  trainingTranslatableProjection,
} from '../../features/translations/trainingTranslation.service';

/**
 * Full HTTP round-trips for /api/translations (and the /api/drafts gates).
 *
 * The test env has no ANTHROPIC_API_KEY, so the routes that would spend money
 * answer 503 — which is itself under test. Translation documents are seeded
 * directly with the same projection/hash helpers the service uses, so the
 * review gate, staleness and isolation paths run against real documents
 * without an LLM in the loop.
 */

beforeAll(async () => {
  await connectToTestDb('translations');
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

async function addMember(
  ownerToken: string,
  orgId: string,
  email: string,
  role: string,
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
  autoApproved = false,
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
      (await as(staff.token, orgId).post(`/api/translations/recipes/${recipeId}`).send({})).status,
    ).toBe(403);
    expect(
      (await as(staff.token, orgId).post(`/api/translations/recipes/${recipeId}/approve`).send({}))
        .status,
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
      404,
    );
    expect(
      (await as(ownerB.token, orgB).post(`/api/translations/recipes/${recipeA}/approve`).send({}))
        .status,
    ).toBe(404);
  });
});

/**
 * The marker that tells a freshly-published recipe's page "Spanish is on its
 * way". What matters is that it always resolves: every path out of a run
 * clears it, and a marker left behind by a dead process ages into a failure
 * rather than a page that polls forever.
 */
describe('automatic translation status', () => {
  /** Writes the marker the way `beginAutoTranslation` does. */
  async function setMarker(
    recipeId: string,
    status: 'running' | 'failed',
    startedAt: Date,
  ): Promise<void> {
    const head = await Recipe.findById(recipeId).lean();
    await Recipe.updateOne(
      { _id: recipeId },
      { $set: { autoTranslation: { status, startedAt, versionId: head!.activeVersionId } } },
    );
  }

  async function readState(token: string, orgId: string, recipeId: string) {
    const response = await as(token, orgId).get(`/api/translations/recipes/${recipeId}?locale=es`);
    expect(response.status).toBe(200);
    return response.body as { autoTranslating: boolean; autoTranslationFailed: boolean };
  }

  it('reports neither running nor failed when nothing has been attempted', async () => {
    const owner = await registerAndLogin('auto-none@example.com');
    const orgId = await createOrg(owner.token, 'Auto None Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Untranslated Vinaigrette');

    const state = await readState(owner.token, orgId, recipeId);
    expect(state.autoTranslating).toBe(false);
    expect(state.autoTranslationFailed).toBe(false);
  });

  it('reports a fresh run as in flight, so the page polls instead of offering the button', async () => {
    const owner = await registerAndLogin('auto-running@example.com');
    const orgId = await createOrg(owner.token, 'Auto Running Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Busy Vinaigrette');
    await setMarker(recipeId, 'running', new Date());

    const state = await readState(owner.token, orgId, recipeId);
    expect(state.autoTranslating).toBe(true);
    expect(state.autoTranslationFailed).toBe(false);
  });

  it('ages a stranded run into a failure rather than polling forever', async () => {
    const owner = await registerAndLogin('auto-stranded@example.com');
    const orgId = await createOrg(owner.token, 'Auto Stranded Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Stranded Vinaigrette');
    // The job clears its own marker, so one this old means the process that
    // owned it is gone — an API restart mid-translation, say.
    await setMarker(recipeId, 'running', new Date(Date.now() - 10 * 60_000));

    const state = await readState(owner.token, orgId, recipeId);
    expect(state.autoTranslating).toBe(false);
    expect(state.autoTranslationFailed).toBe(true);
  });

  it('reports an explicit failure', async () => {
    const owner = await registerAndLogin('auto-failed@example.com');
    const orgId = await createOrg(owner.token, 'Auto Failed Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Failed Vinaigrette');
    await setMarker(recipeId, 'failed', new Date());

    const state = await readState(owner.token, orgId, recipeId);
    expect(state.autoTranslating).toBe(false);
    expect(state.autoTranslationFailed).toBe(true);
  });

  it('does not mark a run when the scope translates manually', async () => {
    // The default mode. Activating must leave no marker at all, or every
    // recipe in a manual org would poll for a translation nobody asked for.
    const owner = await registerAndLogin('auto-manual@example.com');
    const orgId = await createOrg(owner.token, 'Auto Manual Org');
    const recipeId = await createLiveRecipe(owner.token, orgId, 'Manual Vinaigrette');

    const head = await Recipe.findById(recipeId).lean();
    expect(head!.autoTranslation ?? null).toBeNull();

    const state = await readState(owner.token, orgId, recipeId);
    expect(state.autoTranslating).toBe(false);
  });
});

// ── Training translations ─────────────────────────────────────────────────────
//
// The same contract as recipes, per module: no key → the money route answers
// 503; documents are seeded with the service's own projection/hash helpers so
// the review gate and staleness run without an LLM. Modules have no version
// history, so the sourceHash of the module's text is the whole staleness story.

/** A one-paragraph rich-text document — the minimal valid text block payload. */
function textBlock(text: string): Record<string, unknown> {
  return {
    kind: 'text',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
}

/**
 * Creates a training module — one text block, one captioned embed, so the
 * translation payload exercises both the `text` and the `caption` half of a
 * block — and publishes it. Returns the module id.
 */
async function createPublishedTraining(
  token: string,
  orgId: string,
  title: string,
): Promise<string> {
  const created = await as(token, orgId)
    .post('/api/training')
    .send({
      title,
      description: 'Why we hold hot food hot.',
      blocks: [
        textBlock('Hold hot food above 135F. Check every two hours.'),
        {
          kind: 'embed',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          caption: 'Watch the walkthrough',
        },
      ],
    });
  expect(created.status).toBe(201);
  const trainingId = created.body._id as string;

  const published = await as(token, orgId).post(`/api/training/${trainingId}/publish`).send();
  expect(published.status).toBe(200);
  return trainingId;
}

/**
 * Seeds a machine training translation the way requestTrainingTranslation
 * would store one, hashing the module's current text with the service's own
 * projection helpers. Blocks align 1:1 with the module's, text-or-caption.
 */
async function seedTrainingTranslation(
  trainingId: string,
  requestedBy: string,
  status: 'pending_review' | 'approved' = 'pending_review',
  /** Seeds the auto_publish outcome: approved with nobody behind it. */
  autoApproved = false,
): Promise<void> {
  const head = await TrainingModule.findById(trainingId).lean();
  const projection = trainingTranslatableProjection(head!);

  await TrainingTranslation.create({
    scope: head!.scope,
    trainingId: head!._id,
    locale: 'es',
    status,
    origin: 'machine',
    sourceHash: trainingSourceHashOf(projection),
    payload: {
      title: 'Comida caliente, siempre caliente',
      description: 'Por qué la comida caliente se mantiene caliente',
      blocks: projection.blocks.map((block) => ({
        text: block.text === null ? null : 'Mantenga la comida caliente por encima de 135F.',
        caption: block.caption === null ? null : 'Vea el recorrido',
      })),
    },
    llmModel: 'test-model',
    requestedBy,
    requestedAt: new Date(),
    approvedBy: status === 'approved' && !autoApproved ? requestedBy : null,
    approvedAt: status === 'approved' ? new Date() : null,
    autoApproved,
  });
}

describe('training LLM gating (no key configured in tests)', () => {
  it('answers 503 on the translate trigger, but still serves reads', async () => {
    const owner = await registerAndLogin('ttr-gate-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Gate Org');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Gate Module');

    const trigger = await as(owner.token, orgId)
      .post(`/api/translations/trainings/${trainingId}`)
      .send({});
    expect(trigger.status).toBe(503);

    const state = await as(owner.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(state.status).toBe(200);
    expect(state.body.enabled).toBe(false);
    expect(state.body.canManage).toBe(true);
    expect(state.body.publishMode).toBe('manual');
    expect(state.body.autoTranslating).toBe(false);
    expect(state.body.autoTranslationFailed).toBe(false);
    expect(state.body.translation).toBeNull();
  });

  it('answers 503 before the publish gate — the key check comes first', async () => {
    // requestTrainingTranslation checks translationEnabled before it loads the
    // module, so an unpublished module still answers 503, not 409. The 409
    // publish gate is only observable with a key configured.
    const owner = await registerAndLogin('ttr-draft-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Draft Gate Org');
    const created = await as(owner.token, orgId)
      .post('/api/training')
      .send({ title: 'Unpublished Module', blocks: [textBlock('Not yet live.')] });
    expect(created.status).toBe(201);

    const trigger = await as(owner.token, orgId)
      .post(`/api/translations/trainings/${created.body._id}`)
      .send({});
    expect(trigger.status).toBe(503);
  });

  it('follows its own publish-mode setting, independent of the recipe one', async () => {
    const owner = await registerAndLogin('ttr-setting-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Setting Org');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Setting Module');

    // Flipping the RECIPE setting must not move the training's mode…
    await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { translationPublishMode: 'auto_publish' } });
    const unmoved = await as(owner.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(unmoved.body.publishMode).toBe('manual');

    // …and the training setting governs the training alone.
    await as(owner.token, orgId)
      .patch('/api/tenancy/organization')
      .send({ settings: { trainingTranslationPublishMode: 'auto_review' } });
    const moved = await as(owner.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(moved.body.publishMode).toBe('auto_review');
  });

  it('refuses the money-spending route to staff outright', async () => {
    const owner = await registerAndLogin('ttr-staff-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Staff Gate Org');
    const staff = await addMember(owner.token, orgId, 'ttr-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Staff Gate Module');

    expect(
      (await as(staff.token, orgId).post(`/api/translations/trainings/${trainingId}`).send({}))
        .status,
    ).toBe(403);
    expect(
      (
        await as(staff.token, orgId)
          .post(`/api/translations/trainings/${trainingId}/approve`)
          .send({})
      ).status,
    ).toBe(403);
  });
});

describe('the training review gate', () => {
  it('hides pending translations from staff and publishes only on approval', async () => {
    const owner = await registerAndLogin('ttr-review-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Review Org');
    const staff = await addMember(owner.token, orgId, 'ttr-review-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Review Module');
    await seedTrainingTranslation(trainingId, owner.userId);

    // Staff: nothing until a human approves.
    const staffBefore = await as(staff.token, orgId).get(
      `/api/translations/trainings/${trainingId}`,
    );
    expect(staffBefore.status).toBe(200);
    expect(staffBefore.body.canManage).toBe(false);
    expect(staffBefore.body.translation).toBeNull();

    // The reviewer sees the pending document.
    const chefView = await as(owner.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(chefView.body.translation.status).toBe('pending_review');
    expect(chefView.body.translation.stale).toBe(false);
    expect(chefView.body.translation.origin).toBe('machine');

    // Approve, with the sign-off recorded.
    const approved = await as(owner.token, orgId)
      .post(`/api/translations/trainings/${trainingId}/approve`)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvedBy).toBe(owner.userId);
    expect(approved.body.autoApproved).toBe(false);

    // Staff now read the Spanish, block-aligned: the text block carries text
    // and no caption, the embed block a caption and no text.
    const staffAfter = await as(staff.token, orgId).get(
      `/api/translations/trainings/${trainingId}`,
    );
    expect(staffAfter.body.translation).not.toBeNull();
    expect(staffAfter.body.translation.payload.title).toBe('Comida caliente, siempre caliente');
    expect(staffAfter.body.translation.payload.blocks).toEqual([
      { text: 'Mantenga la comida caliente por encima de 135F.', caption: null },
      { text: null, caption: 'Vea el recorrido' },
    ]);
  });

  it('drops an edited translation back to pending review until re-approved', async () => {
    const owner = await registerAndLogin('ttr-edit-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Edit Org');
    const staff = await addMember(owner.token, orgId, 'ttr-edit-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Edit Module');
    await seedTrainingTranslation(trainingId, owner.userId, 'approved');

    const edited = await as(owner.token, orgId)
      .patch(`/api/translations/trainings/${trainingId}`)
      .send({
        payload: {
          title: 'Título editado',
          description: 'Descripción editada',
          blocks: [
            { text: 'Texto editado del bloque.', caption: null },
            { text: null, caption: 'Leyenda editada' },
          ],
        },
      });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('pending_review');
    expect(edited.body.origin).toBe('machine_edited');
    expect(edited.body.approvedBy).toBeNull();

    // The edit un-published it for staff.
    const staffView = await as(staff.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(staffView.body.translation).toBeNull();

    // Misaligned edits are refused — they would caption the wrong blocks.
    const misaligned = await as(owner.token, orgId)
      .patch(`/api/translations/trainings/${trainingId}`)
      .send({
        payload: {
          title: 'Título',
          description: '',
          blocks: [{ text: 'Un solo bloque.', caption: null }],
        },
      });
    expect(misaligned.status).toBe(409);
  });

  it('serves auto-published text flagged unreviewed, until a chef signs it for real', async () => {
    const owner = await registerAndLogin('ttr-auto-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Auto Org');
    const staff = await addMember(owner.token, orgId, 'ttr-auto-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Auto Module');
    await seedTrainingTranslation(trainingId, owner.userId, 'approved', true);

    // SAFETY: auto-published text reaches staff — that is what the org chose —
    // but flagged, with no approver forged onto it.
    const asStaff = await as(staff.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.translation).not.toBeNull();
    expect(asStaff.body.translation.autoApproved).toBe(true);
    expect(asStaff.body.translation.approvedBy).toBeNull();

    const approved = await as(owner.token, orgId)
      .post(`/api/translations/trainings/${trainingId}/approve`)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.autoApproved).toBe(false);
    expect(approved.body.approvedBy).toBe(owner.userId);
  });

  it('hides the translation state of an unpublished module from staff entirely', async () => {
    const owner = await registerAndLogin('ttr-unpub-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Unpublished Org');
    const staff = await addMember(owner.token, orgId, 'ttr-unpub-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Recalled Module');
    await seedTrainingTranslation(trainingId, owner.userId, 'approved');

    const recalled = await as(owner.token, orgId)
      .post(`/api/training/${trainingId}/unpublish`)
      .send();
    expect(recalled.status).toBe(200);

    // Existence hiding, mirroring the module itself: 404, not an empty state.
    expect(
      (await as(staff.token, orgId).get(`/api/translations/trainings/${trainingId}`)).status,
    ).toBe(404);
    // The reviewer still sees the full state.
    expect(
      (await as(owner.token, orgId).get(`/api/translations/trainings/${trainingId}`)).status,
    ).toBe(200);
  });
});

describe('training staleness', () => {
  it('hides an approved translation the moment the published text changes', async () => {
    const owner = await registerAndLogin('ttr-stale-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Stale Org');
    const staff = await addMember(owner.token, orgId, 'ttr-stale-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Stale Module');
    await seedTrainingTranslation(trainingId, owner.userId, 'approved');

    // Approved and current: staff read it.
    const before = await as(staff.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(before.body.translation).not.toBeNull();

    // Modules are edited in place — a title change IS the source change.
    const edited = await as(owner.token, orgId)
      .patch(`/api/training/${trainingId}`)
      .send({ title: 'Stale Module, Revised' });
    expect(edited.status).toBe(200);

    // Read-time hash check: the reviewer sees the approval still standing but
    // stale (nothing rewrote the document — the hash is the whole story)…
    const chefView = await as(owner.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(chefView.body.translation.status).toBe('approved');
    expect(chefView.body.translation.stale).toBe(true);

    // …and staff see nothing.
    const staffView = await as(staff.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(staffView.body.translation).toBeNull();

    // Approving the stale text is refused outright.
    const approve = await as(owner.token, orgId)
      .post(`/api/translations/trainings/${trainingId}/approve`)
      .send({});
    expect(approve.status).toBe(409);
  });

  it('treats a caption edit as a text change too', async () => {
    const owner = await registerAndLogin('ttr-caption-owner@example.com');
    const orgId = await createOrg(owner.token, 'Training Caption Org');
    const staff = await addMember(owner.token, orgId, 'ttr-caption-staff@example.com', 'staff');
    const trainingId = await createPublishedTraining(owner.token, orgId, 'Caption Module');
    await seedTrainingTranslation(trainingId, owner.userId, 'approved');

    const edited = await as(owner.token, orgId)
      .patch(`/api/training/${trainingId}`)
      .send({
        blocks: [
          textBlock('Hold hot food above 135F. Check every two hours.'),
          {
            kind: 'embed',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            caption: 'Watch the NEW walkthrough',
          },
        ],
      });
    expect(edited.status).toBe(200);

    const staffView = await as(staff.token, orgId).get(`/api/translations/trainings/${trainingId}`);
    expect(staffView.body.translation).toBeNull();
  });
});

describe('training tenant isolation', () => {
  it("never serves one org's training translation to another", async () => {
    const ownerA = await registerAndLogin('ttr-iso-a@example.com');
    const ownerB = await registerAndLogin('ttr-iso-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Training Translation Org A');
    const orgB = await createOrg(ownerB.token, 'Training Translation Org B');
    const trainingA = await createPublishedTraining(ownerA.token, orgA, 'A Secret Module');
    await seedTrainingTranslation(trainingA, ownerA.userId, 'approved');

    // Org B probing org A's module id: existence-hiding 404, both surfaces.
    expect(
      (await as(ownerB.token, orgB).get(`/api/translations/trainings/${trainingA}`)).status,
    ).toBe(404);
    expect(
      (
        await as(ownerB.token, orgB)
          .post(`/api/translations/trainings/${trainingA}/approve`)
          .send({})
      ).status,
    ).toBe(404);
  });
});
