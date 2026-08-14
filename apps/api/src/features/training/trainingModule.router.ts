import { Router } from 'express';
import {
  createTrainingSchema,
  listTrainingsQuerySchema,
  moveTrainingSchema,
  updateTrainingAccessSchema,
  updateTrainingSchema,
} from '@rit/shared';
import * as trainingController from './trainingModule.controller';
import { authenticate } from '../../middleware/authenticate';
import { resolveTenant, requireRole } from '../../middleware/resolveTenant';
import { validate, validateQuery } from '../../middleware/validate';

const trainingRouter = Router();

trainingRouter.use(authenticate, resolveTenant);

// Reads are open to every member — the service narrows what staff can see
// (published modules only).
trainingRouter.get('/', validateQuery(listTrainingsQuerySchema), trainingController.listTrainings);
trainingRouter.get('/:id', trainingController.getTraining);

trainingRouter.post(
  '/',
  requireRole('chef'),
  validate(createTrainingSchema),
  trainingController.createTraining
);
trainingRouter.patch(
  '/:id',
  requireRole('chef'),
  validate(updateTrainingSchema),
  trainingController.updateTraining
);

// ── Placement ─────────────────────────────────────────────────────────────────

// Managers only: where a module lives decides which kitchens see it. The
// service re-validates the allow-list and widens block media before saving.
trainingRouter.put(
  '/:id/scope',
  requireRole('manager'),
  validate(moveTrainingSchema),
  trainingController.moveTraining
);

// ── Person-level access ───────────────────────────────────────────────────────

// PUT: the allow-list is replaced wholesale — idempotent, no merge semantics.
// The service enforces that only someone who can currently read AND manage the
// module may change its list; role alone is not enough.
trainingRouter.put(
  '/:id/access',
  requireRole('chef'),
  validate(updateTrainingAccessSchema),
  trainingController.updateTrainingAccess
);
trainingRouter.get(
  '/:id/access/candidates',
  requireRole('chef'),
  trainingController.listAccessCandidates
);

// ── Publish gate ──────────────────────────────────────────────────────────────

trainingRouter.post('/:id/publish', requireRole('chef'), trainingController.publishTraining);
trainingRouter.post('/:id/unpublish', requireRole('chef'), trainingController.unpublishTraining);

// Archival is a manager call, same as recipes.
trainingRouter.delete('/:id', requireRole('manager'), trainingController.archiveTraining);
trainingRouter.post('/:id/unarchive', requireRole('manager'), trainingController.unarchiveTraining);

// ── Completion ────────────────────────────────────────────────────────────────

// No requireRole: staff are the audience. The service still verifies the
// module is readable and published before recording anything.
trainingRouter.post('/:id/complete', trainingController.completeTraining);
trainingRouter.delete('/:id/complete', trainingController.uncompleteTraining);
trainingRouter.get('/:id/completions', requireRole('chef'), trainingController.listCompletions);

export { trainingRouter };
