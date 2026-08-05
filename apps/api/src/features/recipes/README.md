# `recipes`

The spine of the product — translations, drafting and training all read from
this model. Mounted in `app.ts` as `/api/recipes`.

## Shape

Two collections:

- **`Recipe`** (`recipe.model.ts`) — the lineage head: identity (`name`,
  embedded `scope`, `status`), the one **mutable working copy** chefs edit,
  `currentVersion` (the `$inc` counter), and the `activeVersionId` pointer to
  what staff cook from. `forkedFrom` remembers a fork's origin.
- **`RecipeVersion`** (`recipeVersion.model.ts`) — immutable snapshots minted
  by "save as version". No update path exists on purpose. The unique
  `{recipeId, version}` index is the concurrency backstop (11000 → 409 via
  `errorHandler`). Scope is denormalised from the head — safe because a
  lineage's scope never mutates; forking creates a new head instead.

Zod schemas live in `@rit/shared` (`schemas/recipes.ts`), not a local
`recipe.schema.ts` — the web editor shares them.

## The rules that matter

- **Versioning ≠ forking.** A version is a new numbered snapshot on the same
  lineage. A fork is a new lineage at a (possibly different) scope that
  remembers its origin and starts back at version 0.
- **Staff (below chef) see only active, approved reality**: recipes with an
  active version, that version's content, and only `approved` allergen tags.
  Working copies, version history, and unpublished recipes answer 404.
- **Allergen sign-off is server-owned.** Clients submit bare tags; approval
  stamps are written only by the approve endpoint. Changing the ingredient
  list resets every tag to `pending_review` (`mergeAllergenTags`), and forking
  resets them unconditionally — a sign-off never crosses lineages.
- **Sub-recipes are recipes.** A `recipe`-kind ingredient line references a
  lineage id; consumers resolve its active version. `assertNoCycle` (BFS over
  working copies *and* active snapshots) guards every update and restore, and
  a sub-recipe's scope must sit at-or-above its consumer's so it is readable
  by the consumer's whole audience.
- **Plating photos are content, not decoration on the head.** `content.photoIds`
  is an ordered list of `Media` ids (see `features/media`), so a version
  snapshots the plating it was saved with and index 0 is the hero shot the list
  and reader header use. Responses carry resolved `photos` rather than raw ids;
  an asset deleted out from under a recipe drops out of the list instead of
  rendering broken. Attachment is validated by `assertPhotosAttachable` — same
  at-or-above scope rule as sub-recipes. Changing photos does **not** reset
  allergen sign-off: `canonicalIngredients` is keyed to composition, and a
  photo is not composition.
- **Scope every query.** `scopeReadFilter` composes into every find,
  `scopeForWrite` stamps every insert, `assertCanWriteAt` gates every
  mutation — a location chef can read a property recipe but not edit it.

## Role gates

chef+ for create/edit/save-version/activate/restore/fork/allergen-approve;
manager+ for archive/unarchive (archival takes a recipe away from every
consumer, and is refused with 409 while anything still references it).
