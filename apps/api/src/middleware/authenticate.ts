import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../lib/AppError';
import { User } from '../features/auth/auth.model';

export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Rejects the request unless the token's account still exists and is in good
 * standing. A JWT stays valid for up to 7 days after it is minted, so a
 * suspension has to be enforced against the database on every request — the
 * token proves who the caller is, never that they are still allowed in.
 *
 * Any new route that accepts a token must go through `authenticate` or
 * `optionalAuthenticate`. Never verify a JWT inline in a feature module.
 */
export async function assertAccountActive(userId: string): Promise<void> {
  const user = await User.findById(userId).select('status').lean();
  if (!user) {
    throw new AppError('Invalid or expired token', 401);
  }
  if (user.status === 'suspended') {
    throw new AppError('Your account has been suspended.', 403);
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid authorization header', 401);
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
