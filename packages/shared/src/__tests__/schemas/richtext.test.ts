import { describe, it, expect } from 'vitest';
import {
  docToPlainText,
  emptyRichTextDoc,
  plainTextToDoc,
  richTextDocSchema,
} from '../../schemas/richtext.js';
import type { RichTextDoc } from '../../schemas/richtext.js';
import { MAX_TRAINING_TEXT_CHARS } from '../../types/domain.js';

function doc(content: unknown[]): unknown {
  return { type: 'doc', content };
}

function paragraph(text: string): unknown {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

describe('richTextDocSchema', () => {
  it('accepts everything the editor can produce', () => {
    const result = richTextDocSchema.safeParse(
      doc([
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plain, ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ', struck', marks: [{ type: 'strike' }, { type: 'underline' }] },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: 'a link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/guide' } }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph('One')] },
            // Nested list inside an item — Tab in the editor produces this.
            {
              type: 'listItem',
              content: [
                paragraph('Two'),
                {
                  type: 'bulletList',
                  content: [{ type: 'listItem', content: [paragraph('Two point one')] }],
                },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [paragraph('Three')] }],
        },
        { type: 'blockquote', content: [paragraph('Quoted')] },
        { type: 'paragraph' },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('strips attributes outside the allow-list — the parse result is the sanitised copy', () => {
    const result = richTextDocSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          attrs: { textAlign: 'right' },
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://example.com', target: '_top', class: 'evil' },
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
    const parsed = result.data as RichTextDoc;
    expect('attrs' in parsed.content[0]).toBe(false);
    const mark = (parsed.content[0] as { content: { marks: unknown[] }[] }).content[0].marks[0];
    expect(mark).toEqual({ type: 'link', attrs: { href: 'https://example.com' } });
  });

  it('rejects node and mark types outside the allow-list', () => {
    expect(
      richTextDocSchema.safeParse(doc([{ type: 'iframe', attrs: { src: 'https://evil.io' } }]))
        .success,
    ).toBe(false);
    expect(
      richTextDocSchema.safeParse(
        doc([
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle' }] }],
          },
        ]),
      ).success,
    ).toBe(false);
  });

  it('rejects links that are not http(s)', () => {
    const bad = (href: string) =>
      richTextDocSchema.safeParse(
        doc([
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
          },
        ]),
      ).success;
    // eslint-disable-next-line no-script-url
    expect(bad('javascript:alert(1)')).toBe(false);
    expect(bad('data:text/html,x')).toBe(false);
    expect(bad('//protocol-relative.example')).toBe(false);
  });

  it('caps total text length across the whole document', () => {
    const half = 'x'.repeat(Math.ceil(MAX_TRAINING_TEXT_CHARS / 2) + 1);
    expect(richTextDocSchema.safeParse(doc([paragraph(half), paragraph(half)])).success).toBe(
      false,
    );
  });

  it('caps nesting depth', () => {
    let node: unknown = paragraph('deep');
    for (let i = 0; i < 30; i++) node = { type: 'blockquote', content: [node] };
    expect(richTextDocSchema.safeParse(doc([node])).success).toBe(false);
  });

  // Regression pin for two past failure modes: exponential union validation
  // (30 levels never finished) and a call-stack overflow escaping safeParse as
  // RangeError (~2000 levels). Completing at all is the assertion that
  // matters; the depth guard must fire before structural validation recurses.
  it('rejects absurdly deep input before structural validation can walk it', () => {
    let node: unknown = paragraph('deep');
    for (let i = 0; i < 5000; i++) node = { type: 'blockquote', content: [node] };
    const result = richTextDocSchema.safeParse(doc([node]));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('This text section is nested too deeply');
  });
});

describe('plain text helpers', () => {
  it('round-trips plain text through a document', () => {
    const roundTripped = docToPlainText(plainTextToDoc('First line\nsecond line\n\nNew paragraph'));
    expect(roundTripped).toBe('First line\nsecond line\nNew paragraph');
  });

  it('interprets no markup whatsoever', () => {
    const converted = plainTextToDoc('# Not a heading\n\n**not bold**');
    expect(converted.content).toHaveLength(2);
    expect(converted.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '# Not a heading' }],
    });
    expect(docToPlainText(converted)).toContain('**not bold**');
  });

  it('treats a fresh editor document as empty', () => {
    expect(docToPlainText(emptyRichTextDoc())).toBe('');
    expect(richTextDocSchema.safeParse(emptyRichTextDoc()).success).toBe(true);
  });
});
