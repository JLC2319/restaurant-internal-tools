# `training`

Training modules for kitchen staff: ordered content blocks (rich text, images,
uploaded video, YouTube/Vimeo embeds) behind a publish gate, plus
per-user-per-location completion records. Mounted at `/api/training`.

## Shape

- **`TrainingModule`** — `scope` + `title` + `description` + `blocks[]` +
  `status: draft | published | archived`. Edited in place; there is no version
  history, so `published` is the entire staff-visibility rule. Readers (below
  chef) see published modules only, 404 otherwise — existence hiding as
  everywhere else.
- **Blocks are polymorphic** (`kind: text | image | video | embed`), one loose
  Mongoose sub-schema discriminated by Zod at the boundary — the same pattern as
  recipe ingredient lines. `text` blocks carry a rich-text document (ProseMirror
  JSON from the web editor) validated by `richTextDocSchema` in `@rit/shared` —
  an allow-list that strips unknown nodes, marks and attributes, so what is
  stored is the sanitised copy and the reader renders it without ever touching
  `innerHTML`. Media blocks store asset ids, never binaries; every id is checked
  against the module's scope with the same at-or-above rule sub-recipes and
  plating photos follow. `embed` URLs pass the `parseVideoEmbed` allow-list —
  the iframe src clients render is always rebuilt server-side from the extracted
  video id.
- **`TrainingCompletion`** — one row per user per location context, unique on
  `{trainingId, userId, locationId}`, recorded by an idempotent upsert. These
  are the seed of the Phase 2 productivity tracking; the tenant ids are flat
  (facts about people, not scoped content) and reads narrow them with
  `completionReadFilter`.
- **Ownership** — the same two axes as recipes. Placement: `PUT /:id/scope`
  (manager+) moves a module across the tenant tree; far simpler than a recipe
  move (no versions, no reference graph) — write-tier at both homes, allow-list
  re-validated at the new home, block media widened via `widenAssetsToCover`,
  translations' denormalised scope updated copies-first. Person-level access:
  `access: { userIds } | null` gated everywhere by `personAccessFilter` from
  `tenancy/personAccess` (creator and admin+ always see; `null` means everyone
  in scope, no backfill), managed via `PUT /:id/access` +
  `GET /:id/access/candidates` — the same disclosure rules as recipes
  (`restricted` is public to viewers, the list itself only to managers).

## Roles

Chefs author, publish and unpublish (parallel to recipe versioning); managers
archive (parallel to recipe archival); everyone reads published modules and may
mark them complete. Unarchiving lands on `draft`, never straight back to
`published`.

## Video

Uploaded video goes through `/api/media/videos`, which **streams** the request
body to R2 with bounded memory (`media/videoStorage.ts`) — never through
multer's memory storage. Playback streams straight from the R2 CDN origin via
HTTP range requests; the API is not in that path at all.

## Translation

Wired through the `translations` feature (`trainingTranslation.service`), the
same five-route contract as recipes at `/api/translations/trainings/:id`.
Modules have no versions, so staleness is a content hash of the translatable
projection (title + description + per-block text/captions) — any edit to a
published module hides its approved Spanish until re-translated or re-approved.
Publishing (or editing while published) fires the same detached auto-translate
pattern recipes use, with the `autoTranslation` marker living on the module.
Text blocks translate as plain text — formatting does not survive translation.

## AI drafting

`POST /api/drafts/trainings` (see `features/drafting/trainingDraft.service`)
turns a written description plus photos/PDFs into text-section proposals.
Nothing persists from the model — the chef reviews and creates an ordinary
unpublished draft; submitted files are material for the one model call only.

## Still open

- Completion analytics (Phase 2): the records exist; the reporting does not.
