# Restaurant Internal Tools

Back-of-house tooling for a ~57-location restaurant group: structured recipes
with human-verified allergen tags, training content, and LLM-assisted EN→ES
translation behind a human review gate. Replaces the isolated legacy tool and
the spreadsheets around it.

**Status: Phase 1 built.** Auth, multi-tenancy, recipes, training, translation
behind its review gate, AI drafting, media and the reader all exist and are
tested — see "What is built" below. [AGENTS.md](AGENTS.md) is the engineering
reference; [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the sharp edges.

## Stack

Mirrors the `meusmenu-monorepo` conventions.

| Layer   | Package        | Stack                                                            |
| ------- | -------------- | ---------------------------------------------------------------- |
| API     | `@rit/api`     | Express 5 · Mongoose 9 · Zod 4 · JWT                             |
| Web     | `@rit/web`     | Astro 7 (MPA) · React 19 islands · Tailwind 4 · TanStack Query 5 |
| Admin   | `@rit/admin`   | Same stack as web — superAdmin console on port 6219              |
| Mobile  | `@rit/mobile`  | Expo SDK 57 (React Native) · expo-router · NativeWind 4          |
| Shared  | `@rit/shared`  | Zod schemas + derived types, no framework deps                   |
| Scripts | `@rit/scripts` | tsx, no build step                                               |

pnpm 11 workspaces, Node ≥ 22, Vitest throughout.

## Getting started

### Prerequisites

- **Node ≥ 22 and pnpm ≥ 11** — with [mise](https://mise.jdx.dev):
  `mise use -g node@22 pnpm@11`; or `corepack enable` on an existing Node 22.
- **MongoDB** — either local
  (`brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`)
  or a MongoDB Atlas cluster; the URI goes in `apps/api/.env`.
- **iOS simulator only:** full Xcode, installed _and_ selected —
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. The
  standalone Command Line Tools cannot run the simulator.

### Setup

```bash
pnpm install

cp apps/api/.env.example apps/api/.env       # set MONGODB_URI; JWT_SECRET: openssl rand -base64 48
cp apps/web/.env.example apps/web/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env # simulator OK as-is; physical device needs your LAN IP

pnpm build:shared                        # shared must compile before the apps
pnpm -F @rit/scripts seed-demo-tenant owner@example.com 'change-me-please'
pnpm -F @rit/scripts set-platform-role owner@example.com superAdmin  # optional: admin console access
pnpm dev                                 # API on :9317, web on :6218, admin on :6219
```

Sign in at <http://localhost:6218/login>. The platform console is at
<http://localhost:6219/login> — it needs an account with
`platformRole: superAdmin` (seeded by `set-platform-role` above).

## Commands

```bash
# Day to day
pnpm dev              # API + web + admin in parallel (everything except mobile)
pnpm dev:all          # the above plus the mobile Expo dev server

# One app at a time
pnpm dev:api          # API only (tsx watch, :9317)
pnpm dev:web          # web only (astro dev, :6218)
pnpm dev:admin        # platform console only (astro dev, :6219)
pnpm dev:mobile       # Expo dev server only (:8081) — press i / a for a simulator
pnpm dev:mobile:ios   # Expo dev server + boot the iOS simulator
pnpm dev:mobile:sims  # …+ open it in an iPhone and an iPad simulator at once
pnpm dev:mobile:android

# Checks & builds
pnpm verify           # format:check + typecheck + lint + test — the CI gate
pnpm build            # build everything in dependency order
pnpm format           # Prettier, write mode (format:check to only report)
pnpm typecheck        # tsc in shared/api/mobile/scripts, astro check in web/admin
pnpm lint             # ESLint via expo lint (mobile)
pnpm test             # shared + api
pnpm test:coverage    # with V8 coverage

# Database scripts
pnpm -F @rit/scripts stats                                  # per-tenant summary
pnpm -F @rit/scripts seed-demo-tenant <email> '<password>'  # demo org/properties/locations
pnpm -F @rit/scripts set-platform-role <email> superAdmin   # platform staff access
pnpm -F @rit/scripts create-user <email> '<password>'       # pre-verified account
pnpm -F @rit/scripts verify-email <email>                   # flip emailVerified by hand
```

## What is built

- **Auth** — register, login, `/me`, password change. bcrypt (12 rounds), JWT,
  suspension enforced on every request rather than at token-mint time.
- **Multi-tenancy** — Organization → Property → Location, with per-scope
  memberships and roles. Scope travels in request headers; `lib/scope.ts` is the
  one place read filters and write permissions are decided.
- **Web shell** — auth-gated layout, login/sign-up forms, scope switcher, typed
  API client that attaches the scope headers automatically.
- **Platform console** (`apps/admin`) — superAdmin-only dashboard on port 6219:
  cross-tenant stats, org provisioning/suspension, and user management, backed
  by `/api/platform` routes that answer 404 to non-staff.
- **Recipes** — structured recipes with sub-recipes, immutable versions, one
  live version per lineage, forking, and human allergen sign-off. A brand-new
  recipe can skip straight to staff with "Publish on save" where the scope's
  `recipePublishMode` allows it; anything already live still changes the
  deliberate way.
- **Training** — modules built from rich text, photos and video behind a publish
  gate, with per-person completions.
- **Reader** — iPad-first `/reader` surface for the line: live recipes and
  published training only, even for chefs.
- **Translations** — LLM EN→ES translation of live recipes behind a mandatory
  human review gate. Chefs translate, review side by side, edit and approve; the
  reader's Español toggle only ever shows approved, current text.
- **AI drafting** — photos of recipe cards/pages in, structured recipe proposals
  out. Review-first: nothing is saved until a chef creates each proposal, and
  what that creates is an ordinary draft unless the chef turns on "Publish on
  save" for it.

## What is not

Configurable line checks (`features/lineChecks`, Phase 2 — its README covers the
files to create and the invariants to preserve) and video transcoding in
`media`.

Also unbuilt: email sending (so invites only work for users who already have an
account), offline capture, and any external integration (Toast, Craftable,
7shifts).

## Naming

The product name is still open — the planning doc shortlists Paratus, Paratus
Culina, Nexus Kitchen, Core Culinary and Mise. Packages use the neutral `@rit/*`
scope, and all user-facing strings live in
`apps/web/src/assets/site-content/site-info.ts`, so a rename touches one file
plus a scope-wide find/replace.
