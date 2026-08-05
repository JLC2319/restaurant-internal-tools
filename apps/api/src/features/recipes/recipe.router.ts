import { Router } from 'express';
import {
  approveAllergensSchema,
  createRecipeSchema,
  forkRecipeSchema,
  listRecipesQuerySchema,
  saveVersionSchema,
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
