# `translations` — not yet implemented

LLM-driven English→Spanish translation of recipes and training content, with a
**mandatory human review gate**. One of the two demo centrepieces.

## Files to create

```
translation.model.ts       A translation *job* + the translated payload
translation.service.ts     Calls Anthropic; never publishes on its own
translation.controller.ts
translation.router.ts
```

Mount in `app.ts` as `/api/translations`.

## The gate is the feature

The planning doc is explicit that translation output must not reach kitchen
staff until a human approves it — a mistranslated allergen or a mistranslated
cook temperature is a food-safety incident, not a typo.

Encode that as data, not as UI convention:

- Every translated document carries `ApprovalStatus` from `@rit/shared`. Only
  `approved` is readable by the reader app; `PUBLISHABLE_STATUS` is the constant
  to compare against.
- Carry `ContentOrigin` (`machine` / `machine_edited` / `human`) so the reader
  can badge machine-assisted content even after approval.
- Record the approver's user id and timestamp. "Who signed off on this" is the
  question that matters after an incident.
- A source-document edit must invalidate its approved translations back to
  `pending_review` — otherwise the Spanish silently describes the old recipe.

## Implementation notes

- `env.translationEnabled` gates the whole feature; it is false whenever
  `ANTHROPIC_API_KEY` is unset, so the app runs fine without a key.
- Model id comes from `env.llmModel` — do not hardcode one.
- Put `llmRateLimiter` on every route that triggers a paid call.
- Translate a whole document per request, not field-by-field: the model needs
  surrounding context to get culinary terms right, and per-field calls multiply
  cost by an order of magnitude.
- Store the source text hash alongside the translation so you can tell whether a
  translation is stale without re-reading the source.
