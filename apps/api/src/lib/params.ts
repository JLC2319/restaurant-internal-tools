import type { Request } from 'express';
import { AppError } from './AppError';

/**
 * Reads a path parameter as a string.
 *
 * Express 5 types `req.params` values as `string | string[]` because a wildcard
 * segment can repeat. Ours never do, but the union still has to be collapsed
 * somewhere — doing it here keeps the cast out of every controller.
 */
export function pathParam(req: Request, name: string): string {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new AppError(`Missing path parameter: ${name}`, 400);
  return value;
}

/** Reads a query-string value as a single string, or undefined when absent. */
export function queryParam(req: Request, name: string): string | undefined {
  const raw = req.query[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}
