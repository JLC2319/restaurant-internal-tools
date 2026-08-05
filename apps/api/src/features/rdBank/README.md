# `rdBank` — not yet implemented

The R&D recipe bank: chefs submit ideas, directors review, rank, and track
version history. Replaces the current paper process.

## Files to create

```
rdSubmission.model.ts
rdSubmission.service.ts
rdSubmission.controller.ts
rdSubmission.router.ts
```

Mount in `app.ts` as `/api/rd-bank`.

## Design notes

- A submission is a **candidate recipe**, not a recipe. Keep it in its own
  collection with a loose shape — forcing a chef to fill in a full spec'd recipe
  before an idea is approved is exactly the friction that keeps ideas on paper.
  Promotion to a real `Recipe` is an explicit action.
- Ranking is per-reviewer, aggregated. Store individual scores rather than a
  single mutable average, or you cannot tell a 3-from-everyone from a
  1-and-a-5.
- **Scope submissions at the tier they were submitted from**, but let directors
  read upward across their subtree — the point of the bank is that a good idea
  from one location reaches the group.
- Version history here is lighter than the recipe model's: an idea's revisions
  are a linear append, with no forking.
