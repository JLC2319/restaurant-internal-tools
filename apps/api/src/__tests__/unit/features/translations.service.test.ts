import { describe, it, expect } from 'vitest';
import {
  sanitizePayload,
  sourceHashOf,
  translatableProjection,
} from '../../../features/translations/translation.service';
import { AppError } from '../../../lib/AppError';
import type { IRecipeContent } from '../../../types/index';

/**
 * The pure spine of the translation feature: what counts as the translatable
 * text, when two sources hash the same, and how model output is clamped and
 * alignment-checked. The HTTP flows (review gate, staleness knock-back,
 * tenant isolation) live in the integration suite.
 */

type ProjectionContent = Pick<IRecipeContent, 'description' | 'ingredients' | 'steps'>;

function content(overrides: Partial<ProjectionContent> = {}): ProjectionContent {
  return {
    description: 'A bright vinaigrette',
    ingredients: [
      { kind: 'item', name: 'Olive oil', quantity: { amount: 1, unit: 'cup' }, note: 'good stuff' },
      { kind: 'recipe', recipeId: null, quantity: { amount: 1, unit: 'qt' } },
    ],
    steps: ['Whisk everything.', 'Season to taste.'],
    ...overrides,
  } as ProjectionContent;
}

describe('translatableProjection', () => {
  it('projects item names and notes, and nulls sub-recipe names', () => {
    const projection = translatableProjection('House Vinaigrette', content());
    expect(projection).toEqual({
      name: 'House Vinaigrette',
      description: 'A bright vinaigrette',
      ingredients: [
        { name: 'Olive oil', note: 'good stuff' },
        { name: null, note: null },
      ],
      steps: ['Whisk everything.', 'Season to taste.'],
    });
  });

  it('ignores quantities — a scaling change alone must not invalidate a translation', () => {
    const a = translatableProjection('R', content());
    const scaled = content();
    scaled.ingredients[0].quantity = { amount: 99, unit: 'gal' };
    const b = translatableProjection('R', scaled);
    expect(sourceHashOf(a)).toBe(sourceHashOf(b));
  });
});

describe('sourceHashOf', () => {
  it('changes when the head name changes — a rename reaches staff without a new version', () => {
    const a = sourceHashOf(translatableProjection('Old Name', content()));
    const b = sourceHashOf(translatableProjection('New Name', content()));
    expect(a).not.toBe(b);
  });

  it('changes when a step changes', () => {
    const a = sourceHashOf(translatableProjection('R', content()));
    const b = sourceHashOf(
      translatableProjection('R', content({ steps: ['Whisk everything.', 'Chill overnight.'] })),
    );
    expect(a).not.toBe(b);
  });
});

describe('sanitizePayload', () => {
  const projection = translatableProjection('House Vinaigrette', content());

  const goodRaw = {
    name: 'Vinagreta de la casa',
    description: 'Una vinagreta fresca',
    ingredients: [
      { name: 'Aceite de oliva', note: 'del bueno' },
      { name: null, note: null },
    ],
    steps: ['Bate todo.', 'Sazona al gusto.'],
  };

  it('passes aligned output through', () => {
    const payload = sanitizePayload(goodRaw, projection);
    expect(payload.name).toBe('Vinagreta de la casa');
    expect(payload.ingredients).toHaveLength(2);
    expect(payload.steps).toEqual(['Bate todo.', 'Sazona al gusto.']);
  });

  it('rejects an ingredient-count mismatch — a misaligned translation captions the wrong line', () => {
    const raw = { ...goodRaw, ingredients: goodRaw.ingredients.slice(0, 1) };
    expect(() => sanitizePayload(raw, projection)).toThrowError(AppError);
    try {
      sanitizePayload(raw, projection);
    } catch (err) {
      expect((err as AppError).statusCode).toBe(502);
    }
  });

  it('rejects a step-count mismatch', () => {
    const raw = { ...goodRaw, steps: [...goodRaw.steps, 'Un paso inventado.'] };
    expect(() => sanitizePayload(raw, projection)).toThrowError(AppError);
  });

  it('pins sub-recipe names to null even when the model invents one', () => {
    const raw = {
      ...goodRaw,
      ingredients: [goodRaw.ingredients[0], { name: 'Salsa madre', note: 'nota inventada' }],
    };
    const payload = sanitizePayload(raw, projection);
    // Name AND note stay null: the source line had neither, and the model
    // must never add text the source does not have.
    expect(payload.ingredients[1]).toEqual({ name: null, note: null });
  });

  it('rejects an empty translated name or step', () => {
    expect(() => sanitizePayload({ ...goodRaw, name: '   ' }, projection)).toThrowError(AppError);
    expect(() =>
      sanitizePayload({ ...goodRaw, steps: ['Bate todo.', '   '] }, projection),
    ).toThrowError(AppError);
  });

  it('clamps overlong fields to their storage ceilings', () => {
    const raw = {
      ...goodRaw,
      name: 'x'.repeat(500),
      ingredients: [
        { name: 'y'.repeat(500), note: 'z'.repeat(900) },
        { name: null, note: null },
      ],
    };
    const payload = sanitizePayload(raw, projection);
    expect(payload.name).toHaveLength(160);
    expect(payload.ingredients[0].name).toHaveLength(160);
    expect(payload.ingredients[0].note).toHaveLength(400);
  });
});
