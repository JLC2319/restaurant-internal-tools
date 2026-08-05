# `training` — not yet implemented

Training materials and modules for kitchen staff — the other half of what gets
auto-translated.

## Files to create

```
trainingModule.model.ts
trainingModule.service.ts
trainingModule.controller.ts
trainingModule.router.ts
```

Mount in `app.ts` as `/api/training`.

## Design notes

- A module is ordered content blocks (text, image, video) plus optional
  completion tracking. Keep the block list polymorphic from the start; retrofitting
  video into a text-only schema means a migration across every tenant.
- Training content goes through the **same translation gate** as recipes — reuse
  the `translations` feature rather than growing a second one. `ApprovalStatus`
  and `ContentOrigin` from `@rit/shared` apply here unchanged.
- Completion records are per user per location, and are the seed of the Phase 2
  "employee productivity tracking" feature. Record `locationId` on them even
  though the module itself may be scoped org-wide.
- Media (video especially) goes through the `media` feature, never stored inline.
