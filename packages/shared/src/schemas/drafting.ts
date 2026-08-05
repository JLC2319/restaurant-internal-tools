import { z } from 'zod';

/**
 * AI recipe drafting. The photos travel as multipart files, so the only
 * validated body field is the optional free-text hint ("these are three pages
 * of one braise", "the second card is dessert").
 */
export const draftRecipesSchema = z.object({
  hint: z.string().trim().max(500).optional(),
});

export type DraftRecipesInput = z.infer<typeof draftRecipesSchema>;
