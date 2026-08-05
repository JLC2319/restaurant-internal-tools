import { Router } from 'express';
import { translationLocaleSchema, updateTranslationSchema } from '@rit/shared';
import * as translationController from './translation.controller';
import { authenticate } from '../../middleware/authenticate';
import { resolveTenant, requireRole } from '../../middleware/resolveTenant';
import { llmRateLimiter } from '../../middleware/rateLimiter';
import { validate, validateQuery } from '../../middleware/validate';

const translationRouter = Router();

translationRouter.use(authenticate, resolveTenant);

// Open to every member — the service decides what each role may see (staff:
// approved and current only; reviewers: the full document + stale flag).
translationRouter.get(
  '/recipes/:recipeId',
  validateQuery(translationLocaleSchema),
  translationController.getTranslationState
);

// The one route that spends money — llmRateLimiter is the cost control.
translationRouter.post(
  '/recipes/:recipeId',
  requireRole('chef'),
  llmRateLimiter,
  validate(translationLocaleSchema),
  translationController.requestTranslation
);

translationRouter.patch(
  '/recipes/:recipeId',
  requireRole('chef'),
  validate(updateTranslationSchema),
  translationController.updateTranslation
);
translationRouter.post(
  '/recipes/:recipeId/approve',
  requireRole('chef'),
  validate(translationLocaleSchema),
  translationController.approveTranslation
);
translationRouter.post(
  '/recipes/:recipeId/reject',
  requireRole('chef'),
  validate(translationLocaleSchema),
  translationController.rejectTranslation
);

export { translationRouter };
