---
description: Scaffold a new API feature following the AGENTS.md §12 checklist
argument-hint: <feature-name>
---

Add a new API feature named `$1` to `apps/api/src/features/$1/`.

Read AGENTS.md §4 (multi-tenancy), §5 (feature file structure) and §12 first —
the scope rules there are not optional, and a query that forgets
`scopeReadFilter` leaks every tenant's data while looking like it works.

Work through §12 in order:

1. Create `apps/api/src/features/$1/` with the five files from §5.
2. Zod schemas in `$1.schema.ts` — promote to `@rit/shared` only if the web app
   needs them too.
3. Mongoose model with the `modifiedAt` timestamp config **and an embedded
   `scope` sub-document**. Index `scope.orgId` alongside whatever this feature
   actually queries on.
4. Service: `TenantContext` first, `scopeReadFilter` composed into every read,
   `scopeForWrite` stamped on every write, `AppError` for failures.
5. Thin controllers — no business logic.
6. Router: `authenticate` → `resolveTenant` → `requireRole` → `validate` →
   controller, then mount it in `app.ts`.
7. Shared response types into `packages/shared/src/types/api.ts`, exported from
   the barrel.
8. **Tenant isolation test** — seed two orgs, query as a member of one, assert
   the other's documents are absent. Do not skip this one.
9. Run `pnpm verify` and fix what it reports.

Before you finish, re-read your service and confirm every `find`/`findOne`
composes `scopeReadFilter`. If this feature touches allergens or anything
machine-generated, re-read §10 — an absent allergen tag is not a claim of
safety, and nothing machine-generated reaches staff unapproved.
