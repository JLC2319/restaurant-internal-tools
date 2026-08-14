import { z } from 'zod';
import { MAX_TRAINING_BLOCKS, targetLocaleValues } from '../types/domain.js';

/**
 * Recipe translation payloads. A translation carries only the *text* of a
 * recipe — every number, unit, photo and tag renders from the source version,
 * so a translation can never disagree with the recipe about what is in the
 * dish. Arrays align with the source by index; the API rejects a payload whose
 * shape does not match the version it claims to translate.
 *
 * Ceilings run a little past the source fields' (120/300/2000/2000): Spanish
 * routinely runs longer than the English it translates.
 */

/**
 * One translated ingredient line. `name` is null for `recipe`-kind lines —
 * sub-recipe names belong to their own lineage and are not translated here.
 */
export const translatedIngredientSchema = z.object({
  name: z.string().trim().min(1).max(160).nullable(),
  note: z.string().trim().min(1).max(400).nullable(),
});

export const translationPayloadSchema = z.object({
  name: z.string().trim().min(1, 'Translated name is required').max(160),
  description: z.string().trim().max(3000),
  ingredients: z.array(translatedIngredientSchema).max(200),
  steps: z.array(z.string().trim().min(1).max(3000)).max(100),
});

/** Trigger a machine translation, or name the locale on approve/reject. */
export const translationLocaleSchema = z.object({
  locale: z.enum(targetLocaleValues).default('es'),
});

/** Save a reviewer's edits to a machine translation. */
export const updateTranslationSchema = z.object({
  locale: z.enum(targetLocaleValues).default('es'),
  payload: translationPayloadSchema,
});

// ── Training translations ─────────────────────────────────────────────────────

/**
 * One translated training block, aligned by index with the module's blocks.
 * `text` is the translated plain text of a `text` block (null for every other
 * kind); `caption` is the translated caption of a media/embed block (null when
 * the source block has none). Media itself never translates — the assets and
 * embeds always render from the source module.
 */
export const translatedTrainingBlockSchema = z.object({
  text: z.string().trim().min(1).max(25000).nullable(),
  caption: z.string().trim().min(1).max(400).nullable(),
});

/** Ceilings run past the source fields' (140/500/300/20000), as for recipes. */
export const trainingTranslationPayloadSchema = z.object({
  title: z.string().trim().min(1, 'Translated title is required').max(180),
  description: z.string().trim().max(700),
  blocks: z.array(translatedTrainingBlockSchema).max(MAX_TRAINING_BLOCKS),
});

/** Save a reviewer's edits to a machine training translation. */
export const updateTrainingTranslationSchema = z.object({
  locale: z.enum(targetLocaleValues).default('es'),
  payload: trainingTranslationPayloadSchema,
});

export type TranslatedIngredientInput = z.infer<typeof translatedIngredientSchema>;
export type TranslationPayloadInput = z.infer<typeof translationPayloadSchema>;
export type TranslationLocaleInput = z.infer<typeof translationLocaleSchema>;
export type UpdateTranslationInput = z.infer<typeof updateTranslationSchema>;
export type TranslatedTrainingBlockInput = z.infer<typeof translatedTrainingBlockSchema>;
export type TrainingTranslationPayloadInput = z.infer<typeof trainingTranslationPayloadSchema>;
export type UpdateTrainingTranslationInput = z.infer<typeof updateTrainingTranslationSchema>;
