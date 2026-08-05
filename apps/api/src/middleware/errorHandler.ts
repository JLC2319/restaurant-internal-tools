import type { Request, Response, NextFunction } from 'express';
import { Error as MongooseError } from 'mongoose';
import { MulterError } from 'multer';
import { AppError } from '../lib/AppError';

// Multer aborts an upload as soon as a limit is exceeded, so these never reach
// a route handler. Without this branch they fall through to the 500 below,
// which tells a chef with an oversized plating photo nothing useful.
const MULTER_MESSAGES: Record<string, { status: number; message: string }> = {
  LIMIT_FILE_SIZE: { status: 413, message: 'That file is too large. Please upload a smaller one.' },
  LIMIT_FILE_COUNT: { status: 400, message: 'Too many files in one upload.' },
  LIMIT_UNEXPECTED_FILE: { status: 400, message: 'Too many files in one upload.' },
};

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { message: err.message };
    if (err.errors) body.errors = err.errors;
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof MulterError) {
    const mapped = MULTER_MESSAGES[err.code] ?? {
      status: 400,
      message: 'That upload could not be processed.',
    };
    res.status(mapped.status).json({ message: mapped.message });
    return;
  }

  // Mongoose throws CastError when an invalid ObjectId reaches a query.
  // Return 400 rather than leaking a 500 for this common client mistake.
  if (err instanceof MongooseError.CastError) {
    res.status(400).json({ message: 'Invalid ID format' });
    return;
  }

  // A duplicate-key error is always a uniqueness constraint we declared —
  // a taken slug or a second membership for the same user in the same scope.
  if ((err as { code?: number }).code === 11000) {
    res.status(409).json({ message: 'That record already exists' });
    return;
  }

  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
}
