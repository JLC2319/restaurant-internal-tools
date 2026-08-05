# `lineChecks` — not yet implemented (Phase 2)

Configurable digital forms for daily food-safety and quality checks, with
**offline capture**.

Note the planning doc is inconsistent about phasing: the features page lists
line checks under "Core Features (MVP)", while the project plan puts
"Configurable Line Checks" in Phase 2 (post-commitment). Treat it as Phase 2 —
the Phase 1 demo is the recipe model plus translation — and confirm with the
client before building.

## Files to create

```
lineCheck.model.ts          The template (a configurable form)
lineCheckSubmission.model.ts  One completed run of that template
lineCheck.service.ts
lineCheck.controller.ts
lineCheck.router.ts
```

## Design notes for whoever picks this up

- **Offline-first is the whole difficulty.** Back-of-house Wi-Fi is unreliable,
  so submissions are captured on-device and synced later. That means the client
  generates the submission id (a UUID, not a server ObjectId) and the sync
  endpoint must be **idempotent** — re-posting the same id updates rather than
  duplicates.
- Submissions are **immutable once synced**, apart from an explicit correction
  record. A food-safety log that can be quietly edited after the fact is worth
  nothing in an audit.
- Timestamp everything with both the device clock and the server receive time;
  they will disagree, and the gap is itself diagnostic.
- Templates are scoped (a property's standard check) but submissions are always
  `location`-scoped — a check is performed at one restaurant.
- The location's `timezone` decides what "today's line check" means. Never use
  the server's clock for day boundaries.
