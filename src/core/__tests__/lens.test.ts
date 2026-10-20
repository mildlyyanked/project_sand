import { describe, expect, it } from 'vitest';
import { cardPrompt, parseCard, parseGuess, parseScan, renderPins, scanPrompt, segments } from '../lens';
import { assembleContext } from '../context/assemble';
import { beat, session } from './fixtures';

const passage = 'The iron key hung from Mara\'s belt. Across the dock, a gull worried at a fish head while the harbourmaster watched the iron gate.';

describe('lens scan', () => {
  it('keeps points whose words are really in the passage, and finds them by name when the span drifts', () => {
    const pts = parseScan(JSON.stringify({ points: [
      { name: 'The iron key', kind: 'thing', span: 'iron key', blurb: 'Old and warm.', ref: '' },
      { name: 'Harbourmaster', kind: 'npc', span: 'the harbour master', blurb: 'Watching.', ref: '' },
      { name: 'Ghost ship', kind: 'place', span: 'the ghost ship', blurb: 'Not here.' },
      { name: 'The iron key', kind: 'thing', span: 'iron key' },
    ] }), passage);
    expect(pts.map((p) => [p.name, p.kind, p.span])).toEqual([['The iron key', 'thing', 'iron key'], ['Harbourmaster', 'person', 'harbourmaster'], ['Ghost ship', 'place', '']]);
  });
  it('limits what it sees in play to what the character can perceive', () => {
    expect(scanPrompt({ passage, known: [], pov: { name: 'Mara' } })[0]!.content).toContain('Only what Mara could perceive');
    expect(scanPrompt({ passage, known: [] })[0]!.content).not.toContain('perceive');
  });
});

describe('highlights', () => {
  it('marks the first appearance of each, longest first, never overlapping', () => {
    const segs = segments(passage, [{ name: 'Key', kind: 'thing', span: 'key', blurb: '', ref: '' }, { name: 'Iron key', kind: 'thing', span: 'iron key', blurb: '', ref: '' }, { name: 'Gate', kind: 'thing', span: 'iron gate', blurb: '', ref: '' }]);
    const marked = segs.filter((s) => s.point != null).map((s) => [s.text, s.point]);
    expect(marked).toEqual([['iron key', 1], ['iron gate', 2]]);
    expect(segs.map((s) => s.text).join('')).toBe(passage);
  });
});

describe('cards and theories', () => {
  it('reads a card, with a clue only when it names a thread', () => {
    const c = parseCard('{"text":"A heavy key, warm from her hip.","facts":["Cut for a lock older than the dock"],"unknown":"What it opens.","closer":[{"name":"The bow","kind":"detail","blurb":"Worn smooth."}],"clue":{"text":"A guild tithe-mark scratched on the bow","thread":"The Fog Tithe"}}')!;
    expect(c.closer[0]).toMatchObject({ name: 'The bow', kind: 'detail' });
    expect(c.clue).toEqual({ text: 'A guild tithe-mark scratched on the bow', thread: 'The Fog Tithe' });
    expect(parseCard('{"text":"x","clue":{"text":"y"}}')!.clue).toBeNull();
    expect(cardPrompt({ point: { name: 'Key', kind: 'thing', span: 'key', blurb: '', ref: '' }, trail: [], passage, knowledge: '', history: '', pov: { name: 'Mara', sheet: 's' }, threads: '- The Fog Tithe' })[0]!.content).toContain('leave a trace');
    expect(parseGuess('{"thread":"The Fog Tithe","verdict":"HIT","nudge":"The marks are the guild\'s."}')).toEqual({ thread: 'The Fog Tithe', verdict: 'hit', nudge: "The marks are the guild's." });
  });
  it('pinned details reach the writer in either mode, and nothing does until something is pinned', () => {
    const base = { path: [beat({ id: 'b1', parentId: null, text: passage })], style: null, characters: [], species: [], universe: null, lore: [], model: 'x' };
    const pins = [{ id: 'p1', name: 'The iron key', text: 'It opens the customs vault.', beatId: 'b1' }];
    expect(renderPins(pins)).toContain('- The iron key: It opens the customs vault.');
    const withPins = assembleContext({ ...base, session: session({ world: { continuity: false, chronicle: false, pins } }) });
    expect(withPins.layers.find((l) => l.key === 'pins')!.text).toContain('customs vault');
    const plain = assembleContext({ ...base, session: session() });
    expect(plain.layers.some((l) => l.key === 'pins')).toBe(false);
  });
});
