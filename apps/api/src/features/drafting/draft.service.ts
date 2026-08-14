import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { MAX_DRAFT_TOTAL_BYTES, allergenValues, dietaryValues, unitValues } from '@rit/shared';
import type {
  DraftRecipesResponse,
  ImageMime,
  RecipeDraftProposal,
  TenantContext,
} from '@rit/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { anthropic } from '../../lib/anthropic';
import { AppError } from '../../lib/AppError';
import { sniffImage } from '../../lib/imageMeta';
import { assertRole } from '../../lib/scope';

/**
 * AI recipe drafting: photos of recipe cards, cookbook pages, spec sheets (or
 * a plated dish) in, structured recipe proposals out. Nothing is persisted
 * here — the caller reviews each proposal and explicitly creates a recipe
 * from it through the ordinary create flow, so machine output never enters
 * the database untouched by a human, and what it creates is an unpublished
 * draft staff cannot see.
 *
 * SAFETY: the model is instructed to transcribe allergen/dietary tags only
 * when the source states them and NEVER infer them; whatever it returns still
 * enters the recipe as pending-review tags a chef must sign off.
 */

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

// ── The LLM contract ──────────────────────────────────────────────────────────

const llmQuantitySchema = z.object({
  amount: z.number(),
  unit: z.enum(unitValues),
});

const llmDraftRecipeSchema = z.object({
  name: z.string(),
  description: z.string(),
  yield: llmQuantitySchema,
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: llmQuantitySchema,
      note: z.string().nullable(),
    }),
  ),
  steps: z.array(z.string()),
  allergens: z.array(z.enum(allergenValues)),
  dietary: z.array(z.enum(dietaryValues)),
  prepMinutes: z.number().nullable(),
  cookMinutes: z.number().nullable(),
  notes: z.string().nullable(),
});

const llmDraftResponseSchema = z.object({
  recipes: z.array(llmDraftRecipeSchema),
  notes: z.string().nullable(),
});

const DRAFTING_SYSTEM = `You digitize restaurant recipes from photos into a professional kitchen's recipe system.

The photos may show handwritten recipe cards, printed sheets, cookbook pages, spec sheets, whiteboards, or plated dishes. They may be several pages of ONE recipe, or several separate recipes — decide from the content and return one entry per distinct recipe.

Rules:
- Transcribe faithfully. Keep every quantity, temperature and time exactly as written in the method steps.
- Author everything in English. If a source is written in another language, translate it and say so in that recipe's notes.
- Every ingredient quantity must be a positive number with one of the allowed units from the schema. When the source uses something else ("a pinch", "to taste", "1 large"), pick the closest allowed unit and keep the original wording in that ingredient's note.
- ALLERGEN AND DIETARY TAGS: include a tag ONLY when the source explicitly states it ("contains nuts", "GF", "vegan"). NEVER infer tags from the ingredient list — a wrong safety claim is worse than none. When the source states nothing, return empty arrays.
- If a photo shows only a plated dish with no written recipe, draft your best professional reconstruction and state clearly in that recipe's notes that it is inferred, not transcribed.
- Anything you could not read, had to guess, or deliberately adapted goes in that recipe's notes.
- If none of the photos contain recipe material, return an empty recipes array and explain why in the top-level notes.`;

// ── Sanitising model output into proposals ────────────────────────────────────

const clamp = (value: string, max: number): string => value.trim().slice(0, max);

function saneQuantity(q: z.infer<typeof llmQuantitySchema>): {
  quantity: { amount: number; unit: (typeof unitValues)[number] };
  unclear: boolean;
} {
  const valid = Number.isFinite(q.amount) && q.amount > 0;
  return {
    quantity: { amount: valid ? q.amount : 1, unit: q.unit },
    unclear: !valid,
  };
}

/**
 * Clamps model output to the recipe schema's ceilings so every proposal is
 * creatable as-is. Unreadable quantities become 1 with the problem flagged in
 * the line's note — the reviewer sees the flag rather than a silent guess.
 * Exported for unit tests.
 */
export function shapeProposal(raw: z.infer<typeof llmDraftRecipeSchema>): RecipeDraftProposal {
  const yieldQ = saneQuantity(raw.yield);

  const ingredients = raw.ingredients
    .filter((ing) => ing.name.trim().length > 0)
    .slice(0, 200)
    .map((ing) => {
      const { quantity, unclear } = saneQuantity(ing.quantity);
      const note = ing.note ? clamp(ing.note, 300) : '';
      const flagged = unclear ? `[quantity unclear] ${note}`.trim() : note;
      return {
        name: clamp(ing.name, 120),
        quantity,
        note: flagged ? flagged.slice(0, 300) : null,
      };
    });

  const minutes = (value: number | null): number | undefined =>
    value != null && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  const prepMinutes = minutes(raw.prepMinutes);
  const cookMinutes = minutes(raw.cookMinutes);

  return {
    name: clamp(raw.name, 120) || 'Untitled recipe',
    description: clamp(raw.description, 2000),
    yield: yieldQ.quantity,
    ingredients,
    steps: raw.steps
      .map((step) => clamp(step, 2000))
      .filter((step) => step.length > 0)
      .slice(0, 100),
    allergens: [...new Set(raw.allergens)],
    dietary: [...new Set(raw.dietary)],
    times:
      prepMinutes !== undefined || cookMinutes !== undefined
        ? { prepMinutes: prepMinutes ?? null, cookMinutes: cookMinutes ?? null }
        : null,
    notes: raw.notes
      ? clamp(yieldQ.unclear ? `Yield quantity was unclear. ${raw.notes}` : raw.notes, 2000)
      : yieldQ.unclear
        ? 'Yield quantity was unclear.'
        : null,
  };
}

// ── The endpoint's work ───────────────────────────────────────────────────────

export async function draftRecipesFromPhotos(
  ctx: TenantContext,
  files: UploadedPhoto[] | undefined,
  hint: string | undefined,
): Promise<DraftRecipesResponse> {
  assertRole(ctx, 'chef');
  if (!env.aiDraftingEnabled) {
    throw new AppError('AI recipe drafting is not configured on this server', 503);
  }
  if (!files || files.length === 0) {
    throw new AppError('No photos were uploaded', 400);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_DRAFT_TOTAL_BYTES) {
    throw new AppError('Those photos total more than 20MB. Remove one or two and try again.', 413);
  }

  // Same rule as every other upload: the bytes decide the format, never the
  // client's filename or Content-Type.
  const images: { mime: ImageMime; data: string }[] = files.map((file, index) => {
    const meta = sniffImage(file.buffer);
    if (!meta) {
      throw new AppError(`Photo ${index + 1} is not a JPEG, PNG or WebP image`, 415);
    }
    return { mime: meta.mime, data: file.buffer.toString('base64') };
  });

  let response;
  try {
    response = await anthropic().messages.parse({
      model: env.llmModel,
      max_tokens: 16000,
      system: DRAFTING_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((image) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: image.mime, data: image.data },
            })),
            {
              type: 'text' as const,
              text: hint
                ? `Extract every recipe from these photos.\n\nSubmitter's hint: ${hint}`
                : 'Extract every recipe from these photos.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(llmDraftResponseSchema) },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('AI recipe drafting failed', err);
    throw new AppError('The drafting service is unavailable right now. Please try again.', 502);
  }

  if (!response.parsed_output) {
    throw new AppError('The drafting service returned no usable output. Please try again.', 502);
  }

  return {
    proposals: response.parsed_output.recipes.map(shapeProposal),
    notes: response.parsed_output.notes ? clamp(response.parsed_output.notes, 2000) : null,
    model: env.llmModel,
  };
}
