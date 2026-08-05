import { z } from 'zod';

/** A 24-character hex Mongo ObjectId, as it appears in JSON. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

/**
 * Query-string pagination. Coerced because everything arrives as a string;
 * `limit` is capped so a client cannot ask for the whole collection.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * A URL-safe slug. Used for org/property/location so links and imports can
 * reference a tenant without leaking database ids.
 */
export const slugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

/** Normalises arbitrary display text into a slug candidate. */
export function toSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
