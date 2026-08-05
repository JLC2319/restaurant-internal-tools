# `allergens` — not yet implemented

The exclusion-based lookup: "a guest cannot have shellfish or sesame — what can
they eat?" Reads the structured tags on the recipe model rather than owning its
own data.

## Files to create

```
allergen.service.ts     Query composition over the recipe model
allergen.controller.ts
allergen.router.ts
```

Mount in `app.ts` as `/api/allergens`.

## Safety rules that must survive every refactor

This is the highest-liability surface in the product. The planning doc calls for
UI disclaimers and mandatory human sign-off; these are the invariants behind
them.

- **The answer is exclusion, never inclusion.** Return the dishes to *avoid*,
  and treat "no tag" as unknown rather than safe. A dish whose allergen review
  has not been signed off must never appear in a "safe to serve" list — filter
  on `ApprovalStatus === 'approved'`, not merely on the absence of a tag.
- **Sub-recipes propagate allergens upward.** A dish is only as safe as its
  deepest component. Resolve the full sub-recipe tree before answering; a shallow
  check on the top-level ingredient list is the bug that puts someone in an
  ambulance.
- **`$nin` semantics, not `$ne`.** Excluding a list of allergens is
  `{ 'allergens': { $nin: [...] } }`; getting this wrong silently returns dishes
  containing all but one of the excluded allergens.
- **Never let the LLM write an allergen tag.** Machine translation may render the
  *label* of a tag; it may not decide which tags apply.
- The allergen vocabulary lives in `allergenValues` in `@rit/shared`. Never
  redeclare it — a second list is how "tree_nuts" and "treenuts" both end up in
  the database.
