import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Full HTTP round-trips for /api/media and the plating photos it feeds into
 * /api/recipes: content-sniffed upload, tenant-prefixed keys, role gates,
 * tenant isolation, the at-or-above scope rule for attachment, and what a
 * recipe does when an asset is deleted out from under it.
 *
 * R2 is mocked at the SDK boundary — nothing here reaches Cloudflare. The
 * dummy `R2_*` env that makes the feature "configured" lives in setup.ts.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

// Classes, not arrow functions: the service calls `new S3Client(...)` and
// `new PutObjectCommand(...)`, and vitest will not construct an arrow mock.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock;
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

const { app } = await import('../../app');

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A structurally valid PNG header — enough for `sniffImage` to accept it. */
function pngBytes(width = 1600, height = 1200): Buffer {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

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

interface Scope {
  propertyId?: string;
  locationId?: string;
}

/** An authed request agent pinned to one scope, via the tenant headers. */
function as(token: string, orgId: string, scope: Scope = {}) {
  const decorate = <T extends request.Test>(req: T): T => {
    req.set('Authorization', `Bearer ${token}`).set('X-Org-Id', orgId);
    if (scope.propertyId) req.set('X-Property-Id', scope.propertyId);
    if (scope.locationId) req.set('X-Location-Id', scope.locationId);
    return req;
  };
  return {
    get: (path: string) => decorate(request(app).get(path)),
    post: (path: string) => decorate(request(app).post(path)),
    patch: (path: string) => decorate(request(app).patch(path)),
    delete: (path: string) => decorate(request(app).delete(path)),
  };
}

/** Uploads `bytes` as a plating photo and returns the raw response. */
function upload(
  token: string,
  orgId: string,
  bytes: Buffer,
  options: { filename?: string; contentType?: string; scope?: Scope } = {}
) {
  return as(token, orgId, options.scope ?? {})
    .post('/api/media/photos')
    .attach('file', bytes, {
      filename: options.filename ?? 'plate.png',
      contentType: options.contentType ?? 'image/png',
    });
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

// ── Upload ────────────────────────────────────────────────────────────────────

describe('photo upload', () => {
  let chef: { token: string };
  let staff: { token: string };
  let orgId: string;

  beforeAll(async () => {
    const owner = await registerAndLogin('media-owner@example.com');
    orgId = await createOrg(owner.token, 'Media Org');
    chef = await addMember(owner.token, orgId, 'media-chef@example.com', 'chef');
    staff = await addMember(owner.token, orgId, 'media-staff@example.com', 'staff');
  });

  it('stores a photo and returns a renderable asset', async () => {
    const response = await upload(chef.token, orgId, pngBytes(1600, 1200));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      kind: 'photo',
      status: 'ready',
      mime: 'image/png',
      width: 1600,
      height: 1200,
    });
    expect(response.body.url).toMatch(/^https:\/\/media\.test\.local\//);
    expect(response.body.url).toMatch(/\.png$/);
  });

  it('writes to a tenant-prefixed key, never the client filename', async () => {
    await upload(chef.token, orgId, pngBytes(), { filename: 'my-secret-plate.png' });

    const put = sendMock.mock.calls[0][0] as { input: { Key: string; ContentType: string } };
    expect(put.input.Key).toMatch(new RegExp(`^${orgId}/_/_/[0-9a-f]{32}\\.png$`));
    expect(put.input.Key).not.toContain('my-secret-plate');
    expect(put.input.ContentType).toBe('image/png');
  });

  it('trusts the bytes over the declared content type', async () => {
    // A PNG announced as a JPEG: the sniffed type wins, so the stored object is
    // labelled and extended correctly regardless of what the client claimed.
    const response = await upload(chef.token, orgId, pngBytes(), {
      filename: 'plate.jpg',
      contentType: 'image/jpeg',
    });

    expect(response.status).toBe(201);
    expect(response.body.mime).toBe('image/png');
    expect(response.body.url).toMatch(/\.png$/);
  });

  it('refuses a non-image wearing an image content type', async () => {
    const response = await upload(chef.token, orgId, Buffer.from('<svg><script/></svg>'), {
      filename: 'plate.png',
      contentType: 'image/png',
    });

    expect(response.status).toBe(415);
    // Nothing reached storage.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses staff, and anonymous callers', async () => {
    const asStaff = await upload(staff.token, orgId, pngBytes());
    expect(asStaff.status).toBe(403);

    const anon = await request(app).post('/api/media/photos').attach('file', pngBytes(), 'p.png');
    expect(anon.status).toBe(401);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it("never lets one org touch or attach another's asset", async () => {
    const ownerA = await registerAndLogin('media-iso-a@example.com');
    const ownerB = await registerAndLogin('media-iso-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Media Isolation A');
    const orgB = await createOrg(ownerB.token, 'Media Isolation B');

    const uploaded = await upload(ownerA.token, orgA, pngBytes());
    expect(uploaded.status).toBe(201);
    const photoId = uploaded.body._id;

    // Existence hiding: another org's asset id answers 404, never 403.
    const deleteAttempt = await as(ownerB.token, orgB).delete(`/api/media/${photoId}`);
    expect(deleteAttempt.status).toBe(404);

    const recipeB = await createRecipe(ownerB.token, orgB, 'B Plated Dish');
    const attach = await as(ownerB.token, orgB)
      .patch(`/api/recipes/${recipeB}`)
      .send({ content: content({ photoIds: [photoId] }) });
    expect(attach.status).toBe(404);
  });
});

// ── Plating photos on recipes ─────────────────────────────────────────────────

describe('plating photos on a recipe', () => {
  let chef: { token: string };
  let orgId: string;

  beforeAll(async () => {
    const owner = await registerAndLogin('plating-owner@example.com');
    orgId = await createOrg(owner.token, 'Plating Org');
    chef = await addMember(owner.token, orgId, 'plating-chef@example.com', 'chef');
  });

  async function uploadPhotoId(): Promise<string> {
    const response = await upload(chef.token, orgId, pngBytes());
    expect(response.status).toBe(201);
    return response.body._id;
  }

  it('attaches photos in order and exposes the first as the hero', async () => {
    const [first, second] = [await uploadPhotoId(), await uploadPhotoId()];
    const recipeId = await createRecipe(chef.token, orgId, 'Seared Scallops');

    const updated = await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ content: content({ photoIds: [first, second] }) });

    expect(updated.status).toBe(200);
    expect(updated.body.workingCopy.photos.map((p: { _id: string }) => p._id)).toEqual([
      first,
      second,
    ]);
    expect(updated.body.heroPhoto._id).toBe(first);

    // Reordering is a plain content edit — the hero follows index 0.
    const reordered = await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ content: content({ photoIds: [second, first] }) });
    expect(reordered.body.heroPhoto._id).toBe(second);

    const list = await as(chef.token, orgId).get('/api/recipes?q=Seared Scallops');
    expect(list.body.items[0].heroPhoto._id).toBe(second);
  });

  it('accepts photos at create time', async () => {
    const photoId = await uploadPhotoId();
    const recipeId = await createRecipe(chef.token, orgId, 'Plated At Birth', {
      content: content({ photoIds: [photoId] }),
    });

    const detail = await as(chef.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(detail.body.workingCopy.photos).toHaveLength(1);
  });

  it('rejects the same photo attached twice', async () => {
    const photoId = await uploadPhotoId();
    const recipeId = await createRecipe(chef.token, orgId, 'Double Plated');

    const response = await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ content: content({ photoIds: [photoId, photoId] }) });
    expect(response.status).toBe(400);
  });

  it('keeps plating in the version snapshot, and staff see it once live', async () => {
    const photoId = await uploadPhotoId();
    const recipeId = await createRecipe(chef.token, orgId, 'Versioned Plating', {
      content: content({ photoIds: [photoId], allergens: [] }),
    });

    const version = await as(chef.token, orgId).post(`/api/recipes/${recipeId}/versions`).send({});
    expect(version.status).toBe(201);
    const activated = await as(chef.token, orgId).post(
      `/api/recipes/${recipeId}/versions/${version.body._id}/activate`
    );
    expect(activated.status).toBe(200);
    expect(activated.body.activeContent.photos).toHaveLength(1);

    // A later working-copy edit that drops the photo leaves the live version's
    // plating untouched — that is the whole point of snapshotting content.
    await as(chef.token, orgId)
      .patch(`/api/recipes/${recipeId}`)
      .send({ content: content({ photoIds: [] }) });

    const after = await as(chef.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(after.body.workingCopy.photos).toHaveLength(0);
    expect(after.body.activeContent.photos).toHaveLength(1);
  });

  it('drops a deleted asset from the recipe instead of rendering a broken image', async () => {
    const photoId = await uploadPhotoId();
    const recipeId = await createRecipe(chef.token, orgId, 'Orphaned Plating', {
      content: content({ photoIds: [photoId] }),
    });

    const deleted = await as(chef.token, orgId).delete(`/api/media/${photoId}`);
    expect(deleted.status).toBe(204);

    const detail = await as(chef.token, orgId).get(`/api/recipes/${recipeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.workingCopy.photos).toEqual([]);
    expect(detail.body.heroPhoto).toBeNull();
  });

  it('refuses a photo scoped below the recipe that would use it', async () => {
    const owner = await registerAndLogin('plating-scope-owner@example.com');
    const scopedOrg = await createOrg(owner.token, 'Plating Scope Org');

    const property = await as(owner.token, scopedOrg)
      .post('/api/tenancy/properties')
      .send({ name: 'Harbour House' });
    expect(property.status).toBe(201);

    // Uploaded while narrowed to the property, so the asset is property-scoped.
    const scopedPhoto = await upload(owner.token, scopedOrg, pngBytes(), {
      scope: { propertyId: property.body._id },
    });
    expect(scopedPhoto.status).toBe(201);

    // The recipe is org-wide, so locations outside that property could not load
    // the photo — same rule sub-recipes follow.
    const orgRecipe = await createRecipe(owner.token, scopedOrg, 'Org Wide Dish');
    const response = await as(owner.token, scopedOrg)
      .patch(`/api/recipes/${orgRecipe}`)
      .send({ content: content({ photoIds: [scopedPhoto.body._id] }) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/scoped below/i);
  });
});
