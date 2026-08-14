# Development Notes

First-time setup is in the [README](../README.md). This file covers the things
that are not on the happy path — the ones that cost an hour when you hit them
cold.

## Verifying your work

```bash
pnpm verify     # format:check → typecheck → lint → test. Exactly what CI runs.
```

Run this before calling anything done. If you only want one slice:

```bash
pnpm format          # Prettier, write mode (format:check to only report)
pnpm typecheck       # tsc in shared/api/mobile/scripts, astro check in web/admin
pnpm lint            # ESLint via expo lint (mobile)
pnpm test            # Vitest in shared + api
```

## `@rit/shared` must compile first

The apps resolve `@rit/shared` through its **emitted `.d.ts` files**, not its
source — there is no `paths` mapping. On a fresh clone `packages/shared/dist/`
does not exist yet, so anything that typechecks against it fails with a
misleading `Cannot find module '@rit/shared'`.

`pnpm typecheck` and `pnpm test` both run `pnpm build:shared` first, so this
should not bite you. If you invoke a package's script directly
(`pnpm -F @rit/api typecheck`), build shared yourself first.

## API integration tests: one mongod, one database per file

`src/__tests__/globalSetup.ts` boots a **single** `MongoMemoryServer` for the
whole run and provides its URI to every worker. Each integration file connects
to its own database through `connectToTestDb('<name>')` (`integration/db.ts`)
and drops it in `afterAll`.

Every file used to call `MongoMemoryServer.create()` itself, which raced:
mongodb-memory-server picks a free port by opening a socket, closing it, then
starting `mongod` on it, so two workers starting together could be handed the
same port and the loser silently connected to the winner's database. That
produced failures which looked nothing like a race — a stray `404` for a
document just created, a field reading back `undefined` — and never reproduced
on a single file.

**If you add an integration file, give it a database name no other file uses.**
Sharing one would reintroduce exactly the interference this removed.

**This is improved, not proven closed.** Before the change a full `pnpm verify`
failed roughly two runs in three; after it, six of seven suite runs were clean —
but one still failed, and the run-to-run "skipped" count varies, which is not
yet explained. Before believing an integration failure, re-run the file alone:

```bash
pnpm -F @rit/api exec vitest run src/__tests__/integration/recipes.test.ts
```

`maxWorkers: 4` in `apps/api/vitest.config.mts` remains in place.

## iOS simulator

The simulator needs full Xcode selected, not the Command Line Tools:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Without changing it globally, prefix the command instead:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm dev:mobile:ios
```

`pnpm dev:mobile:sims` opens an iPhone and an iPad against one dev server (see
`apps/mobile/scripts/dev-simulators.sh`).

## Port collisions with Expo

Root `pnpm dev` deliberately **excludes** mobile; `pnpm dev:all` includes it on
`:8081`. If `pnpm dev:all` is already running and you want a second Expo
instance, give it another port:

```bash
pnpm -F @rit/mobile exec expo start --port 8082
```

Dev servers: API `:9317`, web `:6218`, admin `:6219`, Expo `:8081`.

## Formatting

Prettier owns formatting repo-wide (`.prettierrc.json`, `printWidth: 100`,
single quotes, semicolons; markdown wraps at 80). ESLint is scoped to mobile and
handles only the correctness rules Prettier and `tsc` cannot see. Do not
hand-format — run `pnpm format`.
