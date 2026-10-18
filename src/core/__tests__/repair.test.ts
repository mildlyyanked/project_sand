import { describe, expect, it } from 'vitest';
import { misfiledBeats } from '../repair';

describe('misfiled passages', () => {
  it('sends a passage saved into the wrong story back to the story its tree starts in, with what was written under it', () => {
    const rows = [
      { id: 'a1', parent_id: null, session_id: 'A' },
      { id: 'a2', parent_id: 'a1', session_id: 'A' },
      { id: 'b1', parent_id: null, session_id: 'B' },
      { id: 'b2', parent_id: 'b1', session_id: 'B' },
      // A's passage finished while B was open, and B wrote on under it.
      { id: 'x', parent_id: 'a2', session_id: 'B' },
      { id: 'y', parent_id: 'x', session_id: 'B' },
    ];
    expect(misfiledBeats(rows)).toEqual([
      { id: 'x', owner: 'A', parentId: 'a2', top: true },
      { id: 'y', owner: 'A', parentId: 'x', top: false },
    ]);
  });
  it('leaves healthy stories alone, and treats a passage whose parent is gone as a root', () => {
    expect(misfiledBeats([{ id: 'a1', parent_id: null, session_id: 'A' }, { id: 'a2', parent_id: 'gone', session_id: 'A' }, { id: 'a3', parent_id: 'a2', session_id: 'A' }])).toEqual([]);
  });
});
