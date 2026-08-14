import { describe, it, expect } from 'vitest';
import { shapeProposal } from '../../../features/drafting/draft.service';

/**
 * `shapeProposal` is the seam between raw model output and something the
 * create-recipe schema will accept: ceilings clamped, junk quantities
 * flagged rather than silently invented, tag lists deduped.
 */

type RawRecipe = Parameters<typeof shapeProposal>[0];

function raw(overrides: Partial<RawRecipe> = {}): RawRecipe {
  return {
    name: 'Braised Short Ribs',
    description: 'Low and slow.',
    yield: { amount: 4, unit: 'qt' },
    ingredients: [
      { name: 'Short ribs', quantity: { amount: 5, unit: 'lb' }, note: null },
      { name: 'Salt', quantity: { amount: 2, unit: 'tbsp' }, note: 'kosher' },
    ],
    steps: ['Sear the ribs.', 'Braise at 325F for 3 hours.'],
    allergens: [],
    dietary: [],
    prepMinutes: 30,
    cookMinutes: 180,
    notes: null,
    ...overrides,
  };
}

describe('shapeProposal', () => {
  it('passes clean output through', () => {
    const proposal = shapeProposal(raw());
    expect(proposal.name).toBe('Braised Short Ribs');
    expect(proposal.ingredients).toHaveLength(2);
    expect(proposal.times).toEqual({ prepMinutes: 30, cookMinutes: 180 });
    expect(proposal.notes).toBeNull();
  });

  it('flags an unusable quantity instead of silently inventing one', () => {
    const proposal = shapeProposal(
      raw({
        ingredients: [{ name: 'Salt', quantity: { amount: 0, unit: 'tsp' }, note: 'to taste' }],
      }),
    );
    expect(proposal.ingredients[0].quantity.amount).toBe(1);
    expect(proposal.ingredients[0].note).toContain('[quantity unclear]');
    expect(proposal.ingredients[0].note).toContain('to taste');
  });

  it('surfaces an unclear yield in the proposal notes', () => {
    const proposal = shapeProposal(raw({ yield: { amount: -1, unit: 'qt' } }));
    expect(proposal.yield.amount).toBe(1);
    expect(proposal.notes).toContain('Yield quantity was unclear.');
  });

  it('drops nameless ingredient lines and empty steps', () => {
    const proposal = shapeProposal(
      raw({
        ingredients: [
          { name: '   ', quantity: { amount: 1, unit: 'each' }, note: null },
          { name: 'Onion', quantity: { amount: 1, unit: 'each' }, note: null },
        ],
        steps: ['  ', 'Dice the onion.'],
      }),
    );
    expect(proposal.ingredients).toHaveLength(1);
    expect(proposal.ingredients[0].name).toBe('Onion');
    expect(proposal.steps).toEqual(['Dice the onion.']);
  });

  it('clamps the name to the schema ceiling and never returns an empty one', () => {
    expect(shapeProposal(raw({ name: 'x'.repeat(500) })).name).toHaveLength(120);
    expect(shapeProposal(raw({ name: '   ' })).name).toBe('Untitled recipe');
  });

  it('dedupes transcribed tags', () => {
    const proposal = shapeProposal(
      raw({ allergens: ['milk', 'milk', 'wheat'], dietary: ['vegan', 'vegan'] }),
    );
    expect(proposal.allergens).toEqual(['milk', 'wheat']);
    expect(proposal.dietary).toEqual(['vegan']);
  });

  it('nulls unusable times rather than storing negatives', () => {
    expect(shapeProposal(raw({ prepMinutes: -5, cookMinutes: null })).times).toBeNull();
    expect(shapeProposal(raw({ prepMinutes: null, cookMinutes: 90 })).times).toEqual({
      prepMinutes: null,
      cookMinutes: 90,
    });
  });
});
