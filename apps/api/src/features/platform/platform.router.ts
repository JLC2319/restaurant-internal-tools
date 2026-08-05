import { Router } from 'express';
import {
  platformCreateOrganizationSchema,
  platformListQuerySchema,
  platformUpdateOrganizationSchema,
  platformUpdateUserSchema,
} from '@rit/shared';
import * as platformController from './platform.controller';
import { authenticate } from '../../middleware/authenticate';
import { requireSuperAdmin } from '../../middleware/requireSuperAdmin';
import { validate, validateQuery } from '../../middleware/validate';

const platformRouter = Router();

/**
 * Platform staff only. These routes act across every tenant, so instead of
 * `resolveTenant` the whole router sits behind `requireSuperAdmin`, which
 * answers 404 — not 403 — for anyone else (existence hiding, the house rule).
 */
platformRouter.use(authenticate, requireSuperAdmin);

platformRouter.get('/stats', platformController.getStats);

platformRouter.get(
  '/organizations',
  validateQuery(platformListQuerySchema),
  platformController.listOrganizations
);
platformRouter.post(
  '/organizations',
  validate(platformCreateOrganizationSchema),
  platformController.createOrganization
);
platformRouter.get('/organizations/:id', platformController.getOrganizationDetail);
platformRouter.patch(
  '/organizations/:id',
  validate(platformUpdateOrganizationSchema),
  platformController.updateOrganization
);

platformRouter.get('/users', validateQuery(platformListQuerySchema), platformController.listUsers);
platformRouter.patch('/users/:id', validate(platformUpdateUserSchema), platformController.updateUser);

export { platformRouter };
