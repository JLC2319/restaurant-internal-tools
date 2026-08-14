import { Router } from 'express';
import {
  approveAllergensSchema,
  createRecipeSchema,
  forkRecipeSchema,
  listRecipesQuerySchema,
  moveRecipeSchema,
  publishRecipeSchema,
  saveVersionSchema,
  updateRecipeAccessSchema,
  updateRecipeSchema,
} from '@rit/shared';
import * as recipeController from './recipe.controller';
import { authenticate } from '../../middleware/authenticate';
import { resolveTenant, requireRole } from '../../middleware/resolveTenant';
import { validate, validateQuery } from '../../middleware/validate';

const recipeRouter = Router();

recipeRouter.use(authenticate, resolveTenant);

// Reads are open to every member — the service narrows what staff can see
// (active versions only, approved allergen tags only).
recipeRouter.get('/', validateQuery(listRecipesQuerySchema), recipeController.listRecipes);
// Registered BEFORE '/:id' — Express matches in order, and a literal path
// declared after a parameterised one is unreachable.
recipeRouter.get('/publish-mode', requireRole('chef'), recipeController.getScopePublishMode);
recipeRouter.get('/:id', recipeController.getRecipe);

recipeRouter.post(
  '/',
  requireRole('chef'),
  validate(createRecipeSchema),
  recipeController.createRecipe
);
recipeRouter.patch(
  '/:id',
  requireRole('chef'),
  validate(updateRecipeSchema),
  recipeController.updateRecipe
);

// Archival is a manager call — it takes a recipe away from every consumer.
recipeRouter.delete('/:id', requireRole('manager'), recipeController.archiveRecipe);
recipeRouter.post('/:id/unarchive', requireRole('manager'), recipeController.unarchiveRecipe);

// ── Versioning ────────────────────────────────────────────────────────────────

recipeRouter.get('/:id/versions', requireRole('chef'), recipeController.listVersions);
recipeRouter.post(
  '/:id/versions',
  requireRole('chef'),
  validate(saveVersionSchema),
  recipeController.saveVersion
);
// Mint v1 and set it live in one call, for a lineage that has never been live.
// Gated by `recipePublishMode` on the recipe's scope — the service decides, not
// the route, because the answer depends on where the recipe lives.
recipeRouter.post(
  '/:id/publish',
  requireRole('chef'),
  validate(publishRecipeSchema),
  recipeController.publishRecipe
);
recipeRouter.get('/:id/versions/:versionId', requireRole('chef'), recipeController.getVersion);
recipeRouter.post(
  '/:id/versions/:versionId/activate',
  requireRole('chef'),
  recipeController.activateVersion
);
recipeRouter.post('/:id/deactivate', requireRole('chef'), recipeController.deactivateRecipe);
recipeRouter.post(
  '/:id/versions/:versionId/restore',
  requireRole('chef'),
  recipeController.restoreVersion
);

// ── Placement ─────────────────────────────────────────────────────────────────

// Managers only: where a recipe lives decides which kitchens see it, and the
// service re-validates everything placement touches (sub-recipes both ways,
// photos, the allow-list) before any copy moves.
recipeRouter.put(
  '/:id/scope',
  requireRole('manager'),
  validate(moveRecipeSchema),
  recipeController.moveRecipe
);

// ── Person-level access ───────────────────────────────────────────────────────

// PUT: the allow-list is replaced wholesale — idempotent, no merge semantics.
// The service enforces that only someone who can currently read AND manage the
// recipe may change its list; role alone is not enough.
recipeRouter.put(
  '/:id/access',
  requireRole('chef'),
  validate(updateRecipeAccessSchema),
  recipeController.updateRecipeAccess
);
recipeRouter.get(
  '/:id/access/candidates',
  requireRole('chef'),
  recipeController.listAccessCandidates
);

// ── Forking & allergen sign-off ───────────────────────────────────────────────

recipeRouter.post(
  '/:id/fork',
  requireRole('chef'),
  validate(forkRecipeSchema),
  recipeController.forkRecipe
);
recipeRouter.post(
  '/:id/allergens/approve',
  requireRole('chef'),
  validate(approveAllergensSchema),
  recipeController.approveAllergens
);

export { recipeRouter };
