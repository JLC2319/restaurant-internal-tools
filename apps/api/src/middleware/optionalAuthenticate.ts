import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../lib/AppError';
import { assertAccountActive, type JwtPayload } from './authenticate';

/**
 * Sets `req.userId` when a valid Bearer token is present and passes through
 * without one otherwise.
 *
 * A *present but invalid* token is still a 401 — treating deliberate token
 * manipulation as an anonymous request hides the failure from the client and
 * silently downgrades what they see.
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next();
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new AppError('Invalid authorization header format', 401);
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  await assertAccountActive(payload.sub);

  req.userId = payload.sub;
  next();
}
