# Restaurant Internal Tools — Agent Reference

A reference for AI agents and human contributors working on this codebase. Read
this before making any non-trivial change.

---

## 1. Project Overview

Back-of-house tooling for a restaurant group of roughly 57 locations. It
replaces an isolated legacy recipe/training tool plus the spreadsheets and paper
around it, and it deliberately does **not** compete with the POS, delivery, or
reservation systems already in place.

| Layer | URL (local) |
|---|---|
| API | http://localhost:8888 |
| Web | http://localhost:4321 |
| Admin | http://localhost:4322 |

**This repository is currently a scaffold.** Sections 2–8 describe code that
exists. Section 9 describes the features that do not — do not assume any of it
is implemented.

---

## 2. Monorepo Layout

```
apps/
  admin/        @rit/admin    — Astro + React platform console (superAdmin only, port 4322)
  api/          @rit/api      — Express REST API
  scripts/      @rit/scripts  — Database scripts (tsx, no build step)
  web/          @rit/web      — Astro + React frontend
packages/
  shared/       @rit/shared   — Zod schemas + TypeScript types (zod is its only runtime dep)
```

**Package manager:** pnpm 11 workspaces. **Node:** ≥ 22.

`@rit/*` is a deliberately neutral scope — the product name is still open (see
§10).

---

## 3. Full Stack

### API (`apps/api`)

| Concern | Library |
|---|---|
| Framework | Express 5 |
| Language | TypeScript (compiled by `tsc`, run via `tsx watch` in dev) |
| Database | MongoDB via Mongoose 9 |
| Validation | Zod 4 via `validate()` / `validateQuery()` middleware |
| Auth | JWT (`jsonwebtoken`), bcrypt (`bcryptjs`, 12 rounds) |
| File upload | Multer → Cloudflare R2 (photos buffer in memory; videos stream — see `media/videoStorage.ts`) |
| Security | helmet, cors, express-rate-limit |
| Logging | Morgan (`combined` in prod, `dev` in development) |

Express 5 forwards rejected promises from handlers to the error middleware, so
async route handlers throw `AppError` directly — no `try/catch` wrapper needed.

### Web (`apps/web`)

| Concern | Library |
|---|---|
| Framework | Astro 7 (MPA) |
| Islands | React 19 |
| Styling | TailwindCSS 4 (custom tokens — see §7) |
| Data fetching | TanStack Query 5 |
| Icons | Lucide React |

Every page is behind authentication, so there is no SEO surface: pages are
`noindex`, there is no sitemap, and no page prerenders API data.

### Shared (`packages/shared`)

- `schemas/*.ts` — Zod schemas, the single source of truth for validation.
- `types/domain.ts` — const arrays (`allergenValues`, `tenantRoleValues`, …) and
  the union types derived from them.
- `types/api.ts` — `ApiResult<T>`, `PaginatedResponse<T>`, response shapes.
- Always `import from '@rit/shared'`; never reach into `packages/shared/src`.
- **Build order**: shared compiles first — `pnpm build:shared` or `pnpm build`.

---

## 4. Multi-Tenancy — read this before touching any query

The account hierarchy from the planning doc is **Organization → Independent
Property → Location**, and every tier is a separately billed seat. The
application is multi-tenant from day one; there is no data in the database that
does not belong to exactly one org.

### The scope stamp

Every tenant-owned document embeds:

```ts
scope: { orgId, propertyId: ObjectId | null, locationId: ObjectId | null }
```

`propertyId` and `locationId` are **explicit `null`**, never omitted, when the
document lives higher up the tree. Visibility flows downward and only downward:

| Content scoped at | Visible to |
|---|---|
| org | everyone in the org |
| property | that property and its locations |
| location | that location only |

That is what makes a property's shared recipe book reach all its restaurants
while one restaurant's local menu never leaks sideways to another.

### `lib/scope.ts` is the only place this is decided

| Helper | Use |
|---|---|
| `scopeReadFilter(ctx)` | Compose into **every** find: `Recipe.find({ ...scopeReadFilter(ctx), status: 'approved' })` |
| `scopeForWrite(ctx, target?)` | Produce the scope to stamp on an insert; defaults to the caller's own |
| `assertCanWriteAt(ctx, target)` | Throws unless the caller may write at that scope |
| `assertRole(ctx, minimum)` | Throws unless the caller holds at least `minimum` |
| `tierOf(scope)` | `'org' \| 'property' \| 'location'` from which ids are present |

**Never hand-roll a scope condition in a feature module.** A query that forgets
`scopeReadFilter` returns every tenant's data, and it will look like it works.

### How a request gets its scope

The client sends the scope in headers, not in the path:

```
X-Org-Id       required on every tenant route
X-Property-Id  optional narrowing
X-Location-Id  optional narrowing (requires X-Property-Id)
```

Headers rather than path segments mean the same route works at every tier and no
tenant id lands in access logs or browser history. They are listed in the CORS
`allowedHeaders` — a new scope header must be added there or preflight silently
strips it.

`resolveTenant` (`middleware/resolveTenant.ts`) validates the headers against
the caller's memberships and sets `req.tenant: TenantContext`. Rules it enforces:

- A user may hold several memberships in one org. The **broadest** is their
  entitlement; the headers may narrow within it, never widen it.
- Narrowing outside the entitlement is **404, not 403** — a caller must not be
  able to probe which properties exist in an org they are not in. Existence
  hiding is the house rule throughout this codebase.
- `superAdmin` (platform staff, `User.platformRole`) bypasses membership but
  still gets a resolved scope.

### Roles

`owner > admin > director > manager > chef > staff`, ranked by `roleRank` in
`@rit/shared`. Compare with `roleAtLeast`, never by string equality.

### Platform routes (`/api/platform`)

The one router that deliberately sees every tenant. It serves the platform
console (`apps/admin`) and sits behind `authenticate` + `requireSuperAdmin`
instead of `resolveTenant` — no scope headers, no `scopeReadFilter`. Rules:

- A non-superAdmin caller gets **404, not 403** — the console's routes are
  invisible to customers, same existence-hiding rule as everywhere else.
- `requireSuperAdmin` reads the role from the database on every request, so
  revoking a superAdmin takes effect immediately, not at token expiry.
- A superAdmin cannot suspend or demote **their own** account (409) — any
  removal is done by another superAdmin, so one always remains.
- Platform org creation names the owner by email; the account must already
  exist (no email sending yet), and it reuses `tenancy.createOrganization` so
  the org-always-has-an-owner invariant holds.

Invariants already enforced in `tenancy.service.ts`, worth preserving:

- **You cannot grant a role above your own**, on invite or on update. This is
  the privilege-escalation path that matters.
- **An org must keep at least one active owner.** Demoting or revoking the last
  one is a 409.
- Creating an org makes the creator its owner in the same operation — an org
  with no owner is unreachable forever.
- `Location.orgId` is denormalised from its parent property so scope filters
  need no join. `createLocation` reads the property to copy it and is the only
  writer; the two must never disagree.

---

## 5. Architecture & File Conventions

### API feature structure

Every feature lives in `apps/api/src/features/{feature}/`:

```
{feature}.router.ts      — Express Router; wire middleware + controller methods only
{feature}.controller.ts  — Thin handlers: extract from req → call service → send res
{feature}.service.ts     — All business logic; throws AppError on failure
{feature}.model.ts       — Mongoose model (API-only; never import in web)
{feature}.schema.ts      — Zod schemas local to this feature (or import from @rit/shared)
```

- **Router**: no logic. Middleware order matters:
  `authenticate` → `resolveTenant` → `requireRole(...)` → `validate(schema)` → controller.
- **Controller**: never query the DB. One service call, one response. Cast
  `req.body` to the validated input type.
- **Service**: throws `AppError(message, statusCode, errors?)`. Never sends HTTP
  responses. Takes `TenantContext` as its first argument for tenant-scoped work.
- **Model**: Mongoose schema only, with
  `{ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }`.

### Web component decision

| Situation | Use |
|---|---|
| Static content, no interactivity | `.astro` component |
| Needs `onClick`, local state, refs | React `.tsx` island |
| Needs TanStack Query | React `.tsx` island |
| Page layout / head tags | `.astro` |
| Interactive form | React `.tsx` island |

React islands hydrate with `client:load` unless deferred hydration is clearly
better.

---

## 6. Key Patterns

### Error handling (API)

Always throw `AppError`; `errorHandler` maps it to the response.

```ts
throw new AppError('Recipe not found', 404);
throw new AppError('Validation failed', 400, [{ field: 'email', message: 'Required' }]);
```

`errorHandler` already covers Mongoose `CastError` (→ 400), Multer limit errors
(→ 413/400), and duplicate-key `11000` (→ 409). Do not re-handle those in
services.

### Timestamps

The updated-at field is **`modifiedAt`**, not `updatedAt`. Match it in every
type and response.

### Database queries

- List endpoints paginate with `skip` + `limit`; default `limit = 25`, hard cap
  100 (enforced by `paginationSchema`).
- Use `.lean()` on read-only queries.
- Apply `SAFE_USER_FIELDS` (from `auth.model.ts`) on every user query. Never
  expose `passwordHash` or any token field.
- Compose `scopeReadFilter` into every tenant-scoped query (§4).

### Authentication (API)

- `authenticate` sets `req.userId` from the JWT `sub` claim.
- `optionalAuthenticate` sets it only when a token is present — but a *present
  but invalid* token is still a 401, never a silent downgrade to anonymous.
- Suspension is checked against the database on **every** request
  (`assertAccountActive`), because a JWT stays valid for up to 7 days after it
  is minted. Login also refuses a suspended account so it cannot mint a fresh
  token. **Any new route that accepts a token must go through one of these two
  middlewares — never verify a JWT inline.**

### Client fetch functions (Web)

All return `ApiResult<T>`:

```ts
type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError }
```

Callers check `result.error` first. Error and loading states render inline
(early returns or ternaries in JSX) — no separate error-boundary components.

Every request goes through `apiRequest` in `src/api/client.ts`, which attaches
the bearer token and the scope headers. Pass `scoped: false` for the few routes
that run outside a tenant (login, register, create-organization).

### Auth token (Web)

- Token in `localStorage` as `rit_token`; active scope as `rit_scope`.
- The inline `<script is:inline>` in `BaseLayout.astro` sets `data-authed` on
  `<html>` before first paint, so `[data-requires-auth]` content never flashes.
- Changing scope triggers a full page reload — every cached query is
  scope-dependent, and keeping any of it across a switch would render one
  tenant's data under another's header.

---

## 7. Design System (Tailwind)

Custom tokens only:

| Token | Character | Use |
|---|---|---|
| `steel` | Brushed stainless | Chrome, headings, body text |
| `ember` | Flame orange | Primary CTA, active state |
| `basil` | Fresh herb green | Success, verified, approved |
| `citron` | Yellow | Warning, and **awaiting human review** |
| `chili` | Red | **Allergen and danger only** |
| `salt` | Near-white neutrals | Surfaces, borders, muted text |

**`chili` is reserved.** On this product red must mean "someone could get hurt";
using it as a generic accent trains staff to ignore it.

**Typography:** `font-sans` (Inter) for everything, `font-mono` (JetBrains Mono)
for quantities and codes.

**Breakpoints** (mobile-first, named only — no `sm:`/`md:`/`lg:`/`xl:`):
`mobile` (375) → `phablet` (480) → `tablet` (768) → `laptop` (1024) →
`desktop` (1280) → `wide` (1536) → `ultra` (1920).

`tablet` is the important one: the reader app is iPad-first.

**Touch targets:** anything tappable gets `min-h-touch` (44px). Staff are
wearing gloves and moving fast.

---

## 8. Environment Variables

### API (`apps/api/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | ✅ | — | MongoDB URI |
| `JWT_SECRET` | ✅ | — | High-entropy random string |
| `JWT_EXPIRES_IN` | | `7d` | Token lifetime |
| `PORT` | | `8888` | Listen port |
| `NODE_ENV` | | `development` | Affects morgan format; `test` skips rate limiters |
| `CORS_ORIGIN` | | (empty) | Comma-separated allowed origins in production |
| `TRUST_PROXY` | | `1` | Reverse-proxy hops. Drives `req.ip`, which every rate limiter keys on. Never `true` — clients could then forge `X-Forwarded-For` and pick their own bucket. |
| `WEB_URL` | | `http://localhost:4321` | Used for links in outbound mail |
| `ANTHROPIC_API_KEY` | | (empty) | Enables the LLM features (translation, recipe drafting). All off when unset. |
| `LLM_MODEL` | | `claude-sonnet-5` | Model for every LLM call |
| `TRANSLATION_ENABLED` | | `true` | Set `false` to disable machine translation without removing the key |
| `AI_DRAFTING_ENABLED` | | `true` | Set `false` to disable AI recipe drafting without removing the key |
| `CLOUDFLARE_ACCOUNT_ID`, `R2_*` | | (empty) | Media storage |

### Web (`apps/web/.env`)

| Variable | Default | Notes |
|---|---|---|
| `PUBLIC_API_BASE_URL` | `http://localhost:8888` | Must start with `PUBLIC_` |

### Admin (`apps/admin/.env`)

| Variable | Default | Notes |
|---|---|---|
| `PUBLIC_API_BASE_URL` | `http://localhost:8888` | Same API as the customer app |

---

## 9. Not Yet Built

Each folder under `apps/api/src/features/` holds a README with the files to
create, the design decisions to settle, and the invariants to preserve. Read the
relevant one before starting.

### Phase 1 — the wedge (the demoable prototype)

| Feature | Folder | Note |
|---|---|---|
| Recipe data model | `features/recipes` | **Done** — everything else reads from it |
| LLM EN→ES translation + review gate | `features/translations` | **Done** — machine output lands `pending_review`; chef edits/approves; activating a different version (or renaming) makes approved text stale and staff-invisible; reader's Español toggle renders approved+current only |
| AI recipe drafting | `features/drafting` | **Done** — photos → structured proposals (review-first; nothing persists until a chef creates each as an ordinary unpublished draft). Tags transcribed only, never inferred |
| Allergen lookup | `features/allergens` | Exclusion-based; highest liability |
| R&D recipe bank | `features/rdBank` | |
| Training modules | `features/training` | **Done** — blocks + publish gate + completions; translation gate pending |
| Media storage | `features/media` | **Photos & streamed video done**; transcoding still open |
| Reader app | web only | **Done** — `/reader` browses live recipes + published training; detail views render only the live/published snapshot, even for chefs |

### Phase 2 (post-commitment)

Configurable line checks (`features/lineChecks`, stubbed), automated prep lists,
batch traceability.

### Phase 3

Toast / Craftable integration for theoretical-vs-actual variance. Scoping is
contingent on confirming API access and partner-program requirements.

### Also missing

- **Email sending.** `inviteMember` therefore returns 501 for an address with no
  account rather than silently dropping the invite, and memberships are created
  `active` instead of `invited`. When email lands: flip the status back to
  `invited` and add an acceptance route.
- Email verification and password reset (the `User` fields exist).
- Offline capture (see the `lineChecks` README — it changes the id-generation
  and idempotency story).
- Native iOS/Android apps. The web reader is iPad-first responsive, and all
  domain logic lives in `@rit/shared` so an Expo app can consume it later.

### Explicitly out of scope

POS, payment processing, delivery routing, payroll, reservations, and hardware
integrations (IoT sensors, Bluetooth thermometers, label printers).

---

## 10. Safety & Liability

This product tells kitchen staff what is in the food. Two rules override
convenience everywhere:

1. **Nothing machine-generated reaches staff without a human approving it.**
   `ApprovalStatus` (`draft → pending_review → approved | rejected`) and
   `PUBLISHABLE_STATUS` in `@rit/shared` encode this. `approved` is the only
   readable state. Record who approved and when. Editing a source document must
   knock its approved translations back to `pending_review`.
2. **An absent allergen tag is not a claim of safety.** The lookup is
   exclusion-based: it answers "what must this guest avoid". Untagged or
   unreviewed dishes must never appear in a "safe" result. Allergens propagate
   upward through sub-recipes — a dish is only as safe as its deepest component.
   The LLM may translate an allergen *label*; it must never decide which tags
   apply.

Standard security notes:

- Passwords hashed with bcrypt at 12 rounds. Login compares against a dummy hash
  when the account does not exist, so a missing account and a wrong password
  take the same time to answer.
- Upload filenames derive from the server-validated MIME type, never the
  client's filename. `sniffImage` (`lib/imageMeta.ts`) parses the file's own
  header and is the only thing that decides an upload's type — an unparseable
  file is a 415. Route new upload kinds through it rather than trusting
  `file.mimetype`.
- Rate limiters key on `req.ip`, so `TRUST_PROXY` must match the deployment.
- `errorHandler` never returns a stack trace.

---

## 11. Testing

**Framework:** Vitest everywhere. `vitest run` for CI, `vitest` for watch.

| Package | Path | What's tested |
|---|---|---|
| `@rit/shared` | `packages/shared/src/__tests__/` | Zod schema validation (pure unit) |
| `@rit/api` | `apps/api/src/__tests__/unit/` | `AppError`, scope helpers, middleware, service logic (Mongoose mocked) |
| `@rit/api` | `apps/api/src/__tests__/integration/` | Full HTTP round-trips via supertest + `mongodb-memory-server` |

Writing tests:

- Mock Mongoose models with `vi.mock('path/to/model')` using the same path the
  service uses (no `.js` extension on relative imports).
- Use `vi.resetAllMocks()` — not `vi.clearAllMocks()` — in `beforeEach`;
  `clearAllMocks` leaves `mockReturnValueOnce` queues intact and contaminates
  later tests.
- Integration tests spin up their own `MongoMemoryServer` in `beforeAll` and
  wipe collections in `beforeEach`.
- `src/__tests__/setup.ts` sets the env vars `config/env.ts` requires at import
  time and forces `NODE_ENV=test`, which makes every rate limiter skip.

**Tenant isolation deserves a test in every feature you add**: seed two orgs,
query as a member of one, assert the other's documents are absent. That is the
regression that would otherwise ship silently.

---

## 12. Adding a New API Feature

1. Create `apps/api/src/features/{feature}/` with the five files from §5.
2. Define Zod schemas in `{feature}.schema.ts`, or promote them to
   `@rit/shared` if the web app needs them too.
3. Define the Mongoose model with the `modifiedAt` timestamp config **and an
   embedded `scope` sub-document**. Index `scope.orgId` alongside whatever the
   feature queries on.
4. Write the service: take `TenantContext` first, compose `scopeReadFilter` into
   reads, stamp `scopeForWrite` on writes, throw `AppError`.
5. Write thin controllers.
6. Wire the router: `authenticate` → `resolveTenant` → `requireRole` →
   `validate` → controller. Mount it in `app.ts`.
7. Add shared response types to `packages/shared/src/types/api.ts` and export
   them from the barrel.
8. Test tenant isolation.

## 13. Adding a New Web Page

1. Create `apps/web/src/pages/{name}.astro` using `BaseLayout`.
2. Leave `requireAuth` at its default unless the page is genuinely public
   (`/login` is the only one today).
3. Extract any interactive section to a React island in `components/`.
4. Wrap islands that use TanStack Query in `QueryProvider`.
5. Add client fetch functions to the relevant `src/api/*.ts`, returning
   `ApiResult<T>`, and handle both branches inline.
6. Include the scope in query keys for anything tenant-scoped.
