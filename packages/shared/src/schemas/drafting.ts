import { z } from 'zod';

/**
 * AI recipe drafting. The photos travel as multipart files, so the only
 * validated body field is the optional free-text hint ("these are three pages
 * of one braise", "the second card is dessert").
 */
export const draftRecipesSchema = z.object({
  hint: z.string().trim().max(500).optional(),
});

/**
 * AI training drafting. Unlike recipes the text is a first-class source, not
 * just a hint — a chef may describe the whole training in prose and attach
 * nothing. Files (photos and PDFs) travel as multipart; the service requires
 * at least one source (description or file).
 */
export const draftTrainingsSchema = z.object({
  description: z.string().trim().max(5000).optional(),
});

export type DraftRecipesInput = z.infer<typeof draftRecipesSchema>;
export type DraftTrainingsInput = z.infer<typeof draftTrainingsSchema>;
