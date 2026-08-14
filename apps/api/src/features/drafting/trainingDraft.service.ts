import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  MAX_DRAFT_TOTAL_BYTES,
  MAX_TRAINING_BLOCKS,
  MAX_TRAINING_TEXT_CHARS,
} from '@rit/shared';
import type { DraftTrainingsResponse, ImageMime, TenantContext, TrainingDraftProposal } from '@rit/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { anthropic } from '../../lib/anthropic';
import { AppError } from '../../lib/AppError';
import { sniffImage } from '../../lib/imageMeta';
import { sniffPdf } from '../../lib/pdfMeta';
import { assertRole } from '../../lib/scope';

/**
 * AI training drafting: a written description, photos (of SOP sheets,
 * handbooks, whiteboards, equipment) and/or PDFs in, structured training
 * module proposals out. Nothing is persisted here — the caller reviews each
 * proposal and explicitly creates a module from it through the ordinary
 * create flow, so machine output never enters the database untouched by a
 * human, and what it creates is an unpublished draft staff cannot see.
 *
 * Submitted files exist only for the one model call — never written to disk
 * or object storage — so proposals carry text sections only; the chef adds
 * images and video in the editor afterwards.
 */

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

// ── The LLM contract ──────────────────────────────────────────────────────────

const llmDraftTrainingSchema = z.object({
  title: z.string(),
  description: z.string(),
  sections: z.array(z.string()),
  notes: z.string().nullable(),
});

const llmDraftResponseSchema = z.object({
  trainings: z.array(llmDraftTrainingSchema),
  notes: z.string().nullable(),
});

const TRAINING_DRAFTING_SYSTEM = `You draft staff training modules for a restaurant's internal training system.

The submitter provides any mix of: a written description of the training they want, photos (of SOP sheets, handbooks, whiteboards, equipment, or workspaces), and PDF documents (manuals, policy documents, training binders). The material may describe ONE training or several distinct ones — decide from the content and return one entry per distinct training.

Rules:
- Ground every training in the submitted material. Where the description and an attached document conflict, follow the document and flag the conflict in that training's notes.
- Author everything in English. If a source is written in another language, translate it and say so in that training's notes.
- Structure each training as an ordered list of sections: short, focused blocks of plain text a trainee reads top to bottom (an overview first, then procedure steps, then checks/pitfalls where the material supports them). Use plain text — no markdown syntax. Separate paragraphs within a section by blank lines.
- Keep every number, temperature, time and measurement EXACTLY as the source states it. For safety-critical material (food safety, equipment, chemicals), transcribe faithfully and NEVER invent limits, temperatures or hold times the source does not state — a wrong safety claim is worse than a gap. Flag gaps in notes instead.
- The description field is a one-or-two sentence summary of what the training covers, for the module list.
- Anything you could not read, had to guess, or deliberately adapted goes in that training's notes.
- If none of the material can support a training, return an empty trainings array and explain why in the top-level notes.`;

// ── Sanitising model output into proposals ────────────────────────────────────

const clamp = (value: string, max: number): string => value.trim().slice(0, max);

/**
 * Clamps model output to the training schema's ceilings so every proposal is
 * creatable as-is. Exported for unit tests.
 */
export function shapeTrainingProposal(
  raw: z.infer<typeof llmDraftTrainingSchema>
): TrainingDraftProposal {
  return {
    title: clamp(raw.title, 140) || 'Untitled training',
    description: clamp(raw.description, 500),
    sections: raw.sections
      .map((section) => clamp(section, MAX_TRAINING_TEXT_CHARS))
      .filter((section) => section.length > 0)
      .slice(0, MAX_TRAINING_BLOCKS),
    notes: raw.notes ? clamp(raw.notes, 2000) : null,
  };
}

// ── The endpoint's work ───────────────────────────────────────────────────────

type SourceBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMime; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export async function draftTrainingsFromMaterials(
  ctx: TenantContext,
  files: UploadedFile[] | undefined,
  description: string | undefined
): Promise<DraftTrainingsResponse> {
  assertRole(ctx, 'chef');
  if (!env.aiDraftingEnabled) {
    throw new AppError('AI training drafting is not configured on this server', 503);
  }
  const hasDescription = !!description && description.trim().length > 0;
  if (!hasDescription && (!files || files.length === 0)) {
    throw new AppError('Write a description or upload at least one photo or PDF', 400);
  }

  const totalBytes = (files ?? []).reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_DRAFT_TOTAL_BYTES) {
    throw new AppError('Those files total more than 20MB. Remove one or two and try again.', 413);
  }

  // Same rule as every other upload: the bytes decide the format, never the
  // client's filename or Content-Type. Photos and PDFs share one field; each
  // file rides the lane its bytes put it in.
  const sources: SourceBlock[] = (files ?? []).map((file, index) => {
    const image = sniffImage(file.buffer);
    if (image) {
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mime,
          data: file.buffer.toString('base64'),
        },
      };
    }
    if (sniffPdf(file.buffer)) {
      return {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: file.buffer.toString('base64'),
        },
      };
    }
    throw new AppError(`File ${index + 1} is not a JPEG, PNG, WebP image or a PDF`, 415);
  });

  let response;
  try {
    response = await anthropic().messages.parse({
      model: env.llmModel,
      // The SDK refuses non-streaming requests whose max_tokens implies >10
      // minutes of generation (~21k tokens), so this matches recipe drafting
      // rather than sizing for a whole manual — proposals are summaries, and
      // 16k tokens of output is roomy for them.
      max_tokens: 16000,
      system: TRAINING_DRAFTING_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...sources,
            {
              type: 'text' as const,
              text: hasDescription
                ? `Draft the training module(s) from this material.\n\nSubmitter's description: ${description!.trim()}`
                : 'Draft the training module(s) from this material.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(llmDraftResponseSchema) },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('AI training drafting failed', err);
    throw new AppError('The drafting service is unavailable right now. Please try again.', 502);
  }

  if (!response.parsed_output) {
    throw new AppError('The drafting service returned no usable output. Please try again.', 502);
  }

  return {
    proposals: response.parsed_output.trainings.map(shapeTrainingProposal),
    notes: response.parsed_output.notes ? clamp(response.parsed_output.notes, 2000) : null,
    model: env.llmModel,
  };
}
