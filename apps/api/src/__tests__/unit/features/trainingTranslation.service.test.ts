import { describe, it, expect } from 'vitest';
import { plainTextToDoc } from '@rit/shared';
import {
  sanitizeTrainingPayload,
  trainingSourceHashOf,
  trainingTranslatableProjection,
} from '../../../features/translations/trainingTranslation.service';
import type { ITrainingBlock, ITrainingModule } from '../../../types/index';

/**
 * The projection is the identity a translation is pinned to, and the
 * sanitizer is the safety seam on model output: block alignment is a hard
 * failure, nulls are pinned to the source's shape, ceilings clamp.
 */

function textBlock(text: string): ITrainingBlock {
  return { kind: 'text', doc: plainTextToDoc(text), mediaId: null };
}

function head(
  blocks: ITrainingBlock[],
  title = 'Knife Safety',
  description = 'Basics.',
): Pick<ITrainingModule, 'title' | 'description' | 'blocks'> {
  return { title, description, blocks };
}

describe('trainingTranslatableProjection', () => {
  it('projects text blocks as plain text and media blocks as captions', () => {
    const projection = trainingTranslatableProjection(
      head([
        textBlock('Hold the knife by the handle.'),
        { kind: 'image', mediaId: null, caption: 'Correct grip' },
        { kind: 'video', mediaId: null },
      ]),
    );
    expect(projection.blocks).toEqual([
      { text: 'Hold the knife by the handle.', caption: null },
      { text: null, caption: 'Correct grip' },
      { text: null, caption: null },
    ]);
  });

  it('reads legacy plain-text bodies through the same fallback as the reader', () => {
    const projection = trainingTranslatableProjection(
      head([{ kind: 'text', body: 'Old plain text.', mediaId: null }]),
    );
    expect(projection.blocks[0].text).toBe('Old plain text.');
  });

  it('changes the hash when text changes, block order changes, or a caption changes', () => {
    const a = trainingSourceHashOf(
      trainingTranslatableProjection(head([textBlock('One.'), textBlock('Two.')])),
    );
    const edited = trainingSourceHashOf(
      trainingTranslatableProjection(head([textBlock('One!'), textBlock('Two.')])),
    );
    const reordered = trainingSourceHashOf(
      trainingTranslatableProjection(head([textBlock('Two.'), textBlock('One.')])),
    );
    expect(edited).not.toBe(a);
    expect(reordered).not.toBe(a);
    // Identical content — identical identity, so re-publishing is a no-op.
    const again = trainingSourceHashOf(
      trainingTranslatableProjection(head([textBlock('One.'), textBlock('Two.')])),
    );
    expect(again).toBe(a);
  });
});

describe('sanitizeTrainingPayload', () => {
  const projection = trainingTranslatableProjection(
    head([textBlock('Wash hands.'), { kind: 'image', mediaId: null, caption: 'Sink' }]),
  );

  it('accepts aligned output and pins nulls to the source shape', () => {
    const payload = sanitizeTrainingPayload(
      {
        title: 'Seguridad con cuchillos',
        description: 'Lo básico.',
        blocks: [
          { text: 'Lávese las manos.', caption: 'ignored' },
          { text: 'invented', caption: 'Lavabo' },
        ],
      },
      projection,
    );
    // A media block's text stays null whatever the model said, and a text
    // block never grows a caption.
    expect(payload.blocks).toEqual([
      { text: 'Lávese las manos.', caption: null },
      { text: null, caption: 'Lavabo' },
    ]);
  });

  it('hard-fails on a block-count mismatch', () => {
    expect(() =>
      sanitizeTrainingPayload(
        { title: 'T', description: '', blocks: [{ text: 'solo', caption: null }] },
        projection,
      ),
    ).toThrowError(/did not line up/);
  });

  it('hard-fails when a text block comes back empty', () => {
    expect(() =>
      sanitizeTrainingPayload(
        {
          title: 'T',
          description: '',
          blocks: [
            { text: null, caption: null },
            { text: null, caption: 'Lavabo' },
          ],
        },
        projection,
      ),
    ).toThrowError(/did not line up/);
  });

  it('hard-fails on an empty title and clamps ceilings', () => {
    expect(() =>
      sanitizeTrainingPayload(
        {
          title: '   ',
          description: '',
          blocks: [
            { text: 'x', caption: null },
            { text: null, caption: null },
          ],
        },
        projection,
      ),
    ).toThrowError(/did not line up/);

    const clamped = sanitizeTrainingPayload(
      {
        title: 't'.repeat(400),
        description: 'd'.repeat(2000),
        blocks: [
          { text: 'x'.repeat(30000), caption: null },
          { text: null, caption: 'c'.repeat(1000) },
        ],
      },
      projection,
    );
    expect(clamped.title).toHaveLength(180);
    expect(clamped.description).toHaveLength(700);
    expect(clamped.blocks[0].text).toHaveLength(25000);
    expect(clamped.blocks[1].caption).toHaveLength(400);
  });
});
