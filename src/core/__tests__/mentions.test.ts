import { describe, expect, it } from 'vitest';
import type { Draft } from '../world/drafts';
import { brief, entryTip, findMentions } from '../world/mentions';
import { segments } from '../lens';
import type { PovState } from '../world/types';

const d = (id: string, kind: Draft['kind'], name: string, fields: Record<string, unknown> = {}): Draft => ({ id, kind, name, fields, existing: true });

describe('findMentions', () => {
  const lib = [
    d('mara', 'character', 'Mara Voss', { summary: 'A smuggler.' }),
    d('port', 'location', 'Port Ash'),
    d('guard', 'organization', 'Port Ash Guard'),
    d('hollow', 'location', 'The Hollow', { keys: ['the dip', 'Low Town'] }),
    d('ann1', 'character', 'Ann Reed'),
    d('ann2', 'character', 'Ann Stone'),
  ];

  it('links each entry once, at its first naming, by first name too', () => {
    const text = 'Mara waits. Later Mara Voss leaves Port Ash.';
    const m = findMentions(text, lib);
    expect(m.map((x) => [x.id, text.slice(x.start, x.end)])).toEqual([['mara', 'Mara'], ['port', 'Port Ash']]);
  });

  it('prefers the longer name where names overlap', () => {
    const text = 'The Port Ash Guard came down from Port Ash.';
    const m = findMentions(text, lib);
    expect(m.map((x) => text.slice(x.start, x.end))).toEqual(['Port Ash Guard', 'Port Ash']);
  });

  it('matches whole words, as written, and drops ambiguous first names', () => {
    expect(findMentions('the hollow of her throat', lib)).toEqual([]);
    expect(findMentions('Hollowed out, Marat sat.', lib)).toEqual([]);
    expect(findMentions('Ann nodded.', lib)).toEqual([]);
    expect(findMentions('Hollow eyes. Then the Hollow.', lib).map((x) => x.id)).toEqual(['hollow']);
    const text = 'Down in Low Town, Ann Stone nodded.';
    expect(findMentions(text, lib).map((x) => x.id)).toEqual(['hollow', 'ann2']);
  });

  it('weaves links around Lens points', () => {
    const text = 'Mara lifts the iron key.';
    const segs = segments(text, [{ name: 'Key', kind: 'thing', span: 'iron key', blurb: '', ref: '' }], findMentions(text, lib));
    expect(segs).toEqual([{ text: 'Mara', link: 'mara' }, { text: ' lifts the ' }, { text: 'iron key', point: 0 }, { text: '.' }]);
  });
});

describe('entryTip', () => {
  it('shows what the entry says openly, never its secrets', () => {
    const t = entryTip(d('mara', 'character', 'Mara Voss', { summary: 'A smuggler who owes everyone.', occupation: 'Smuggler', faction: 'Tide Runners', factionRole: 'captain', home: 'Port Ash', secrets: 'She sold the harbour plans.' }));
    expect(t.kind).toBe('Character · Smuggler');
    expect(t.facts).toEqual([{ label: 'Faction', value: 'Tide Runners, captain' }, { label: 'Home', value: 'Port Ash' }]);
    expect(JSON.stringify(t)).not.toContain('harbour');
  });

  it('says what the player has to do with it', () => {
    const pov = { relations: { 'mara voss': { attitude: -2, note: 'You cheated her' } }, inventory: [{ name: 'Brass Key', qty: 2 }] } as unknown as PovState;
    expect(entryTip(d('mara', 'character', 'Mara Voss'), { pov }).yours).toEqual(['Toward you: unfriendly. You cheated her']);
    expect(entryTip(d('key', 'item', 'Brass Key', { value: 5 }), { pov, currency: 'crowns' })).toMatchObject({ yours: ['You carry 2 of these'], facts: [{ label: 'Value', value: '5 crowns' }] });
  });

  it('keeps it brief', () => {
    const long = `${'A long first sentence that goes on and on. '.repeat(10)}`;
    expect(brief(long).length).toBeLessThanOrEqual(240);
    expect(brief(long).endsWith('.')).toBe(true);
  });
});
