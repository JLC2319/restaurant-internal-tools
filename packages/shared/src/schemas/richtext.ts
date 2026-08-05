import { z } from 'zod';
import { MAX_TRAINING_TEXT_CHARS } from '../types/domain.js';

/**
 * The rich-text document model for training content — a strict subset of the
 * ProseMirror/TipTap JSON shape the web editor produces.
 *
 * SECURITY: this schema is the sanitiser. Zod's default strip mode drops every
 * attribute we do not declare (a link's `target`, pasted styles, whatever an
 * editor version adds later), and the discriminated unions reject any node or
 * mark type outside the allow-list below. What comes out of `.parse` is a
 * clean copy containing only structures the reader knows how to render — the
 * viewer builds real React elements from it and never touches `innerHTML`, so
 * there is no stored-HTML surface anywhere in the pipeline.
 *
 * The `superRefine` on the document caps total size, node count and nesting
 * depth, so a hand-crafted payload cannot wedge the renderer or the database.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RichTextLinkMark {
  type: 'link';
  attrs: { href: string };
}

export interface RichTextSimpleMark {
  type: 'bold' | 'italic' | 'underline' | 'strike';
}

export type RichTextMark = RichTextSimpleMark | RichTextLinkMark;

export interface RichTextTextNode {
  type: 'text';
  text: string;
  marks?: RichTextMark[];
}

export interface RichTextHardBreak {
  type: 'hardBreak';
}

export type RichTextInlineNode = RichTextTextNode | RichTextHardBreak;

export interface RichTextParagraph {
  type: 'paragraph';
  content?: RichTextInlineNode[];
}

export interface RichTextHeading {
  type: 'heading';
  attrs: { level: 1 | 2 | 3 };
  content?: RichTextInlineNode[];
}

export interface RichTextListItem {
  type: 'listItem';
  content: RichTextBlockNode[];
}

export interface RichTextBulletList {
  type: 'bulletList';
  content: RichTextListItem[];
}

export interface RichTextOrderedList {
  type: 'orderedList';
  attrs?: { start?: number };
  content: RichTextListItem[];
}

export interface RichTextBlockquote {
  type: 'blockquote';
  content: RichTextBlockNode[];
}

export type RichTextBlockNode =
  | RichTextParagraph
  | RichTextHeading
  | RichTextBulletList
  | RichTextOrderedList
  | RichTextBlockquote;

export interface RichTextDoc {
  type: 'doc';
  content: RichTextBlockNode[];
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const linkMarkSchema = z.object({
  type: z.literal('link'),
  attrs: z.object({
    href: z
      .string()
      .max(2000)
      .refine((href) => /^https?:\/\//i.test(href), {
        message: 'Links must start with http:// or https://',
      }),
  }),
});

const markSchema: z.ZodType<RichTextMark> = z.union([
  z.object({ type: z.enum(['bold', 'italic', 'underline', 'strike']) }),
  linkMarkSchema,
]);

const textNodeSchema: z.ZodType<RichTextTextNode> = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(MAX_TRAINING_TEXT_CHARS),
  marks: z.array(markSchema).max(8).optional(),
});

// A hard break may carry marks in ProseMirror; they mean nothing to us and
// strip mode drops the key entirely.
const hardBreakSchema: z.ZodType<RichTextHardBreak> = z.object({ type: z.literal('hardBreak') });

const inlineNodeSchema: z.ZodType<RichTextInlineNode> = z.union([
  textNodeSchema,
  hardBreakSchema,
]);

const inlineContentSchema = z.array(inlineNodeSchema).max(2000);

const paragraphSchema: z.ZodType<RichTextParagraph> = z.object({
  type: z.literal('paragraph'),
  content: inlineContentSchema.optional(),
});

const headingSchema: z.ZodType<RichTextHeading> = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  content: inlineContentSchema.optional(),
});

const listItemSchema: z.ZodType<RichTextListItem> = z.object({
  type: z.literal('listItem'),
  content: z.lazy(() => z.array(blockNodeSchema).min(1).max(200)),
});

const bulletListSchema: z.ZodType<RichTextBulletList> = z.object({
  type: z.literal('bulletList'),
  content: z.array(listItemSchema).min(1).max(500),
});

const orderedListSchema: z.ZodType<RichTextOrderedList> = z.object({
  type: z.literal('orderedList'),
  attrs: z.object({ start: z.number().int().min(1).max(1_000_000).optional() }).optional(),
  content: z.array(listItemSchema).min(1).max(500),
});

const blockquoteSchema: z.ZodType<RichTextBlockquote> = z.object({
  type: z.literal('blockquote'),
  content: z.lazy(() => z.array(blockNodeSchema).min(1).max(200)),
});

const blockNodeSchema: z.ZodType<RichTextBlockNode> = z.lazy(() =>
  z.union([paragraphSchema, headingSchema, bulletListSchema, orderedListSchema, blockquoteSchema])
);

/** Walks a parsed document once, for the whole-document limits below. */
function measure(
  node: { text?: string; content?: unknown[] },
  depth: number,
  totals: { nodes: number; chars: number; maxDepth: number }
): void {
  totals.nodes += 1;
  if (depth > totals.maxDepth) totals.maxDepth = depth;
  if (typeof node.text === 'string') totals.chars += node.text.length;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      measure(child as { text?: string; content?: unknown[] }, depth + 1, totals);
    }
  }
}

export const richTextDocSchema: z.ZodType<RichTextDoc> = z
  .object({
    type: z.literal('doc'),
    content: z.array(blockNodeSchema).max(1000),
  })
  .superRefine((doc, ctx) => {
    const totals = { nodes: 0, chars: 0, maxDepth: 0 };
    measure(doc, 0, totals);
    if (totals.chars > MAX_TRAINING_TEXT_CHARS) {
      ctx.addIssue({ code: 'custom', message: 'This text section is too long' });
    }
    if (totals.nodes > 5000) {
      ctx.addIssue({ code: 'custom', message: 'This text section has too many elements' });
    }
    if (totals.maxDepth > 20) {
      ctx.addIssue({ code: 'custom', message: 'This text section is nested too deeply' });
    }
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** What a brand-new, untouched editor contains. */
export function emptyRichTextDoc(): RichTextDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function textOfNodes(nodes: unknown[] | undefined, lines: string[], current: string[]): void {
  for (const node of nodes ?? []) {
    const typed = node as { type?: string; text?: string; content?: unknown[] };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      current.push(typed.text);
    } else if (typed.type === 'hardBreak') {
      lines.push(current.join(''));
      current.length = 0;
    } else if (Array.isArray(typed.content)) {
      textOfNodes(typed.content, lines, current);
      lines.push(current.join(''));
      current.length = 0;
    }
  }
}

/**
 * The plain text of a document — for emptiness checks, previews and (later)
 * search indexing. Block boundaries become newlines; formatting disappears.
 */
export function docToPlainText(doc: RichTextDoc): string {
  const lines: string[] = [];
  const current: string[] = [];
  textOfNodes(doc.content, lines, current);
  if (current.length > 0) lines.push(current.join(''));
  return lines.filter((line) => line.trim() !== '').join('\n');
}

/**
 * Wraps plain text into a document — the upgrade path for content stored
 * before the editor produced structured documents. Blank-line-separated runs
 * become paragraphs; single newlines become hard breaks. No markup of any
 * kind is interpreted.
 */
export function plainTextToDoc(text: string): RichTextDoc {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized === '') return emptyRichTextDoc();

  const paragraphs: RichTextParagraph[] = normalized.split(/\n{2,}/).map((paragraph) => {
    const content: RichTextInlineNode[] = [];
    paragraph.split('\n').forEach((line, index) => {
      if (index > 0) content.push({ type: 'hardBreak' });
      if (line !== '') content.push({ type: 'text', text: line });
    });
    return { type: 'paragraph', content };
  });

  return { type: 'doc', content: paragraphs };
}
