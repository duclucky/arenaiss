import { describe, expect, it } from 'vitest';
import { displayLabel } from '../display-label';

describe('displayLabel', () => {
  it('replaces every underscore in a user-facing code with a space', () => {
    expect(displayLabel('ARC_OPERATOR')).toBe('ARC OPERATOR');
    expect(displayLabel('GENLAYER_NO_CONSENSUS')).toBe('GENLAYER NO CONSENSUS');
  });

  it('leaves labels without underscores unchanged', () => {
    expect(displayLabel('FINALIZED')).toBe('FINALIZED');
  });
});
