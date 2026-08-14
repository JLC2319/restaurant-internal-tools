# @rit/mobile — the reader, native

An Expo (React Native) app that mirrors the web `/reader`: live recipes and
published training only, everything on screen approved by construction. Same
API, same scope headers, same safety rules as `apps/web` — see the root
`AGENTS.md` (§4 multi-tenancy, §10 safety) before changing anything here.

## Run it

```bash
# 1. API up (from the repo root)
pnpm dev:api           # or `pnpm dev` for the whole web stack — it does NOT
                       # start this app; `pnpm dev:all` runs everything at once

# 2. Point the app at the API:
cp .env.example .env   # simulator: the localhost default is fine
                       # physical device: set EXPO_PUBLIC_API_BASE_URL to your LAN IP

# 3. Start it (from the repo root)
pnpm dev:mobile        # Expo dev server; scan the QR with Expo Go, or press i / a
pnpm dev:mobile:ios    # or open straight into the iOS simulator
pnpm dev:mobile:sims   # or into an iPhone *and* an iPad at once, one dev server
```

`dev:mobile:sims` (`scripts/dev-simulators.sh`) boots both simulators, makes
sure each has Expo Go, and hands them the dev server URL once Metro is up —
handy for checking a layout at phone and tablet width in the same pass. Pick
different devices by name if you want another pair:

```bash
PHONE_SIM="iPhone 17e" TABLET_SIM="iPad mini (A17 Pro)" pnpm dev:mobile:sims
```

`@rit/shared` must be built first (`pnpm build:shared`) — the app imports its
compiled types and enums, exactly like the web app does.

The iOS simulator needs full Xcode selected as the active developer directory
(`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`) — a Mac with
only the Command Line Tools can install Expo Go on nothing.

## What's here

| Screen                       | File                        | Web counterpart  |
| ---------------------------- | --------------------------- | ---------------- |
| Sign in                      | `src/app/login.tsx`         | `/login`         |
| Workspace picker             | `src/app/scope.tsx`         | `ScopeSwitcher`  |
| Shelves (recipes + training) | `src/app/index.tsx`         | `ReaderBrowser`  |
| Recipe (Español toggle)      | `src/app/recipes/[id].tsx`  | `ReaderRecipe`   |
| Training (mark complete)     | `src/app/training/[id].tsx` | `ReaderTraining` |

Deliberate differences from the web reader:

- **Infinite scroll** instead of Previous/Next paging — same 24-a-page API.
- **Scope switching clears the query cache** (`queryClient.clear()`) instead of
  the web's full page reload; same reason, native mechanism.
- **Session lives in module memory** backed by AsyncStorage
  (`src/api/client.ts`), because native storage is async and the fetch layer
  reads the token synchronously. `hydrateSession()` runs before any route
  mounts.

## Conventions

- Styling is NativeWind with the same tokens as the web (`src/theme/colors.js`
  is the single source both `tailwind.config.js` and icon code read). `chili`
  stays reserved for allergens and danger.
- Font weights are separate families (`font-sans-semibold`, not `font-semibold`)
  — Android needs one fontFamily per loaded weight.
- Anything tappable gets `min-h-touch` (44px) — gloved hands.
- Named breakpoints only (`tablet:` = iPad portrait); phone-first, more grid
  columns on tablets.
