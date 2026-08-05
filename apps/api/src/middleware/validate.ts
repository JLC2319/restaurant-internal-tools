import type { Request, Response, NextFunction } from 'express';
import { type ZodType, ZodError } from 'zod';
import { AppError } from '../lib/AppError';

/**
 * Validates `req.body` and replaces it with the parsed result, so defaults and
 * coercions declared in the schema are what the controller actually sees.
 */
export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = (result.error as ZodError).issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new AppError('Validation failed', 400, errors);
    }
    req.body = result.data;
    next();
  };
}

/**
 * Same, for `req.query`. Kept separate because Express 5 makes `req.query` a
 * getter — the parsed value is stashed on `req.validatedQuery` instead of
 * being assigned back.
 */
export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = (result.error as ZodError).issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      throw new AppError('Validation failed', 400, errors);
    }
    req.validatedQuery = result.data;
    next();
  };
}
