# Roadmap & Feature Status

What is built, what is planned, and what is deliberately excluded. **This file
goes stale — trust the code over this table.** Durable engineering rules live in
[AGENTS.md](../AGENTS.md).

Each folder under `apps/api/src/features/` holds a README with the files to
create, the design decisions to settle, and the invariants to preserve. Read the
relevant one before starting.

### Phase 1 — the wedge (the demoable prototype)

| Feature                             | Folder                  | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe data model                   | `features/recipes`      | **Done** — everything else reads from it. `POST /:id/publish` mints v1 and sets it live in one call for a lineage that has **never** been live, gated by per-scope `recipePublishMode` (§4); anything already live still goes save-version-then-activate                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LLM EN→ES translation + review gate | `features/translations` | **Done** — machine output lands `pending_review`; chef edits/approves; activating a different version (or renaming) makes approved text stale and staff-invisible; reader's Español toggle renders approved+current only. Per-scope `translationPublishMode` (§4) can fire the translation automatically on publish, and `auto_publish` can skip review entirely — the single exception in §10. An automatic run is claimed on `Recipe.autoTranslation` _before_ the job detaches, so the recipe page polls (`autoTranslating`) instead of offering a button that would run it twice; a `running` marker older than three minutes reads as a failure, so a dead process can never leave a page polling forever |
| AI recipe drafting                  | `features/drafting`     | **Done** — photos → structured proposals (review-first; nothing persists until a chef creates each as an ordinary unpublished draft). Tags transcribed only, never inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Training modules                    | `features/training`     | **Done** — blocks + publish gate + completions, plus recipe-parity ownership (placement move + person-level access via `tenancy/personAccess`), the same EN→ES translation/review gate (`trainingTranslation.service`, hash-only staleness — no versions), and AI drafting from description/photos/PDFs (`drafting/trainingDraft.service`, review-first, files never stored)                                                                                                                                                                                                                                                                                                                                   |
| Media storage                       | `features/media`        | **Photos & streamed video done**; transcoding still open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Reader app                          | web only                | **Done** — `/reader` browses live recipes + published training; detail views render only the live/published snapshot, even for chefs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Phase 2 (post-commitment)

Configurable line checks (`features/lineChecks`, stubbed), automated prep lists,
batch traceability.

### Phase 3

Toast / Craftable integration for theoretical-vs-actual variance. Scoping is
contingent on confirming API access and partner-program requirements.

### Also missing

- **Email sending.** `inviteMember` therefore returns 501 for an address with no
  account rather than silently dropping the invite, and memberships are created
  `active` instead of `invited`. When email lands: flip the status back to
  `invited` and add an acceptance route.
- Email verification and password reset (the `User` fields exist).
- Offline capture (see the `lineChecks` README — it changes the id-generation
  and idempotency story).
- Native app store distribution. The Expo reader app (`apps/mobile`) exists and
  covers the web reader's feature set, but it runs via Expo Go / dev builds only
  — no EAS build pipeline, no store listings, no offline support.

### Explicitly out of scope

POS, payment processing, delivery routing, payroll, reservations, and hardware
integrations (IoT sensors, Bluetooth thermometers, label printers).
