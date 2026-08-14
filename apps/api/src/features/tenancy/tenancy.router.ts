import { Router } from 'express';
import {
  createLocationSchema,
  createOrganizationSchema,
  createPropertySchema,
  inviteMemberSchema,
  paginationSchema,
  updateLocationSchema,
  updateMembershipSchema,
  updateOrganizationSchema,
  updatePropertySchema,
} from '@rit/shared';
import * as tenancyController from './tenancy.controller';
import { authenticate } from '../../middleware/authenticate';
import { resolveTenant, requireRole } from '../../middleware/resolveTenant';
import { validate, validateQuery } from '../../middleware/validate';

const tenancyRouter = Router();

/**
 * Creating an org is the one tenant route that runs *without* `resolveTenant` —
 * there is no scope to resolve until the org exists. Every other route below
 * reads its org from the X-Org-Id header, so no tenant id ever appears in a path.
 */
tenancyRouter.post(
  '/organizations',
  authenticate,
  validate(createOrganizationSchema),
  tenancyController.createOrganization,
);

// ── Everything below is scoped to the active org ──────────────────────────────

tenancyRouter.use(authenticate, resolveTenant);

tenancyRouter.get('/organization', tenancyController.getOrganization);
tenancyRouter.patch(
  '/organization',
  requireRole('admin'),
  validate(updateOrganizationSchema),
  tenancyController.updateOrganization,
);

/** The visible org → property → location tree. Feeds the scope switcher. */
tenancyRouter.get('/tree', tenancyController.getTenantTree);

tenancyRouter.get('/properties', tenancyController.listProperties);
tenancyRouter.post(
  '/properties',
  requireRole('admin'),
  validate(createPropertySchema),
  tenancyController.createProperty,
);
tenancyRouter.patch(
  '/properties/:id',
  requireRole('admin'),
  validate(updatePropertySchema),
  tenancyController.updateProperty,
);

tenancyRouter.get('/locations', tenancyController.listLocations);
tenancyRouter.post(
  '/locations',
  requireRole('admin'),
  validate(createLocationSchema),
  tenancyController.createLocation,
);
tenancyRouter.patch(
  '/locations/:id',
  requireRole('manager'),
  validate(updateLocationSchema),
  tenancyController.updateLocation,
);

tenancyRouter.get(
  '/members',
  requireRole('manager'),
  validateQuery(paginationSchema),
  tenancyController.listMembers,
);
tenancyRouter.post(
  '/members',
  requireRole('admin'),
  validate(inviteMemberSchema),
  tenancyController.inviteMember,
);
tenancyRouter.patch(
  '/members/:id',
  requireRole('admin'),
  validate(updateMembershipSchema),
  tenancyController.updateMembership,
);
tenancyRouter.delete('/members/:id', requireRole('admin'), tenancyController.revokeMembership);

export { tenancyRouter };
