# Restaurant Internal Tools

Back-of-house tooling for a ~57-location restaurant group: structured recipes,
training content, LLM-assisted EN→ES translation behind a human review gate,
and allergen lookup. Replaces the isolated legacy tool and the spreadsheets
around it.

**Status: scaffold.** Workspaces, configuration, authentication, multi-tenancy
and error handling are implemented. The Phase 1 features are empty folders with
a README each describing what to build. See
[AGENTS.md](AGENTS.md) for the full reference.

## Stack

Mirrors the `meusmenu-monorepo` conventions.

| Layer | Package | Stack |
|---|---|---|
| API | `@rit/api` | Express 5 · Mongoose 9 · Zod 4 · JWT |
| Web | `@rit/web` | Astro 7 (MPA) · React 19 islands · Tailwind 4 · TanStack Query 5 |
| Shared | `@rit/shared` | Zod schemas + derived types, no framework deps |
| Scripts | `@rit/scripts` | tsx, no build step |

pnpm 11 workspaces, Node ≥ 22, Vitest throughout.

## Getting started

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # set MONGO_CONNECTION_STRING + JWT_SECRET
cp apps/web/.env.example apps/web/.env

pnpm build:shared                        # shared must compile before the apps
pnpm -F @rit/scripts seed-demo-tenant -- owner@example.com 'change-me-please'
pnpm dev                                 # API on :8888, web on :4321
```

Sign in at <http://localhost:4321/login>.

## Commands

```bash
pnpm dev              # API + web in parallel
pnpm dev:api          # API only (tsx watch)
pnpm dev:web          # web only (astro dev)
pnpm build            # build everything in dependency order
pnpm typecheck        # shared + api
pnpm test             # shared + api
pnpm test:coverage    # with V8 coverage

pnpm -F @rit/scripts stats                                     # per-tenant summary
pnpm -F @rit/scripts seed-demo-tenant -- <email> '<password>'  # demo org/properties/locations
pnpm -F @rit/scripts set-platform-role -- <email> superAdmin   # platform staff access
```

## What is built

- **Auth** — register, login, `/me`, password change. bcrypt (12 rounds), JWT,
  suspension enforced on every request rather than at token-mint time.
- **Multi-tenancy** — Organization → Property → Location, with per-scope
  memberships and roles. Scope travels in request headers; `lib/scope.ts` is the
  one place read filters and write permissions are decided.
- **Web shell** — auth-gated layout, login form, scope switcher, typed API
  client that attaches the scope headers automatically.

## What is not

Every Phase 1 feature. Each has a folder under `apps/api/src/features/` with a
README covering the files to create, the design decisions to settle, and the
invariants to preserve:

`recipes` · `translations` · `allergens` · `rdBank` · `training` · `media` ·
`lineChecks` (Phase 2)

Also unbuilt: email sending (so invites only work for users who already have an
account), offline capture, and any external integration (Toast, Craftable,
7shifts).

## Naming

The product name is still open — the planning doc shortlists Paratus, Paratus
Culina, Nexus Kitchen, Core Culinary and Mise. Packages use the neutral `@rit/*`
scope, and all user-facing strings live in
`apps/web/src/assets/site-content/site-info.ts`, so a rename touches one file
plus a scope-wide find/replace.
