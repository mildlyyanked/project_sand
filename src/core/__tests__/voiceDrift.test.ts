import { describe, expect, it } from 'vitest';
import { voiceDrift } from '../voiceDrift';
import { style } from './fixtures';
import { parsePremises } from '../helpers';

describe('voiceDrift', () => {
  it('is quiet on clean prose and flags banned phrases', () => {
    expect(voiceDrift('Mara counted the crates.', style()).score).toBe(0);
    const r = voiceDrift('The scene was a rich tapestry of dread.', style());
    expect(r.score).toBeGreaterThan(0);
    expect(r.notes[0]).toContain('tapestry');
  });
  it('compares sentence length against samples', () => {
    const s = style({ samples: ['Short. Hard. Cold. She ran. He fell. The door shut. Nobody spoke. Rain came. ' .repeat(6)] });
    const r = voiceDrift('It was, in the slow and winding way of such evenings, a night on which nothing that could be said would be said, and everyone present knew it well enough to keep their own counsel for as long as the wine held out.', s);
    expect(r.notes.some((n) => n.includes('long'))).toBe(true);
  });
});

describe('parsePremises', () => {
  it('splits numbered premises', () => {
    const out = parsePremises('1. A courier finds the package is breathing. She has six hours.\n2) A city where names expire. He forgot to renew his and now cannot be seen.\n');
    expect(out.length).toBe(2);
    expect(out[1]).toMatch(/^A city/);
  });
});
