import { Router } from 'express';
import { registerSchema, loginSchema, updateMeSchema, changePasswordSchema } from '@rit/shared';
import * as authController from './auth.controller';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { authRateLimiter } from '../../middleware/rateLimiter';

const authRouter = Router();

authRouter.post('/register', authRateLimiter, validate(registerSchema), authController.register);
authRouter.post('/login', authRateLimiter, validate(loginSchema), authController.login);

authRouter.get('/me', authenticate, authController.getMe);
authRouter.patch('/me', authenticate, validate(updateMeSchema), authController.updateMe);

/** Every scope this user may act in — feeds the web scope switcher. */
authRouter.get('/me/memberships', authenticate, authController.getMyMemberships);

authRouter.post(
  '/change-password',
  authenticate,
  authRateLimiter,
  validate(changePasswordSchema),
  authController.changePassword
);

export { authRouter };
