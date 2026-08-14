# Stack Reference

Library-by-library breakdown of every app. This is descriptive, not prescriptive
— the rules that constrain how you write code live in [AGENTS.md](../AGENTS.md).

### API (`apps/api`)

| Concern     | Library                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| Framework   | Express 5                                                                                     |
| Language    | TypeScript (compiled by `tsc`, run via `tsx watch` in dev)                                    |
| Database    | MongoDB via Mongoose 9                                                                        |
| Validation  | Zod 4 via `validate()` / `validateQuery()` middleware                                         |
| Auth        | JWT (`jsonwebtoken`), bcrypt (`bcryptjs`, 12 rounds)                                          |
| File upload | Multer → Cloudflare R2 (photos buffer in memory; videos stream — see `media/videoStorage.ts`) |
| Security    | helmet, cors, express-rate-limit                                                              |
| Logging     | Morgan (`combined` in prod, `dev` in development)                                             |

Express 5 forwards rejected promises from handlers to the error middleware, so
async route handlers throw `AppError` directly — no `try/catch` wrapper needed.

### Web (`apps/web`)

| Concern       | Library                                |
| ------------- | -------------------------------------- |
| Framework     | Astro 7 (MPA)                          |
| Islands       | React 19                               |
| Styling       | TailwindCSS 4 (custom tokens — see §7) |
| Data fetching | TanStack Query 5                       |
| Icons         | Lucide React                           |

Every page is behind authentication, so there is no SEO surface: pages are
`noindex`, there is no sitemap, and no page prerenders API data.

### Mobile (`apps/mobile`)

| Concern       | Library                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| Framework     | Expo SDK 57 (React Native), expo-router                                        |
| Styling       | NativeWind 4 (Tailwind 3 syntax; same tokens as web via `src/theme/colors.js`) |
| Data fetching | TanStack Query 5                                                               |
| Session       | In-memory store backed by AsyncStorage (`src/api/client.ts`)                   |

The mobile app is the reader only — approved content, nothing else — and it
consumes the same API with the same scope headers. `EXPO_PUBLIC_API_BASE_URL`
must be a LAN address for physical devices. Run with `pnpm dev:mobile` (or
`pnpm dev:mobile:ios` to open the iOS simulator directly, or
`pnpm dev:mobile:sims` to open an iPhone _and_ an iPad simulator against one dev
server — see `apps/mobile/scripts/dev-simulators.sh`) — root `pnpm dev`
deliberately excludes this app; `pnpm dev:all` runs everything. Typecheck is
part of root `pnpm typecheck`. Details and deliberate deviations from the web
reader: `apps/mobile/README.md`.

### Shared (`packages/shared`)

- `schemas/*.ts` — Zod schemas, the single source of truth for validation.
- `types/domain.ts` — const arrays (`allergenValues`, `tenantRoleValues`, …) and
  the union types derived from them.
- `types/api.ts` — `ApiResult<T>`, `PaginatedResponse<T>`, response shapes.
- Always `import from '@rit/shared'`; never reach into `packages/shared/src`.
- **Build order**: shared compiles first — `pnpm build:shared` or `pnpm build`.
