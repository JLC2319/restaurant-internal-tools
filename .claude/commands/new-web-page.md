---
description: Scaffold a new web page following the AGENTS.md §13 checklist
argument-hint: <page-name> [feature]
---

Add a new web page at `apps/web/src/pages/$1.astro`.

Read AGENTS.md §5 (web component decision), §7 (design tokens) and §13 first.

Work through §13 in order:

1. Create `apps/web/src/pages/$1.astro` using `BaseLayout`.
2. Leave `requireAuth` at its default — `/login` is the only genuinely public
   page.
3. Extract each interactive section into a React island in the owning
   `apps/web/src/features/<feature>/` directory. Shared atoms come from
   `@/components/ui` — check what already exists there before building a new
   one. Internal imports use the `@/` alias.
4. Wrap any island using TanStack Query in `QueryProvider`.
5. Client fetch functions go in that feature's `features/<feature>/api.ts` and
   return `ApiResult<T>`; handle both branches inline. The cross-feature client,
   drafts and media modules live in `src/lib/api/`.
6. Include the scope in query keys for anything tenant-scoped — otherwise
   switching scope serves another tenant's cached data.
7. Run `pnpm verify` and fix what it reports.

Use the design tokens from §7 rather than raw Tailwind colors. If this page has
a mobile counterpart, check whether `apps/mobile` needs the same change — the
two `ui` layers and API clients are documented twins.
