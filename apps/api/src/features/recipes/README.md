# `recipes` — not yet implemented

The spine of the product. Everything else in Phase 1 reads from this model, so
build it first.

## Files to create

```
recipe.model.ts       Mongoose model — must embed `scope` (see lib/scope.ts)
recipe.schema.ts      Zod schemas local to this feature, or promote to @rit/shared
recipe.service.ts     All business logic; throws AppError
recipe.controller.ts  Thin handlers
recipe.router.ts      authenticate → resolveTenant → requireRole → validate → controller
```

Mount in `app.ts` as `/api/recipes`.

## What the planning doc asks for

Structured data for recipes, **sub-recipes**, ingredients, yields, plating
photos, and allergen tags — plus **forking and version history**.

## Design notes to settle before writing code

- **Sub-recipes are recipes.** A batch of demi-glace is a recipe that another
  recipe consumes as an ingredient. Model an ingredient line as either a raw
  item or a `recipeId` reference, and guard against reference cycles when
  resolving a recipe's full ingredient tree.
- **Versioning vs forking are different operations.** A version is a new
  revision of the same recipe on the same lineage; a fork is a new lineage that
  remembers where it came from (a location adapting a property's standard).
  Both need `parentId` + `version`, but only forking changes the scope.
- **Yields are a unit quantity, not a number.** Use `Unit`/`unitFamily` from
  `@rit/shared` — a yield of "12" is meaningless without "quarts".
- **Allergen tags need a human sign-off** before they are shown to anyone.
  Carry `ApprovalStatus` + who approved + when. See the liability note in
  AGENTS.md: an absent allergen tag reads as a claim of safety.
- **Scope every query.** Compose `scopeReadFilter(req.tenant!)` into every find,
  and stamp `scopeForWrite(req.tenant!)` on every insert. A recipe that skips
  this is visible to all 57 locations.
