import { describe, it, expect } from 'vitest';
import { AppError } from '../../../lib/AppError';

describe('AppError', () => {
  it('defaults to a 500', () => {
    const error = new AppError('boom');
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('boom');
  });

  it('carries field-level validation errors', () => {
    const error = new AppError('Validation failed', 400, [{ field: 'email', message: 'Required' }]);
    expect(error.statusCode).toBe(400);
    expect(error.errors).toEqual([{ field: 'email', message: 'Required' }]);
  });

  // errorHandler branches on `instanceof`, which breaks when the prototype
  // chain is lost — the reason for the setPrototypeOf call in the constructor.
  it('survives instanceof after subclassing Error', () => {
    const error = new AppError('nope', 404);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});
