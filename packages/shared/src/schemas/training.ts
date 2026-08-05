import { z } from 'zod';
import { objectIdSchema, paginationSchema } from './common.js';
import { docToPlainText, richTextDocSchema } from './richtext.js';
import { MAX_TRAINING_BLOCKS, trainingStatusValues } from '../types/domain.js';
import type { VideoEmbedProvider } from '../types/domain.js';

// ── External video embeds ─────────────────────────────────────────────────────

/** A validated external video reference, with the iframe src derived from it. */
export interface VideoEmbed {
  provider: VideoEmbedProvider;
  /** Canonical embed URL (privacy-enhanced for YouTube). Safe to iframe as-is. */
  embedSrc: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

function youtubeEmbed(id: string | null | undefined): VideoEmbed | null {
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { provider: 'youtube', embedSrc: `https://www.youtube-nocookie.com/embed/${id}` };
}

function vimeoEmbed(id: string | null | undefined): VideoEmbed | null {
  if (!id || !VIMEO_ID.test(id)) return null;
  return { provider: 'vimeo', embedSrc: `https://player.vimeo.com/video/${id}` };
}

/**
 * Parses a pasted video URL into a provider + canonical embed src, or null when
 * it is not a recognisable YouTube/Vimeo video.
 *
 * SECURITY: this is the allow-list that decides what may be iframed into a
 * training. The stored value is the user's original URL; the iframe src is
 * *always* rebuilt here from the extracted id, so no user-controlled path or
 * query string ever reaches the embed. Anything unrecognised — including other
 * video hosts — is rejected at validation, not rendered.
 */
export function parseVideoEmbed(raw: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');

  if (host === 'youtu.be') {
    return youtubeEmbed(url.pathname.split('/')[1]);
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return youtubeEmbed(url.searchParams.get('v'));
    const path = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
    return youtubeEmbed(path?.[1]);
  }
  if (host === 'vimeo.com') {
    return vimeoEmbed(url.pathname.match(/^\/(\d+)(?:$|[/?#])/)?.[1]);
  }
  if (host === 'player.vimeo.com') {
    return vimeoEmbed(url.pathname.match(/^\/video\/(\d+)(?:$|[/?#])/)?.[1]);
  }
  return null;
}

// ── Content blocks ────────────────────────────────────────────────────────────

const captionSchema = z.string().trim().max(300).optional();

/**
 * One content block. Discriminated by `kind`, mirroring ingredient lines:
 * Zod enforces the per-kind shape at the boundary while Mongoose stores one
 * loose sub-schema.
 *
 * `text` blocks carry a rich-text document — see `richTextDocSchema`, which
 * is the allow-list that sanitises them. `mediaId` blocks reference assets
 * uploaded separately via `/api/media`; the service verifies each id is a
 * readable asset *of the right kind* in the caller's scope before storing it.
 * `embed` URLs must survive `parseVideoEmbed` — the allow-list above is the
 * validation.
 */
export const trainingBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    doc: richTextDocSchema.refine((doc) => docToPlainText(doc).trim() !== '', {
      message: 'Text block cannot be empty',
    }),
  }),
  z.object({
    kind: z.literal('image'),
    mediaId: objectIdSchema,
    caption: captionSchema,
  }),
  z.object({
    kind: z.literal('video'),
    mediaId: objectIdSchema,
    caption: captionSchema,
  }),
  z.object({
    kind: z.literal('embed'),
    url: z
      .string()
      .trim()
      .max(500)
      .refine((value) => parseVideoEmbed(value) != null, {
        message: 'Only YouTube and Vimeo links can be embedded',
      }),
    caption: captionSchema,
  }),
]);

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * Create a training module. `propertyId`/`locationId` optionally publish
 * downward from the caller's own scope — the same tier rule as recipes.
 * Modules are born `draft`; publishing is its own explicit call.
 */
export const createTrainingSchema = z
  .object({
    title: z.string().trim().min(2, 'Title is required').max(140),
    description: z.string().trim().max(500).default(''),
    blocks: z.array(trainingBlockSchema).max(MAX_TRAINING_BLOCKS).default([]),
    propertyId: objectIdSchema.nullish(),
    locationId: objectIdSchema.nullish(),
  })
  .refine((v) => !v.locationId || !!v.propertyId, {
    message: 'A location-scoped training must also name its property',
    path: ['propertyId'],
  });

export const updateTrainingSchema = z
  .object({
    title: z.string().trim().min(2).max(140).optional(),
    description: z.string().trim().max(500).optional(),
    blocks: z.array(trainingBlockSchema).max(MAX_TRAINING_BLOCKS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

/**
 * `status` selects one lifecycle stage per request; the segmented control on
 * the list page mirrors it. Readers are forced to `published` by the service
 * regardless of what they ask for.
 */
export const listTrainingsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(140).optional(),
  status: z.enum(trainingStatusValues).default('published'),
});

export type TrainingBlockInput = z.infer<typeof trainingBlockSchema>;
export type CreateTrainingInput = z.infer<typeof createTrainingSchema>;
export type UpdateTrainingInput = z.infer<typeof updateTrainingSchema>;
export type ListTrainingsQuery = z.infer<typeof listTrainingsQuerySchema>;
