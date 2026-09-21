import { describe, expect, it } from 'vitest';
import { indexBeats, pathTo, siblingPosition, stepSibling, leafOf, descendants, manuscriptText } from '../beatTree';
import { beat } from './fixtures';

const beats = [
  beat({ id: 'b1', parentId: null, text: 'one' }),
  beat({ id: 'b2', parentId: 'b1', text: 'two-a' }),
  beat({ id: 'b3', parentId: 'b1', text: 'two-b' }),
  beat({ id: 'b4', parentId: 'b3', text: 'three', role: 'instruction' }),
  beat({ id: 'b5', parentId: 'b4', text: 'four' }),
];

describe('beat tree', () => {
  const idx = indexBeats(beats);
  it('builds root-to-node paths', () => {
    expect(pathTo(idx, 'b5').map((b) => b.id)).toEqual(['b1', 'b3', 'b4', 'b5']);
    expect(pathTo(idx, 'nope')).toEqual([]);
  });
  it('reports sibling position and steps with wrap', () => {
    expect(siblingPosition(idx, 'b3')).toEqual({ at: 2, of: 2 });
    expect(stepSibling(idx, 'b3', 1)?.id).toBe('b2');
    expect(stepSibling(idx, 'b2', -1)?.id).toBe('b3');
    expect(stepSibling(idx, 'b1', 1)).toBeNull();
  });
  it('finds the newest leaf and descendants', () => {
    expect(leafOf(idx, 'b1').id).toBe('b5');
    expect(descendants(idx, 'b3').map((b) => b.id).sort()).toEqual(['b4', 'b5']);
  });
  it('renders only prose in the manuscript', () => {
    expect(manuscriptText(pathTo(idx, 'b5'))).toBe('one\n\ntwo-b\n\nfour');
  });
});
