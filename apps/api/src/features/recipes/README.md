# `recipes`

The spine of the product — translations, drafting and training all read from
this model. Mounted in `app.ts` as `/api/recipes`.

## Shape

Two collections:

- **`Recipe`** (`recipe.model.ts`) — the lineage head: identity (`name`,
  embedded `scope`, `status`), the one **mutable working copy** chefs edit,
  `currentVersion` (the `$inc` counter), and the `activeVersionId` pointer to
  what staff cook from. `forkedFrom` remembers a fork's origin.
- **`RecipeVersion`** (`recipeVersion.model.ts`) — immutable snapshots minted by
  "save as version". No update path exists on purpose. The unique
  `{recipeId, version}` index is the concurrency backstop (11000 → 409 via
  `errorHandler`). Scope is denormalised from the head — safe because a
  lineage's scope never mutates; forking creates a new head instead.

Zod schemas live in `@rit/shared` (`schemas/recipes.ts`), not a local
`recipe.schema.ts` — the web editor shares them.

## The rules that matter

- **Versioning ≠ forking.** A version is a new numbered snapshot on the same
  lineage. A fork is a new lineage at a (possibly different) scope that
  remembers its origin and starts back at version 0.
- **Publishing on save is for first publication only.** `POST /:id/publish`
  composes save-version + activate for a lineage with no `activeVersionId`, so a
  kitchen typing in its book on day one does not spend three screens per dish.
  It refuses (409) on a recipe staff already cook from — changing what a line is
  reading stays two deliberate acts — and refuses where the recipe's scope
  resolves `recipePublishMode` to `manual`. Under `publish_on_save_verified` it
  also refuses unless the caller sent `approveAllergens: true`; that is checked
  rather than `tagsVerified` because a dish with no allergens can never satisfy
  the latter (an empty tag list is not a claim of safety), and a mode nobody can
  satisfy is a mode nobody turns on. Sign-off runs _before_ the snapshot so the
  stamps land inside v1. There is no transaction — nothing in this API uses one
  — so a failure between minting and activating leaves a saved, unpublished v1,
  which is the safe way to fail. It delegates to `activateVersion` rather than
  setting the pointer itself, so everything that hangs off a version going live
  still happens — the tenant's `translationPublishMode` fires exactly as it does
  for "Set live". Keep that delegation: publishing by the fast path must never
  be a quieter event than publishing by the slow one.
- **Staff (below chef) see only active, approved reality**: recipes with an
  active version, that version's content, and only `approved` allergen tags.
  Working copies, version history, and unpublished recipes answer 404.
- **Allergen sign-off is server-owned.** Clients submit bare tags; approval
  stamps are written only by the approve endpoint. Changing the ingredient list
  resets every tag to `pending_review` (`mergeAllergenTags`), and forking resets
  them unconditionally — a sign-off never crosses lineages.
- **Sub-recipes are recipes.** A `recipe`-kind ingredient line references a
  lineage id; consumers resolve its active version. `assertNoCycle` (BFS over
  working copies _and_ active snapshots) guards every update and restore, and a
  sub-recipe's scope must sit at-or-above its consumer's so it is readable by
  the consumer's whole audience.
- **Plating photos are content, not decoration on the head.** `content.photoIds`
  is an ordered list of `Media` ids (see `features/media`), so a version
  snapshots the plating it was saved with and index 0 is the hero shot the list
  and reader header use. Responses carry resolved `photos` rather than raw ids;
  an asset deleted out from under a recipe drops out of the list instead of
  rendering broken. Attachment is validated by `assertPhotosAttachable` — same
  at-or-above scope rule as sub-recipes. Changing photos does **not** reset
  allergen sign-off: `canonicalIngredients` is keyed to composition, and a photo
  is not composition.
- **Scope every query.** `scopeReadFilter` composes into every find,
  `scopeForWrite` stamps every insert, `assertCanWriteAt` gates every mutation —
  a location chef can read a property recipe but not edit it.

## Role gates

chef+ for create/edit/save-version/activate/restore/fork/allergen-approve;
manager+ for archive/unarchive (archival takes a recipe away from every
consumer, and is refused with 409 while anything still references it).
