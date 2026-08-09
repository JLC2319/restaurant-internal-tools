# @rit/mobile — the reader, native

An Expo (React Native) app that mirrors the web `/reader`: live recipes and
published training only, everything on screen approved by construction. Same
API, same scope headers, same safety rules as `apps/web` — see the root
`AGENTS.md` (§4 multi-tenancy, §10 safety) before changing anything here.

## Run it

```bash
# 1. API up (from the repo root)
pnpm dev:api

# 2. Point the app at the API — on a physical device localhost won't work:
cp .env.example .env   # then set EXPO_PUBLIC_API_BASE_URL to your LAN IP

# 3. Start the dev server (from the repo root)
pnpm dev:mobile        # then scan the QR with Expo Go, or press i / a
```

`@rit/shared` must be built first (`pnpm build:shared`) — the app imports its
compiled types and enums, exactly like the web app does.

## What's here

| Screen | File | Web counterpart |
|---|---|---|
| Sign in | `src/app/login.tsx` | `/login` |
| Workspace picker | `src/app/scope.tsx` | `ScopeSwitcher` |
| Shelves (recipes + training) | `src/app/index.tsx` | `ReaderBrowser` |
| Recipe (Español toggle) | `src/app/recipes/[id].tsx` | `ReaderRecipe` |
| Training (mark complete) | `src/app/training/[id].tsx` | `ReaderTraining` |

Deliberate differences from the web reader:

- **Infinite scroll** instead of Previous/Next paging — same 24-a-page API.
- **Scope switching clears the query cache** (`queryClient.clear()`) instead
  of the web's full page reload; same reason, native mechanism.
- **Session lives in module memory** backed by AsyncStorage
  (`src/api/client.ts`), because native storage is async and the fetch layer
  reads the token synchronously. `hydrateSession()` runs before any route
  mounts.

## Conventions

- Styling is NativeWind with the same tokens as the web (`src/theme/colors.js`
  is the single source both `tailwind.config.js` and icon code read).
  `chili` stays reserved for allergens and danger.
- Font weights are separate families (`font-sans-semibold`, not
  `font-semibold`) — Android needs one fontFamily per loaded weight.
- Anything tappable gets `min-h-touch` (44px) — gloved hands.
- Named breakpoints only (`tablet:` = iPad portrait); phone-first, more grid
  columns on tablets.
