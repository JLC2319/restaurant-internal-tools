import { describe, it, expect } from 'vitest';
import {
  createTrainingSchema,
  listTrainingsQuerySchema,
  parseVideoEmbed,
  trainingBlockSchema,
  updateTrainingSchema,
} from '../../schemas/training.js';
import { plainTextToDoc } from '../../schemas/richtext.js';
import { MAX_TRAINING_BLOCKS } from '../../types/domain.js';

const OID = '507f1f77bcf86cd799439011';

/** A minimal valid rich-text document for block fixtures. */
function textDoc(text: string): unknown {
  return plainTextToDoc(text);
}

describe('parseVideoEmbed', () => {
  it('accepts every common YouTube URL shape and rebuilds a nocookie embed src', () => {
    const expected = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    const urls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ];
    for (const url of urls) {
      expect(parseVideoEmbed(url)).toEqual({ provider: 'youtube', embedSrc: expected });
    }
  });

  it('accepts Vimeo page and player URLs', () => {
    const expected = { provider: 'vimeo', embedSrc: 'https://player.vimeo.com/video/76979871' };
    expect(parseVideoEmbed('https://vimeo.com/76979871')).toEqual(expected);
    expect(parseVideoEmbed('https://player.vimeo.com/video/76979871')).toEqual(expected);
  });

  it('rejects other hosts, including lookalikes', () => {
    expect(parseVideoEmbed('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoEmbed('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoEmbed('https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoEmbed('https://vimeo.com/not-a-video')).toBeNull();
  });

  it('rejects non-http(s) schemes — the embed src must never be scriptable', () => {
    // eslint-disable-next-line no-script-url
    expect(parseVideoEmbed('javascript:alert(1)')).toBeNull();
    expect(parseVideoEmbed('data:text/html,<script>1</script>')).toBeNull();
    expect(parseVideoEmbed('not a url at all')).toBeNull();
  });

  it('rejects a malformed YouTube id rather than embedding a guess', () => {
    expect(parseVideoEmbed('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoEmbed('https://youtu.be/')).toBeNull();
  });

  it('derives the embed src from the id alone — attacker path/query never survives', () => {
    const embed = parseVideoEmbed(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1&onload=evil'
    );
    expect(embed?.embedSrc).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
});

describe('trainingBlockSchema', () => {
  it('accepts each block kind with its own required fields', () => {
    expect(trainingBlockSchema.safeParse({ kind: 'text', doc: textDoc('Hello') }).success).toBe(
      true
    );
    expect(trainingBlockSchema.safeParse({ kind: 'image', mediaId: OID }).success).toBe(true);
    expect(
      trainingBlockSchema.safeParse({ kind: 'video', mediaId: OID, caption: 'Plating' }).success
    ).toBe(true);
    expect(
      trainingBlockSchema.safeParse({ kind: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' }).success
    ).toBe(true);
  });

  it('rejects a text block with nothing in it', () => {
    expect(trainingBlockSchema.safeParse({ kind: 'text', doc: textDoc('') }).success).toBe(false);
    expect(trainingBlockSchema.safeParse({ kind: 'text', doc: textDoc('   ') }).success).toBe(
      false
    );
  });

  it('rejects a media block without an ObjectId', () => {
    expect(trainingBlockSchema.safeParse({ kind: 'image' }).success).toBe(false);
    expect(trainingBlockSchema.safeParse({ kind: 'video', mediaId: 'nope' }).success).toBe(false);
  });

  it('rejects an embed pointing anywhere but the allow-listed providers', () => {
    expect(
      trainingBlockSchema.safeParse({ kind: 'embed', url: 'https://evil.example/video' }).success
    ).toBe(false);
  });
});

describe('createTrainingSchema', () => {
  it('defaults description and blocks so a bare title creates a draft', () => {
    const result = createTrainingSchema.safeParse({ title: 'Knife Safety' });
    expect(result.success).toBe(true);
    expect(result.data?.description).toBe('');
    expect(result.data?.blocks).toEqual([]);
  });

  it('caps the block list', () => {
    const blocks = Array.from({ length: MAX_TRAINING_BLOCKS + 1 }, () => ({
      kind: 'text' as const,
      doc: textDoc('x'),
    }));
    expect(createTrainingSchema.safeParse({ title: 'Too Long', blocks }).success).toBe(false);
  });

  it('requires a property when a location is named — same tier rule as recipes', () => {
    const result = createTrainingSchema.safeParse({ title: 'Scoped', locationId: OID });
    expect(result.success).toBe(false);
  });
});

describe('updateTrainingSchema', () => {
  it('rejects an empty update', () => {
    expect(updateTrainingSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a blocks-only update', () => {
    const result = updateTrainingSchema.safeParse({
      blocks: [{ kind: 'text', doc: textDoc('Updated') }],
    });
    expect(result.success).toBe(true);
  });
});

describe('listTrainingsQuerySchema', () => {
  it('defaults to published — the reader-facing slice', () => {
    const result = listTrainingsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('published');
  });

  it('rejects a status outside the lifecycle', () => {
    expect(listTrainingsQuerySchema.safeParse({ status: 'live' }).success).toBe(false);
  });
});
