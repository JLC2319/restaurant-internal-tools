import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/AppError';
import { User } from '../features/auth/auth.model';

/**
 * Gate for the /api/platform routes. Runs after `authenticate`, and reads the
 * role from the database rather than the token so a revoked superAdmin loses
 * access immediately instead of at token expiry.
 *
 * A non-staff caller gets 404, not 403 — existence hiding is the house rule,
 * and the platform console's routes are nobody's business but ours.
 */
export async function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const user = await User.findById(req.userId).select('platformRole').lean();
  if (user?.platformRole !== 'superAdmin') {
    throw new AppError('Not found', 404);
  }
  next();
}
