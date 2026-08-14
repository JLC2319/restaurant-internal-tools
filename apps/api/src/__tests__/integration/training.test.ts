import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { connectToTestDb, disconnectTestDb } from './db';

/**
 * Full HTTP round-trips for /api/training and the streamed video uploads that
 * feed it: byte-sniffed streaming upload, the publish gate, block media
 * validation (kind + scope), completion tracking, and tenant isolation.
 *
 * R2 is mocked at the SDK boundary. The streamed path goes through the real
 * `Upload` from @aws-sdk/lib-storage, which needs two things from the client:
 * `send` (→ our mock) and `config.endpoint()` (→ a static endpoint below), so
 * the whole storage engine executes for real — only the network is fake.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock;
    // lib-storage reads client.config in its single-part path: endpoint() for
    // the result Location, requestHandler for progress, forcePathStyle.
    config = {
      endpoint: async () => ({ protocol: 'https:', hostname: 'r2.test.local', path: '/' }),
      requestChecksumCalculation: async () => 'WHEN_REQUIRED',
    };
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

const { app } = await import('../../app');

beforeAll(async () => {
  await connectToTestDb('training');
}, 120_000);

afterAll(async () => {
  await disconnectTestDb();
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

/**
 * A minimal MP4 opening padded past the storage engine's 4KB sniff window, so
 * the sniff-then-pipe streaming path executes rather than the ended-early one.
 */
function mp4Bytes(majorBrand = 'isom', totalSize = 8 * 1024): Buffer {
  const buf = Buffer.alloc(totalSize);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write(majorBrand, 8, 'ascii');
  buf.write('isomavc1', 16, 'ascii');
  return buf;
}

/** A WebM EBML header with DocType `webm`, padded like the MP4 fixture. */
function webmBytes(totalSize = 8 * 1024): Buffer {
  const head = Buffer.from([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x9f,
    0x42,
    0x86,
    0x81,
    0x01,
    0x42,
    0xf7,
    0x81,
    0x01,
    0x42,
    0x82,
    0x84,
    0x77,
    0x65,
    0x62,
    0x6d, // DocType 'webm'
  ]);
  const buf = Buffer.alloc(totalSize);
  head.copy(buf, 0);
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
    put: (path: string) => decorate(request(app).put(path)),
    delete: (path: string) => decorate(request(app).delete(path)),
  };
}

function uploadVideo(
  token: string,
  orgId: string,
  bytes: Buffer,
  options: { filename?: string; contentType?: string; scope?: Scope } = {},
) {
  return as(token, orgId, options.scope ?? {})
    .post('/api/media/videos')
    .attach('file', bytes, {
      filename: options.filename ?? 'training.mp4',
      contentType: options.contentType ?? 'video/mp4',
    });
}

function uploadPhoto(token: string, orgId: string, scope: Scope = {}) {
  return as(token, orgId, scope)
    .post('/api/media/photos')
    .attach('file', pngBytes(), { filename: 'plate.png', contentType: 'image/png' });
}

const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** A one-paragraph rich-text document — the minimal valid text block payload. */
function textBlock(text: string): Record<string, unknown> {
  return {
    kind: 'text',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
}

// ── Streamed video upload ─────────────────────────────────────────────────────

describe('streamed video upload', () => {
  let chef: { token: string };
  let staff: { token: string };
  let orgId: string;

  beforeAll(async () => {
    const owner = await registerAndLogin('training-media-owner@example.com');
    orgId = await createOrg(owner.token, 'Training Media Org');
    chef = await addMember(owner.token, orgId, 'training-media-chef@example.com', 'chef');
    staff = await addMember(owner.token, orgId, 'training-media-staff@example.com', 'staff');
  });

  it('streams an MP4 to a tenant-prefixed key and returns a ready video asset', async () => {
    const response = await uploadVideo(chef.token, orgId, mp4Bytes());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      kind: 'video',
      status: 'ready',
      mime: 'video/mp4',
      size: 8 * 1024,
      width: null,
      height: null,
    });
    expect(response.body.url).toMatch(/^https:\/\/media\.test\.local\//);
    expect(response.body.url).toMatch(/\.mp4$/);

    // The real lib-storage Upload ran against the mocked client: the object
    // that reached "R2" carries the tenant-prefixed key and the sniffed type.
    const put = sendMock.mock.calls.find(
      (call) => call[0]?.constructor?.name === 'PutObjectCommand',
    )![0] as { input: { Key: string; ContentType: string } };
    expect(put.input.Key).toMatch(new RegExp(`^${orgId}/_/_/[0-9a-f]{32}\\.mp4$`));
    expect(put.input.Key).not.toContain('training.mp4');
    expect(put.input.ContentType).toBe('video/mp4');
  });

  it('accepts WebM, including one smaller than the sniff window', async () => {
    const response = await uploadVideo(chef.token, orgId, webmBytes(512), {
      filename: 'clip.webm',
      contentType: 'video/webm',
    });

    expect(response.status).toBe(201);
    expect(response.body.mime).toBe('video/webm');
    expect(response.body.url).toMatch(/\.webm$/);
    expect(response.body.size).toBe(512);
  });

  it('trusts the bytes over the declared content type', async () => {
    const response = await uploadVideo(chef.token, orgId, mp4Bytes(), {
      filename: 'clip.webm',
      contentType: 'video/webm',
    });

    expect(response.status).toBe(201);
    expect(response.body.mime).toBe('video/mp4');
    expect(response.body.url).toMatch(/\.mp4$/);
  });

  it('refuses QuickTime and non-video bytes before anything reaches storage', async () => {
    const mov = await uploadVideo(chef.token, orgId, mp4Bytes('qt  '), {
      filename: 'clip.mov',
      contentType: 'video/quicktime',
    });
    expect(mov.status).toBe(415);

    const png = await uploadVideo(chef.token, orgId, pngBytes(), {
      filename: 'disguised.mp4',
    });
    expect(png.status).toBe(415);

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses staff, and anonymous callers', async () => {
    const asStaff = await uploadVideo(staff.token, orgId, mp4Bytes());
    expect(asStaff.status).toBe(403);

    const anon = await request(app)
      .post('/api/media/videos')
      .attach('file', mp4Bytes(), 'clip.mp4');
    expect(anon.status).toBe(401);
  });
});

// ── Authoring & the publish gate ──────────────────────────────────────────────

describe('training authoring and publish gate', () => {
  let owner: { token: string; userId: string };
  let chef: { token: string };
  let staff: { token: string };
  let orgId: string;

  beforeAll(async () => {
    owner = await registerAndLogin('training-owner@example.com');
    orgId = await createOrg(owner.token, 'Training Org');
    chef = await addMember(owner.token, orgId, 'training-chef@example.com', 'chef');
    staff = await addMember(owner.token, orgId, 'training-staff@example.com', 'staff');
  });

  it('creates a draft with text, image and embed blocks, shaped for rendering', async () => {
    const photo = await uploadPhoto(chef.token, orgId);
    expect(photo.status).toBe(201);

    // A document exercising marks and structure end to end. The `target`
    // attribute on the link is NOT in the allow-list and must not survive.
    const richDoc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Hold it right' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Never', marks: [{ type: 'bold' }, { type: 'underline' }] },
            { type: 'text', text: ' cut toward yourself. See ' },
            {
              type: 'text',
              text: 'the guide',
              marks: [
                { type: 'link', attrs: { href: 'https://example.com/knives', target: '_top' } },
              ],
            },
          ],
        },
      ],
    };

    const created = await as(chef.token, orgId)
      .post('/api/training')
      .send({
        title: 'Knife Safety',
        description: 'Grip, angle, and the claw.',
        blocks: [
          { kind: 'text', doc: richDoc },
          { kind: 'image', mediaId: photo.body._id, caption: 'The claw grip' },
          { kind: 'embed', url: YT_URL },
        ],
      });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.blockCount).toBe(3);
    expect(created.body.videoCount).toBe(1);
    expect(created.body.heroImage._id).toBe(photo.body._id);
    expect(created.body.canManage).toBe(true);
    expect(created.body.myCompletion).toBeNull();

    const [text, image, embed] = created.body.blocks;
    expect(text.kind).toBe('text');
    expect(text.doc.content[0]).toEqual(richDoc.content[0]);
    // The stored copy is the sanitised parse: the link kept href and lost target.
    const linkMark = text.doc.content[1].content[2].marks[0];
    expect(linkMark).toEqual({ type: 'link', attrs: { href: 'https://example.com/knives' } });
    expect(image.media.url).toBe(photo.body.url);
    expect(image.caption).toBe('The claw grip');
    expect(embed).toMatchObject({
      kind: 'embed',
      provider: 'youtube',
      embedSrc: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
  });

  it('rejects a text block whose document steps outside the allow-list', async () => {
    const response = await as(chef.token, orgId)
      .post('/api/training')
      .send({
        title: 'Nice Try',
        blocks: [
          {
            kind: 'text',
            doc: { type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://evil.io' } }] },
          },
        ],
      });
    expect(response.status).toBe(400);
  });

  it('preserves pre-rich-text blocks as plain paragraphs', async () => {
    // Written straight to the collection the way the markdown-era feature
    // stored text — the API can no longer produce this shape.
    const { TrainingModule } = await import('../../features/training/trainingModule.model');
    const legacy = await TrainingModule.create({
      scope: { orgId, propertyId: null, locationId: null },
      title: 'Legacy Module',
      description: '',
      status: 'draft',
      blocks: [{ kind: 'text', body: 'Old **markdown** text' }],
      publishedAt: null,
      createdBy: owner.userId,
    });

    const detail = await as(chef.token, orgId).get(`/api/training/${String(legacy._id)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.blocks[0]).toEqual({
      kind: 'text',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Old **markdown** text' }] },
        ],
      },
    });
  });

  it('keeps drafts invisible to staff, then publishes them into view', async () => {
    const created = await as(chef.token, orgId)
      .post('/api/training')
      .send({ title: 'Fryer Shutdown', blocks: [textBlock('Cool, drain, filter.')] });
    const id = created.body._id;

    // Draft: staff list does not contain it, direct get is a 404, and a
    // completion attempt reveals nothing.
    const staffList = await as(staff.token, orgId).get('/api/training');
    expect(staffList.body.items.map((t: { _id: string }) => t._id)).not.toContain(id);
    expect((await as(staff.token, orgId).get(`/api/training/${id}`)).status).toBe(404);
    expect((await as(staff.token, orgId).post(`/api/training/${id}/complete`)).status).toBe(404);

    // Chefs see their own drafts in the draft slice.
    const draftList = await as(chef.token, orgId).get('/api/training?status=draft');
    expect(draftList.body.items.map((t: { _id: string }) => t._id)).toContain(id);

    const published = await as(chef.token, orgId).post(`/api/training/${id}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('published');
    expect(published.body.publishedAt).not.toBeNull();

    const staffView = await as(staff.token, orgId).get(`/api/training/${id}`);
    expect(staffView.status).toBe(200);
    expect(staffView.body.blocks).toHaveLength(1);
    // Staff never see the management surface.
    expect(staffView.body.canManage).toBe(false);
    expect(staffView.body.completedCount).toBeNull();

    // Unpublish pulls it back out of view.
    await as(chef.token, orgId).post(`/api/training/${id}/unpublish`);
    expect((await as(staff.token, orgId).get(`/api/training/${id}`)).status).toBe(404);
  });

  it('refuses to publish an empty module', async () => {
    const created = await as(chef.token, orgId).post('/api/training').send({ title: 'Empty One' });
    const response = await as(chef.token, orgId).post(`/api/training/${created.body._id}/publish`);
    expect(response.status).toBe(409);
  });

  it('gates authoring on the chef role and archival on manager', async () => {
    expect(
      (await as(staff.token, orgId).post('/api/training').send({ title: 'Staff Draft' })).status,
    ).toBe(403);

    const created = await as(chef.token, orgId).post('/api/training').send({ title: 'To Archive' });
    const id = created.body._id;

    // A chef is below manager, so archival is refused…
    expect((await as(chef.token, orgId).delete(`/api/training/${id}`)).status).toBe(403);
    // …while the org owner may archive, after which editing is blocked…
    expect((await as(owner.token, orgId).delete(`/api/training/${id}`)).status).toBe(204);
    expect(
      (await as(chef.token, orgId).patch(`/api/training/${id}`).send({ title: 'Nope' })).status,
    ).toBe(409);
    // …and unarchiving lands on draft, never straight back to published.
    const restored = await as(owner.token, orgId).post(`/api/training/${id}/unarchive`);
    expect(restored.body.status).toBe('draft');
  });

  it('validates block media by kind and scope', async () => {
    const photo = await uploadPhoto(chef.token, orgId);
    const video = await uploadVideo(chef.token, orgId, mp4Bytes());

    // A video asset in an image block, and vice versa, are client bugs.
    const wrongKinds = await as(chef.token, orgId)
      .post('/api/training')
      .send({ title: 'Wrong Kinds', blocks: [{ kind: 'image', mediaId: video.body._id }] });
    expect(wrongKinds.status).toBe(400);

    const wrongKinds2 = await as(chef.token, orgId)
      .post('/api/training')
      .send({ title: 'Wrong Kinds 2', blocks: [{ kind: 'video', mediaId: photo.body._id }] });
    expect(wrongKinds2.status).toBe(400);

    // A property-scoped video cannot ride on an org-wide module — part of the
    // audience could not load it. Same rule as plating photos.
    const property = await as(owner.token, orgId)
      .post('/api/tenancy/properties')
      .send({ name: 'Harbour House' });
    const scopedVideo = await uploadVideo(owner.token, orgId, mp4Bytes(), {
      scope: { propertyId: property.body._id },
    });
    const scoped = await as(owner.token, orgId)
      .post('/api/training')
      .send({ title: 'Org Wide', blocks: [{ kind: 'video', mediaId: scopedVideo.body._id }] });
    expect(scoped.status).toBe(400);
    expect(scoped.body.message).toMatch(/scoped below/i);
  });
});

// ── Completion tracking ───────────────────────────────────────────────────────

describe('training completion', () => {
  let chef: { token: string };
  let staff: { token: string; userId: string };
  let orgId: string;
  let trainingId: string;

  beforeAll(async () => {
    const owner = await registerAndLogin('completion-owner@example.com');
    orgId = await createOrg(owner.token, 'Completion Org');
    chef = await addMember(owner.token, orgId, 'completion-chef@example.com', 'chef');
    staff = await addMember(owner.token, orgId, 'completion-staff@example.com', 'staff');

    const created = await as(chef.token, orgId)
      .post('/api/training')
      .send({ title: 'Allergen Basics', blocks: [textBlock('The nine majors.')] });
    trainingId = created.body._id;
    await as(chef.token, orgId).post(`/api/training/${trainingId}/publish`);
  });

  it('records a completion, idempotently, and surfaces it everywhere', async () => {
    const first = await as(staff.token, orgId).post(`/api/training/${trainingId}/complete`);
    expect(first.status).toBe(200);
    expect(first.body.completed).toBe(true);

    // A double-tap does not create a second record or move the timestamp.
    const second = await as(staff.token, orgId).post(`/api/training/${trainingId}/complete`);
    expect(second.body.completedAt).toBe(first.body.completedAt);

    const detail = await as(staff.token, orgId).get(`/api/training/${trainingId}`);
    expect(detail.body.myCompletion).toBe(first.body.completedAt);

    const list = await as(staff.token, orgId).get('/api/training');
    const row = list.body.items.find((t: { _id: string }) => t._id === trainingId);
    expect(row.myCompletion).toBe(first.body.completedAt);

    // The chef sees the roster; the count reflects one person, and the row
    // carries the completer's name for the manager view.
    const chefDetail = await as(chef.token, orgId).get(`/api/training/${trainingId}`);
    expect(chefDetail.body.completedCount).toBe(1);

    const roster = await as(chef.token, orgId).get(`/api/training/${trainingId}/completions`);
    expect(roster.status).toBe(200);
    expect(roster.body).toHaveLength(1);
    expect(roster.body[0]).toMatchObject({
      userId: staff.userId,
      email: 'completion-staff@example.com',
    });

    // Staff cannot read the roster.
    expect(
      (await as(staff.token, orgId).get(`/api/training/${trainingId}/completions`)).status,
    ).toBe(403);
  });

  it('lets a member take their completion back', async () => {
    await as(staff.token, orgId).post(`/api/training/${trainingId}/complete`);
    const undone = await as(staff.token, orgId).delete(`/api/training/${trainingId}/complete`);
    expect(undone.status).toBe(200);
    expect(undone.body.completed).toBe(false);

    const detail = await as(staff.token, orgId).get(`/api/training/${trainingId}`);
    expect(detail.body.myCompletion).toBeNull();
  });

  it('refuses completion of an unpublished module — 409 for chefs, 404 for staff', async () => {
    const draft = await as(chef.token, orgId).post('/api/training').send({ title: 'Unpublished' });
    const id = draft.body._id;

    expect((await as(chef.token, orgId).post(`/api/training/${id}/complete`)).status).toBe(409);
    expect((await as(staff.token, orgId).post(`/api/training/${id}/complete`)).status).toBe(404);
  });
});

// ── Person-level access restriction ───────────────────────────────────────────

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

  async function restrict(
    token: string,
    trainingId: string,
    userIds: string[],
  ): Promise<request.Response> {
    return as(token, orgId).put(`/api/training/${trainingId}/access`).send({ access: { userIds } });
  }

  beforeAll(async () => {
    owner = await registerAndLogin('t-acl-owner@example.com');
    orgId = await createOrg(owner.token, 'Training ACL Org');
    p1 = await createProperty(owner.token, orgId, 'Sixty Vines');
    p2 = await createProperty(owner.token, orgId, 'Whiskey Cake');
    l1 = await createLocation(owner.token, orgId, p1, 'Sixty Vines Dallas');

    admin = await addMember(owner.token, orgId, 't-acl-admin@example.com', 'admin');
    manager = await addMember(owner.token, orgId, 't-acl-manager@example.com', 'manager');
    chefCreator = await addMember(owner.token, orgId, 't-acl-creator@example.com', 'chef');
    chefListed = await addMember(owner.token, orgId, 't-acl-listed@example.com', 'chef');
    chefOutsider = await addMember(owner.token, orgId, 't-acl-outsider@example.com', 'chef');
    staffListed = await addMember(owner.token, orgId, 't-acl-staff-listed@example.com', 'staff', {
      propertyId: p1,
      locationId: l1,
    });
    staffOutsider = await addMember(owner.token, orgId, 't-acl-staff-out@example.com', 'staff');
    p2Chef = await addMember(owner.token, orgId, 't-acl-p2-chef@example.com', 'chef', {
      propertyId: p2,
    });

    // The fixture: an org-level module, published so staff can read it, then
    // restricted to one chef and one location-tier staff member. The creator
    // deliberately leaves themselves off the list.
    const created = await as(chefCreator.token, orgId)
      .post('/api/training')
      .send({ title: 'Secret Procedures', blocks: [textBlock('The safe combination.')] });
    expect(created.status).toBe(201);
    secretId = created.body._id;
    expect(
      (await as(chefCreator.token, orgId).post(`/api/training/${secretId}/publish`)).status,
    ).toBe(200);

    const restricted = await restrict(chefCreator.token, secretId, [
      chefListed.userId,
      staffListed.userId,
    ]);
    expect(restricted.status).toBe(200);
    expect(restricted.body.restricted).toBe(true);
  }, 120_000);

  it('shows a restricted module to listed members, disclosing the list only to its managers', async () => {
    const chefList = await as(chefListed.token, orgId).get('/api/training');
    const chefRow = chefList.body.items.find((t: { _id: string }) => t._id === secretId);
    expect(chefRow).toBeTruthy();
    expect(chefRow.restricted).toBe(true);
    // An org-tier chef manages the module, so the allow-list resolves for them.
    const chefDetail = await as(chefListed.token, orgId).get(`/api/training/${secretId}`);
    expect(chefDetail.status).toBe(200);
    expect(chefDetail.body.access.userIds).toEqual(
      expect.arrayContaining([chefListed.userId, staffListed.userId]),
    );

    // Listed staff read it — blocks and all — but never learn who else is on
    // the list.
    const staffDetail = await as(staffListed.token, orgId).get(`/api/training/${secretId}`);
    expect(staffDetail.status).toBe(200);
    expect(staffDetail.body.restricted).toBe(true);
    expect(staffDetail.body.blocks).toHaveLength(1);
    expect(staffDetail.body.access).toBeNull();

    const staffList = await as(staffListed.token, orgId).get('/api/training');
    expect(staffList.body.items.map((t: { _id: string }) => t._id)).toContain(secretId);
  });

  it('hides it entirely from unlisted members — list, detail, writes, completion', async () => {
    const list = await as(chefOutsider.token, orgId).get('/api/training');
    expect(list.body.items.map((t: { _id: string }) => t._id)).not.toContain(secretId);

    expect((await as(chefOutsider.token, orgId).get(`/api/training/${secretId}`)).status).toBe(404);
    expect(
      (
        await as(chefOutsider.token, orgId)
          .patch(`/api/training/${secretId}`)
          .send({ title: 'Stolen Procedures' })
      ).status,
    ).toBe(404);
    expect((await restrict(chefOutsider.token, secretId, [chefOutsider.userId])).status).toBe(404);

    const staffList = await as(staffOutsider.token, orgId).get('/api/training');
    expect(staffList.body.items.map((t: { _id: string }) => t._id)).not.toContain(secretId);
    expect((await as(staffOutsider.token, orgId).get(`/api/training/${secretId}`)).status).toBe(
      404,
    );
    // A completion attempt reveals nothing either.
    expect(
      (await as(staffOutsider.token, orgId).post(`/api/training/${secretId}/complete`)).status,
    ).toBe(404);
  });

  it('does not answer title probes through ?q= for unlisted members', async () => {
    const probe = await as(chefOutsider.token, orgId).get('/api/training?q=Secret');
    expect(probe.body.total).toBe(0);
    const listed = await as(chefListed.token, orgId).get('/api/training?q=Secret');
    expect(listed.body.total).toBe(1);
  });

  it('always keeps the creator in, even when they left themselves off the list', async () => {
    const detail = await as(chefCreator.token, orgId).get(`/api/training/${secretId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.access.userIds).toEqual(
      expect.arrayContaining([chefListed.userId, staffListed.userId]),
    );
    const rename = await as(chefCreator.token, orgId)
      .patch(`/api/training/${secretId}`)
      .send({ title: 'Secret Procedures' });
    expect(rename.status).toBe(200);
  });

  it('lets admins and owners through, but not managers', async () => {
    const adminDetail = await as(admin.token, orgId).get(`/api/training/${secretId}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.restricted).toBe(true);
    expect(adminDetail.body.access).not.toBeNull();

    // Idempotent re-PUT of the same list: proves admins may manage access.
    const rePut = await restrict(admin.token, secretId, [chefListed.userId, staffListed.userId]);
    expect(rePut.status).toBe(200);

    expect((await as(owner.token, orgId).get(`/api/training/${secretId}`)).status).toBe(200);
    expect((await as(manager.token, orgId).get(`/api/training/${secretId}`)).status).toBe(404);
  });

  it('refuses access edits from listed members below chef', async () => {
    const attempt = await restrict(staffListed.token, secretId, [staffListed.userId]);
    expect(attempt.status).toBe(403);
  });

  it('rejects allow-list entries whose membership cannot see the module scope', async () => {
    const created = await as(owner.token, orgId)
      .post('/api/training')
      .send({ title: 'P1 House Rules', propertyId: p1, blocks: [textBlock('House rules.')] });
    expect(created.status).toBe(201);
    const p1Module = created.body._id;

    // A sibling property's chef never sees a P1 module — listing them lies.
    const sibling = await restrict(owner.token, p1Module, [p2Chef.userId]);
    expect(sibling.status).toBe(400);
    expect(sibling.body.message).toMatch(/cannot see/);

    // Someone from another org entirely, ditto — even on an org-level module.
    const strangerOwner = await registerAndLogin('t-acl-stranger@example.com');
    await createOrg(strangerOwner.token, 'Training ACL Other Org');
    expect((await restrict(owner.token, secretId, [strangerOwner.userId])).status).toBe(400);

    // A location member below the module's property, and an org-wide member,
    // are both genuinely covered — accepted.
    const valid = await restrict(owner.token, p1Module, [staffListed.userId, chefOutsider.userId]);
    expect(valid.status).toBe(200);
    expect(valid.body.access.userIds).toHaveLength(2);
  });

  it('offers exactly the coverable people as picker candidates', async () => {
    const created = await as(owner.token, orgId)
      .post('/api/training')
      .send({ title: 'P1 Staff Meal Training', propertyId: p1 });
    const p1Module = created.body._id;

    const candidates = await as(owner.token, orgId).get(
      `/api/training/${p1Module}/access/candidates`,
    );
    expect(candidates.status).toBe(200);
    const emails = candidates.body.map((c: { email: string }) => c.email);
    expect(emails).toContain('t-acl-outsider@example.com'); // org-wide member
    expect(emails).toContain('t-acl-staff-listed@example.com'); // L1 under P1
    expect(emails).not.toContain('t-acl-p2-chef@example.com'); // sibling property

    // The endpoint is gated like any other read of the module…
    expect(
      (await as(chefOutsider.token, orgId).get(`/api/training/${secretId}/access/candidates`))
        .status,
    ).toBe(404);
    // …and by role.
    expect(
      (await as(staffListed.token, orgId).get(`/api/training/${secretId}/access/candidates`))
        .status,
    ).toBe(403);
  });

  it('clears the restriction with access: null', async () => {
    const created = await as(chefCreator.token, orgId)
      .post('/api/training')
      .send({ title: 'Sometimes Secret', blocks: [textBlock('Now you see it.')] });
    const id = created.body._id;
    expect((await restrict(chefCreator.token, id, [])).status).toBe(200);
    expect((await as(chefOutsider.token, orgId).get(`/api/training/${id}`)).status).toBe(404);

    const cleared = await as(chefCreator.token, orgId)
      .put(`/api/training/${id}/access`)
      .send({ access: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.restricted).toBe(false);
    expect((await as(chefOutsider.token, orgId).get(`/api/training/${id}`)).status).toBe(200);
  });
});

// ── Placement ─────────────────────────────────────────────────────────────────

describe('placement', () => {
  let owner: { token: string; userId: string };
  let manager: { token: string; userId: string };
  let chef: { token: string; userId: string };
  let p1Staff: { token: string; userId: string };
  let p2Staff: { token: string; userId: string };
  let orgId: string;
  let p1: string;
  let p2: string;
  let l1: string;

  beforeAll(async () => {
    owner = await registerAndLogin('t-move-owner@example.com');
    orgId = await createOrg(owner.token, 'Training Placement Org');
    p1 = await createProperty(owner.token, orgId, 'Harbour House');
    p2 = await createProperty(owner.token, orgId, 'Canal Street');
    l1 = await createLocation(owner.token, orgId, p1, 'Harbour House North');

    manager = await addMember(owner.token, orgId, 't-move-manager@example.com', 'manager');
    chef = await addMember(owner.token, orgId, 't-move-chef@example.com', 'chef');
    p1Staff = await addMember(owner.token, orgId, 't-move-p1-staff@example.com', 'staff', {
      propertyId: p1,
    });
    p2Staff = await addMember(owner.token, orgId, 't-move-p2-staff@example.com', 'staff', {
      propertyId: p2,
    });
  }, 120_000);

  async function createPublished(
    title: string,
    body: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await as(chef.token, orgId)
      .post('/api/training')
      .send({ title, blocks: [textBlock('Follow the checklist.')], ...body });
    expect(created.status).toBe(201);
    const id = created.body._id;
    expect((await as(chef.token, orgId).post(`/api/training/${id}/publish`)).status).toBe(200);
    return id;
  }

  it('moves a module across the tree, and its audience follows', async () => {
    const id = await createPublished('Traveling Module', { propertyId: p1 });

    // At P1: its own staff see it, the sibling property's do not.
    expect((await as(p1Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(200);
    expect((await as(p2Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(404);

    // Property → sibling property.
    const toP2 = await as(manager.token, orgId)
      .put(`/api/training/${id}/scope`)
      .send({ propertyId: p2 });
    expect(toP2.status).toBe(200);
    expect(toP2.body.scope).toMatchObject({ propertyId: p2, locationId: null });
    expect((await as(p2Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(200);
    expect((await as(p1Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(404);

    // Property → org: everyone sees it.
    const toOrg = await as(manager.token, orgId).put(`/api/training/${id}/scope`).send({});
    expect(toOrg.status).toBe(200);
    expect(toOrg.body.scope).toMatchObject({ propertyId: null, locationId: null });
    expect((await as(p1Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(200);
    expect((await as(p2Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(200);

    // Org → location: only that location's branch of the tree sees it.
    const toL1 = await as(manager.token, orgId)
      .put(`/api/training/${id}/scope`)
      .send({ propertyId: p1, locationId: l1 });
    expect(toL1.status).toBe(200);
    expect(toL1.body.scope).toMatchObject({ propertyId: p1, locationId: l1 });
    expect((await as(p1Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(200);
    expect((await as(p2Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(404);
  });

  it('refuses the move below manager', async () => {
    const id = await createPublished('Immovable Module');
    expect(
      (await as(chef.token, orgId).put(`/api/training/${id}/scope`).send({ propertyId: p1 }))
        .status,
    ).toBe(403);
    expect(
      (await as(p1Staff.token, orgId).put(`/api/training/${id}/scope`).send({ propertyId: p1 }))
        .status,
    ).toBe(403);
  });

  it('refuses a move that would strand the allow-list', async () => {
    const id = await createPublished('Restricted Traveler');
    const restricted = await as(chef.token, orgId)
      .put(`/api/training/${id}/access`)
      .send({ access: { userIds: [p1Staff.userId] } });
    expect(restricted.status).toBe(200);

    // A manager holds the moving role but does not bypass the person ACL, so
    // a restricted module they are not listed on answers 404 — before the
    // stranding question even comes up.
    expect(
      (await as(manager.token, orgId).put(`/api/training/${id}/scope`).send({ propertyId: p2 }))
        .status,
    ).toBe(404);

    // The owner bypasses, and hits the real refusal: a P2 home would strand
    // the listed P1 staff member.
    const stranded = await as(owner.token, orgId)
      .put(`/api/training/${id}/scope`)
      .send({ propertyId: p2 });
    expect(stranded.status).toBe(400);
    expect(stranded.body.message).toMatch(/cannot see/);

    // Nothing moved, and the listed member still reads it.
    const detail = await as(owner.token, orgId).get(`/api/training/${id}`);
    expect(detail.body.scope).toMatchObject({ propertyId: null, locationId: null });
    expect((await as(p1Staff.token, orgId).get(`/api/training/${id}`)).status).toBe(200);
  });

  it('widens location-scoped block media as the module moves wider', async () => {
    const photo = await uploadPhoto(owner.token, orgId, { propertyId: p1, locationId: l1 });
    expect(photo.status).toBe(201);

    const id = await createPublished('Illustrated Module', {
      propertyId: p1,
      locationId: l1,
      blocks: [
        { kind: 'image', mediaId: photo.body._id, caption: 'Station setup' },
        textBlock('Set the station like the photo.'),
      ],
    });

    const { Media } = await import('../../features/media/media.model');

    // Location → own property: the asset widens to the property, not the org.
    expect(
      (await as(manager.token, orgId).put(`/api/training/${id}/scope`).send({ propertyId: p1 }))
        .status,
    ).toBe(200);
    let asset = await Media.findById(photo.body._id).lean();
    expect(String(asset!.scope.propertyId)).toBe(p1);
    expect(asset!.scope.locationId).toBeNull();

    // Property → sibling property: no common home below the org, so org-wide.
    expect(
      (await as(manager.token, orgId).put(`/api/training/${id}/scope`).send({ propertyId: p2 }))
        .status,
    ).toBe(200);
    asset = await Media.findById(photo.body._id).lean();
    expect(asset!.scope.propertyId).toBeNull();
    expect(asset!.scope.locationId).toBeNull();

    // The moved module renders for its new audience, image intact.
    const detail = await as(p2Staff.token, orgId).get(`/api/training/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.blocks[0].media).not.toBeNull();
    expect(detail.body.blocks[0].media.url).toBe(photo.body.url);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it("never lets one org see or touch another's trainings", async () => {
    const ownerA = await registerAndLogin('training-iso-a@example.com');
    const ownerB = await registerAndLogin('training-iso-b@example.com');
    const orgA = await createOrg(ownerA.token, 'Training Isolation A');
    const orgB = await createOrg(ownerB.token, 'Training Isolation B');

    const created = await as(ownerA.token, orgA)
      .post('/api/training')
      .send({ title: 'Org A Secrets', blocks: [textBlock('The secret sauce.')] });
    const id = created.body._id;
    await as(ownerA.token, orgA).post(`/api/training/${id}/publish`);

    // Existence hiding: another org's training id answers 404, never 403.
    expect((await as(ownerB.token, orgB).get(`/api/training/${id}`)).status).toBe(404);
    expect(
      (await as(ownerB.token, orgB).patch(`/api/training/${id}`).send({ title: 'Mine' })).status,
    ).toBe(404);
    expect((await as(ownerB.token, orgB).post(`/api/training/${id}/complete`)).status).toBe(404);

    const listB = await as(ownerB.token, orgB).get('/api/training');
    expect(listB.body.items).toHaveLength(0);

    // Nor can org B attach org A's media to its own training.
    const photoA = await uploadPhoto(ownerA.token, orgA);
    const stolen = await as(ownerB.token, orgB)
      .post('/api/training')
      .send({ title: 'Stolen Media', blocks: [{ kind: 'image', mediaId: photoA.body._id }] });
    expect(stolen.status).toBe(404);
  });
});
