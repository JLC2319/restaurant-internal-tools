# Restaurant Internal Tools — Agent Reference

A reference for AI agents and human contributors working on this codebase. Read
this before making any non-trivial change.

**Every section here is a durable rule.** Anything that goes stale — feature
status, library versions, env var lists, machine setup — lives in
[`docs/`](docs/) and is linked from the section that used to hold it.

**Before you call a change done, run `pnpm verify`** (format, typecheck, lint,
test — the same gate CI runs). See §11.

---

## 1. Project Overview

Back-of-house tooling for a restaurant group of roughly 57 locations. It
replaces an isolated legacy recipe/training tool plus the spreadsheets and paper
around it, and it deliberately does **not** compete with the POS, delivery, or
reservation systems already in place.

| Layer                    | URL (local)           |
| ------------------------ | --------------------- |
| API                      | http://localhost:9317 |
| Web                      | http://localhost:6218 |
| Admin                    | http://localhost:6219 |
| Mobile (Expo dev server) | http://localhost:8081 |

Phase 1 is built — recipes, training, translation with its review gate, AI
drafting, media, and the reader all exist and have tests. Check
[docs/ROADMAP.md](docs/ROADMAP.md) for what is still open, and trust the code
over that table where they disagree.

---

## 2. Monorepo Layout

```
apps/
  admin/        @rit/admin    — Astro + React platform console (superAdmin only, port 6219)
  api/          @rit/api      — Express REST API
  mobile/       @rit/mobile   — Expo (React Native) reader app (see apps/mobile/README.md)
  scripts/      @rit/scripts  — Database scripts (tsx, no build step)
  web/          @rit/web      — Astro + React frontend
packages/
  shared/       @rit/shared   — Zod schemas + TypeScript types (zod is its only runtime dep)
```

**Package manager:** pnpm 11 workspaces. **Node:** ≥ 22.

`@rit/*` is a deliberately neutral scope — the product name is still open (see
"Naming" in the [README](README.md)). All user-facing strings live in
`apps/web/src/assets/site-content/site-info.ts`, so a rename touches that file
plus a scope-wide find/replace.

---

## 3. Full Stack

Library-by-library tables for every app: [docs/STACK.md](docs/STACK.md).

The three stack facts that change how you write code:

- **API** — Express 5 forwards rejected promises from handlers to the error
  middleware, so async route handlers throw `AppError` directly; no `try/catch`
  wrapper needed.
- **Shared** — always `import from '@rit/shared'`; never reach into
  `packages/shared/src`. It must compile before anything typechecks against it,
  which `pnpm typecheck` and `pnpm test` now handle for you.
- **Web & Admin** — Astro MPA with React islands. Every page sits behind auth,
  so there is no SEO surface: pages are `noindex`, there is no sitemap, and no
  page prerenders API data.

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

| Content scoped at | Visible to                      |
| ----------------- | ------------------------------- |
| org               | everyone in the org             |
| property          | that property and its locations |
| location          | that location only              |

That is what makes a property's shared recipe book reach all its restaurants
while one restaurant's local menu never leaks sideways to another.

### `lib/scope.ts` is the only place this is decided

| Helper                          | Use                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `scopeReadFilter(ctx)`          | Compose into **every** find: `Recipe.find({ ...scopeReadFilter(ctx), status: 'approved' })` |
| `scopeForWrite(ctx, target?)`   | Produce the scope to stamp on an insert; defaults to the caller's own                       |
| `assertCanWriteAt(ctx, target)` | Throws unless the caller may write at that scope                                            |
| `assertRole(ctx, minimum)`      | Throws unless the caller holds at least `minimum`                                           |
| `tierOf(scope)`                 | `'org' \| 'property' \| 'location'` from which ids are present                              |

**Never hand-roll a scope condition in a feature module.** A query that forgets
`scopeReadFilter` returns every tenant's data, and it will look like it works.

### Person-level access (the layer under scope)

A recipe or training module may carry `access: { userIds } | null` — an
allow-list that narrows visibility **within** its scope; `null` (or absent, on
pre-feature docs) means everyone in scope. It never widens scope:
`features/tenancy/personAccess.ts` builds `personAccessFilter(ctx)`, which every
gated read composes **beside** `scopeReadFilter` (the field contract: the model
stores the list at `access` and its creator at `createdBy`). Fixed bypass set:
the document's `createdBy`, roles admin-or-above at the scope
(directors/managers do **not** bypass), and platform staff. Out-of-list reads
404 exactly like out-of-scope ones.

Rules that keep it sound:

- `RecipeVersion` deliberately does not denormalise `access` (it mutates freely;
  the scope stamp changes only through `moveRecipe`, which rewrites the
  denormalised copies — versions, translations — in the same act). Every version
  read must load the head through the filter first; a standalone RecipeVersion
  query is an ACL bypass by construction.
- Translations gate in `translation.service.loadHead`; the list endpoint's one
  filter object also covers `total` and the `?q=` regex, so counts and name
  probes reveal nothing.
- Deliberately ungated, each with a comment at the site: `subNamesFor` (a
  restricted sub-recipe's **name** on a consuming recipe's ingredient line is an
  accepted, product-approved leak), `assertNoCycle`, and the archive usage
  guards.
- `validateSubRefs` checks access on **new** references only — `accessExemptIds`
  grandfathers refs a document already carries, so restricting a recipe never
  bricks resaves of its consumers.
- The allow-list may only name people whose membership can see the recipe's
  scope (`assertAccessListValid`, using `membershipReadersFilter` — the inverse
  of `scopeReadFilter`, in `lib/scope.ts`). Editing it requires currently
  _reading_ the recipe plus `canManage`; forks never copy it.
- Known v1 limits: R2 photo URLs already handed out stay fetchable (unsigned,
  immutable-cached), and auto-translation still sends restricted text to the LLM
  (the stored translation is read-gated).

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
the caller's memberships and sets `req.tenant: TenantContext`. Rules it
enforces:

- A user may hold several memberships in one org. The **broadest** is their
  entitlement; the headers may narrow within it, never widen it.
- Narrowing outside the entitlement is **404, not 403** — a caller must not be
  able to probe which properties exist in an org they are not in. Existence
  hiding is the house rule throughout this codebase.
- `superAdmin` (platform staff, `User.platformRole`) bypasses membership but
  still gets a resolved scope.

### Tenant settings inherit down the same tree

Every tier carries a `settings` sub-document (`tenantSettings.model.ts`). The
org's values are concrete; a property's and a location's are **overrides**,
where `null` means "inherit from the parent". Resolution is narrowest-first —
location → property → org — via `resolveTranslationPublishMode` in
`@rit/shared`, which both apps import so the UI's preview and the server's
decision can never disagree.

- Resolve against the **document's** scope, not the caller's `TenantContext`. A
  property's shared recipe book must behave the same way whoever publishes into
  it, and switching your active scope must not change what publishing does.
- A child's override defaults to `null`, never to a copy of the parent's value.
  Copying pins the child and makes the parent setting unchangeable in effect.
- Patch settings with **dot-notation** keys (`applySettingsPatch` in
  `tenancy.service.ts`). Handing Mongoose `{ settings: {…} }` whole replaces the
  sub-document and silently clears every setting the client did not send.
- Changing settings is admin-only at every tier, even where the surrounding
  update is not (`updateLocation` is otherwise open to a manager).

Two settings live here today:

- `translationPublishMode` (`manual | auto_review | auto_publish` — see §10),
  resolved by `resolveTranslationPublishMode`.
- `recipePublishMode` (`manual | publish_on_save | publish_on_save_verified`),
  resolved by `resolveRecipePublishMode`. How much ceremony stands between
  writing a **brand-new** recipe and staff cooking from it. It is _not_ a second
  exception to §10 — it changes how many clicks a chef spends, never who signs
  off.

Adding another means one field on each schema in `tenantSettings.model.ts`, one
on `ITenantSettings` / `ITenantSettingsOverride`, one on the Zod schemas, and
one entry in the web settings shell's section array. The two publishing cards
share their picker, override rows and PATCH wiring via
`features/settings/PublishModeSettings.tsx`; a third setting of this shape
should use it rather than copy either card.

`recipePublishMode` has **two** defaults, and the split is load-bearing. The
Mongoose default (`NEW_ORG_RECIPE_PUBLISH_MODE`, `publish_on_save`) stamps orgs
created from now on — onboarding is exactly when a kitchen has a whole book to
type in. `DEFAULT_RECIPE_PUBLISH_MODE` (`manual`) is the inheritance floor that
orgs predating the field resolve to, so nobody's flow changes under them.
Collapsing the two constants silently changes behaviour for every existing
tenant.

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
- Platform org creation names the owner by email; the account must already exist
  (no email sending yet), and it reuses `tenancy.createOrganization` so the
  org-always-has-an-owner invariant holds.

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

- **Router**: no logic. Middleware order matters: `authenticate` →
  `resolveTenant` → `requireRole(...)` → `validate(schema)` → controller.
- **Controller**: never query the DB. One service call, one response. Cast
  `req.body` to the validated input type.
- **Service**: throws `AppError(message, statusCode, errors?)`. Never sends HTTP
  responses. Takes `TenantContext` as its first argument for tenant-scoped work.
- **Model**: Mongoose schema only, with
  `{ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } }`.

### Web component decision

| Situation                          | Use                 |
| ---------------------------------- | ------------------- |
| Static content, no interactivity   | `.astro` component  |
| Needs `onClick`, local state, refs | React `.tsx` island |
| Needs TanStack Query               | React `.tsx` island |
| Page layout / head tags            | `.astro`            |
| Interactive form                   | React `.tsx` island |

React islands hydrate with `client:load` unless deferred hydration is clearly
better.

**Settings pages use `SettingsShell`** (`components/ui/SettingsShell.tsx`): a
sidebar on laptop and up, a tab strip below, one section rendered at a time, and
the active section in the URL hash. Both `/organization` and `/profile` are
built from it. Sections are a data array, so a new setting is one more entry
rather than another card on a growing scroll.

- Each section renders its own `SectionCard` header — the shell adds none.
- Ids are the URL hash: renaming one breaks anybody's bookmark.
- Keep the whole page inside **one** island so every section shares a
  `QueryProvider` cache instead of refetching the same profile per card.
- Only the open section is mounted. That is load-bearing in two places: a
  section's query does not fire until it is opened, and leaving the password
  section clears the half-typed credentials in it.

---

## 6. Key Patterns

### Error handling (API)

Always throw `AppError`; `errorHandler` maps it to the response.

```ts
throw new AppError('Recipe not found', 404);
throw new AppError('Validation failed', 400, [
  { field: 'email', message: 'Required' },
]);
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
- `optionalAuthenticate` sets it only when a token is present — but a _present
  but invalid_ token is still a 401, never a silent downgrade to anonymous.
- Suspension is checked against the database on **every** request
  (`assertAccountActive`), because a JWT stays valid for up to 7 days after it
  is minted. Login also refuses a suspended account so it cannot mint a fresh
  token. **Any new route that accepts a token must go through one of these two
  middlewares — never verify a JWT inline.**

### Client fetch functions (Web)

All return `ApiResult<T>`:

```ts
type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };
```

Callers check `result.error` first. Error and loading states render inline
(early returns or ternaries in JSX) — no separate error-boundary components.

Every request goes through `apiRequest` in `src/lib/api/client.ts`, which
attaches the bearer token and the scope headers. Pass `scoped: false` for the
few routes that run outside a tenant (login, register, create-organization).

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

| Token    | Character           | Use                                    |
| -------- | ------------------- | -------------------------------------- |
| `steel`  | Brushed stainless   | Chrome, headings, body text            |
| `ember`  | Flame orange        | Primary CTA, active state              |
| `basil`  | Fresh herb green    | Success, verified, approved            |
| `citron` | Yellow              | Warning, and **awaiting human review** |
| `chili`  | Red                 | **Allergen and danger only**           |
| `salt`   | Near-white neutrals | Surfaces, borders, muted text          |

**`chili` is reserved.** On this product red must mean "someone could get hurt";
using it as a generic accent trains staff to ignore it.

**Typography:** `font-sans` (Inter) for everything, `font-mono` (JetBrains Mono)
for quantities and codes.

**Breakpoints** (mobile-first, named only — no `sm:`/`md:`/`lg:`/`xl:`):
`mobile` (375) → `phablet` (480) → `tablet` (768) → `laptop` (1024) → `desktop`
(1280) → `wide` (1536) → `ultra` (1920).

`tablet` is the important one: the reader app is iPad-first.

**Touch targets:** anything tappable gets `min-h-touch` (44px). Staff are
wearing gloves and moving fast.

---

## 8. Environment Variables

Every variable each app reads, with defaults:
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md). Local machine setup — runtimes,
database, simulators — is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## 9. Feature Status & Roadmap

What exists, what is planned, and what is deliberately out of scope:
[docs/ROADMAP.md](docs/ROADMAP.md). Each `apps/api/src/features/*` folder also
holds a README with the design decisions and invariants for that feature — read
the relevant one before starting.

---

## 10. Safety & Liability

This product tells kitchen staff what is in the food. Two rules override
convenience everywhere:

1. **Nothing machine-generated reaches staff without a human approving it.**
   `ApprovalStatus` (`draft → pending_review → approved | rejected`) and
   `PUBLISHABLE_STATUS` in `@rit/shared` encode this. `approved` is the only
   readable state. Record who approved and when. Editing a source document must
   knock its approved translations back to `pending_review`.

   **The one exception, and its terms.** A tenant may set
   `settings.translationPublishMode` to `auto_publish` (see §4), which lets a
   machine translation reach staff unread. It is opt-in per scope, off by
   default, and admin-only to change. Everything that carries it must:
   - store `autoApproved: true` with **`approvedBy: null`** — never forge a
     signature for a review that did not happen;
   - clear `autoApproved` the moment a human edits, approves or rejects it;
   - render as unreviewed everywhere it appears, including in Spanish on the
     reader (`readerEs.aiUnreviewed` / `unreviewedWarning`).

   Do not extend this exception to allergen tags, and do not add a second
   feature that reuses it. Rule 2 below has no equivalent escape hatch.

   **`recipePublishMode` is not a second exception**, and the distinction is
   worth holding onto. It changes how many clicks a chef spends publishing a new
   recipe; it never changes who signs off. `publish_on_save` offers the allergen
   tick beside the publish switch and `publish_on_save_verified` insists on it,
   but in both cases the stamp records the human who ticked it — there is no
   mode in which the server approves a tag on its own, and `approveAllergens`
   defaults to `false` precisely so an omitted field can never be read as a
   signature. A recipe published without the tick reaches staff showing no
   allergen tags and the unverified warning, which is rule 2 working, not a gap
   in it.

2. **An absent allergen tag is not a claim of safety.** Only `approved` tags
   reach staff; an untagged or unreviewed dish must never read as safe.
   Allergens propagate upward through sub-recipes — a dish is only as safe as
   its deepest component. The LLM may translate an allergen _label_; it must
   never decide which tags apply.

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

## 11. Verifying & Testing

### `pnpm verify` is the gate

One command, and it is exactly what CI runs:

```bash
pnpm verify     # format:check → typecheck → lint → test
```

| Command          | Covers                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| `pnpm format`    | Prettier, write mode. `format:check` is the CI-safe variant             |
| `pnpm typecheck` | `tsc --noEmit` in shared/api/mobile/scripts, `astro check` in web/admin |
| `pnpm lint`      | ESLint via `expo lint` (mobile) — correctness rules Prettier can't see  |
| `pnpm test`      | Vitest in shared + api                                                  |

`typecheck` and `test` build `@rit/shared` first, because the other packages
resolve it through its emitted `.d.ts` files. Each uses `pnpm -r`, so a new
package with a `typecheck`/`test`/`lint` script is picked up with no wiring.

**Integration tests share one mongod.** `src/__tests__/globalSetup.ts` boots it
once; each file takes its own database via `connectToTestDb('<name>')` — a new
file needs a name no other file uses. Residual flakiness is still possible, so
re-run a failing file alone before believing it. See
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

### Framework

**Vitest everywhere.** `vitest run` for CI, `vitest` for watch.

| Package       | Path                                  | What's tested                                                          |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `@rit/shared` | `packages/shared/src/__tests__/`      | Zod schema validation (pure unit)                                      |
| `@rit/api`    | `apps/api/src/__tests__/unit/`        | `AppError`, scope helpers, middleware, service logic (Mongoose mocked) |
| `@rit/api`    | `apps/api/src/__tests__/integration/` | Full HTTP round-trips via supertest + `mongodb-memory-server`          |

Writing tests:

- Mock Mongoose models with `vi.mock('path/to/model')` using the same path the
  service uses (no `.js` extension on relative imports).
- Use `vi.resetAllMocks()` — not `vi.clearAllMocks()` — in `beforeEach`;
  `clearAllMocks` leaves `mockReturnValueOnce` queues intact and contaminates
  later tests.
- Integration tests connect in `beforeAll` with
  `connectToTestDb('<unique-name>')` and tear down with `disconnectTestDb()`,
  which drops that database. They do **not** boot their own server — see above.
- `src/__tests__/setup.ts` sets the env vars `config/env.ts` requires at import
  time and forces `NODE_ENV=test`, which makes every rate limiter skip.

**Tenant isolation deserves a test in every feature you add**: seed two orgs,
query as a member of one, assert the other's documents are absent. That is the
regression that would otherwise ship silently.

---

## 12. Adding a New API Feature

1. Create `apps/api/src/features/{feature}/` with the five files from §5.
2. Define Zod schemas in `{feature}.schema.ts`, or promote them to `@rit/shared`
   if the web app needs them too.
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
8. Test tenant isolation (§11) — seed two orgs, query as one, assert the other's
   documents are absent.
9. Run `pnpm verify`.

## 13. Adding a New Web Page

1. Create `apps/web/src/pages/{name}.astro` using `BaseLayout`.
2. Leave `requireAuth` at its default unless the page is genuinely public
   (`/login` is the only one today).
3. Extract any interactive section to a React island in the owning
   `features/<feature>/` directory; shared atoms come from `components/ui`.
   Internal imports use the `@/` alias (`@/components/ui`,
   `@/lib/QueryProvider`).
4. Wrap islands that use TanStack Query in `QueryProvider`.
5. Add client fetch functions to that feature's `features/<feature>/api.ts`
   (cross-feature client, drafts and media modules live in `src/lib/api/`),
   returning `ApiResult<T>`, and handle both branches inline.
6. Include the scope in query keys for anything tenant-scoped.
7. Run `pnpm verify`.
