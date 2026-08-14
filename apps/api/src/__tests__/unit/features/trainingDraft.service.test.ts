import { describe, it, expect } from 'vitest';
import { shapeTrainingProposal } from '../../../features/drafting/trainingDraft.service';

/**
 * `shapeTrainingProposal` is the seam between raw model output and something
 * the create-training schema will accept: ceilings clamped, empty sections
 * dropped, the block count bounded.
 */

type RawTraining = Parameters<typeof shapeTrainingProposal>[0];

function raw(overrides: Partial<RawTraining> = {}): RawTraining {
  return {
    title: 'Opening the Line',
    description: 'Daily line setup, from walk-in to first ticket.',
    sections: [
      'Clock in and wash hands before touching any station.',
      'Check the walk-in log. Any unit above 41F goes to the manager immediately.',
    ],
    notes: null,
    ...overrides,
  };
}

describe('shapeTrainingProposal', () => {
  it('passes clean output through', () => {
    const proposal = shapeTrainingProposal(raw());
    expect(proposal.title).toBe('Opening the Line');
    expect(proposal.sections).toHaveLength(2);
    expect(proposal.notes).toBeNull();
  });

  it('drops empty sections rather than creating unpublishable blocks', () => {
    const proposal = shapeTrainingProposal(raw({ sections: ['  ', 'Real content.', ''] }));
    expect(proposal.sections).toEqual(['Real content.']);
  });

  it('clamps the title to the schema ceiling and never returns an empty one', () => {
    expect(shapeTrainingProposal(raw({ title: 'x'.repeat(500) })).title).toHaveLength(140);
    expect(shapeTrainingProposal(raw({ title: '   ' })).title).toBe('Untitled training');
  });

  it('caps the section count at the block ceiling', () => {
    const proposal = shapeTrainingProposal(
      raw({ sections: Array.from({ length: 60 }, (_, i) => `Section ${i}`) }),
    );
    expect(proposal.sections).toHaveLength(50);
  });

  it('clamps description and notes', () => {
    const proposal = shapeTrainingProposal(
      raw({ description: 'y'.repeat(1000), notes: 'z'.repeat(5000) }),
    );
    expect(proposal.description).toHaveLength(500);
    expect(proposal.notes).toHaveLength(2000);
  });
});
