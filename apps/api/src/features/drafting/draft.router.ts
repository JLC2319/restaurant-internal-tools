import { Router } from 'express';
import multer from 'multer';
import {
  MAX_DRAFT_FILES,
  MAX_DRAFT_PHOTOS,
  MAX_PHOTO_BYTES,
  draftRecipesSchema,
  draftTrainingsSchema,
} from '@rit/shared';
import * as draftController from './draft.controller';
import { authenticate } from '../../middleware/authenticate';
import { resolveTenant, requireRole } from '../../middleware/resolveTenant';
import { llmRateLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';

const draftRouter = Router();

/**
 * Drafting photos buffer in memory like plating photos — they exist only for
 * the one model call and are never written to disk or object storage. Multer's
 * limits abort oversized streams early; errorHandler maps them to 413/400.
 */
const draftUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_DRAFT_PHOTOS },
});

draftRouter.use(authenticate, resolveTenant);

// Lets the web app hide the entry point when no key is configured.
draftRouter.get('/config', draftController.getConfig);

// Multipart, so this router parses its own body; `validate` then sees the
// text fields multer collected. llmRateLimiter is the cost control.
draftRouter.post(
  '/recipes',
  requireRole('chef'),
  llmRateLimiter,
  draftUpload.array('photos', MAX_DRAFT_PHOTOS),
  validate(draftRecipesSchema),
  draftController.draftRecipes,
);

/**
 * Training drafting takes photos AND PDFs in one `files` field — the service
 * sniffs each file's bytes to decide its lane. Same memory-only lifecycle as
 * drafting photos: material for one model call, never stored.
 */
const trainingDraftUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_DRAFT_FILES },
});

draftRouter.post(
  '/trainings',
  requireRole('chef'),
  llmRateLimiter,
  trainingDraftUpload.array('files', MAX_DRAFT_FILES),
  validate(draftTrainingsSchema),
  draftController.draftTrainings,
);

export { draftRouter };
