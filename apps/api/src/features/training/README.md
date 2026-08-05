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
  Mongoose sub-schema discriminated by Zod at the boundary — the same pattern
  as recipe ingredient lines. `text` blocks carry a rich-text document
  (ProseMirror JSON from the web editor) validated by `richTextDocSchema` in
  `@rit/shared` — an allow-list that strips unknown nodes, marks and
  attributes, so what is stored is the sanitised copy and the reader renders
  it without ever touching `innerHTML`. Media blocks store asset ids, never
  binaries; every id is checked against the module's scope with the same
  at-or-above rule sub-recipes and plating photos follow. `embed` URLs pass
  the `parseVideoEmbed` allow-list — the iframe src clients render is always
  rebuilt server-side from the extracted video id.
- **`TrainingCompletion`** — one row per user per location context, unique on
  `{trainingId, userId, locationId}`, recorded by an idempotent upsert. These
  are the seed of the Phase 2 productivity tracking; the tenant ids are flat
  (facts about people, not scoped content) and reads narrow them with
  `completionReadFilter`.

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

## Still open

- Translation gate: training content is "the other half of what gets
  auto-translated" — wire through the `translations` feature when it lands,
  reusing `ApprovalStatus` / `ContentOrigin` unchanged.
- Completion analytics (Phase 2): the records exist; the reporting does not.
