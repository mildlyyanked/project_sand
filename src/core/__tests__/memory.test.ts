import { describe, expect, it } from 'vitest';
import { chapterOrder, chapterText, freshEntries, keeperPrompt, mergePeople, parseKeeper, personKey, renderEntries, renderPeople, renderPreviously, type PersonMemory, type Recap } from '../world/memory';
import { composePicture, portraitDirectionPrompt } from '../world/forge';

const reply = JSON.stringify({
  recap: { summary: 'Mara smuggled the ledger out of the customs house. Tomas was caught.', ending: 'Mara hides in the net loft; Tomas is in the cells.', open: ['Tomas in the cells', 'Who sold them out?'] },
  people: [
    { name: 'Mara', now: 'Hiding in the net loft', knows: ['Odo Pell sold them out'], relations: [{ with: 'Odo Pell', stance: 'wants him dead' }], changes: ['burned left hand'] },
    { name: 'Sefa Quill', now: 'At the customs house', knows: [], relations: [{ with: 'Mara Voss', stance: 'owes her' }], changes: [] },
  ],
  newcomers: [{ name: 'Sefa Quill', kind: 'character', note: 'a customs clerk' }, { name: 'Mara Voss', kind: 'character', note: '' }, { name: 'The Net Loft', kind: 'location', note: 'a mender\'s loft' }],
});

describe('the memory keeper', () => {
  it('asks for a recap, people and newcomers, showing what was remembered before', () => {
    const before: PersonMemory[] = [{ key: 'mara', name: 'Mara Voss', libId: 'mara', now: 'At the Gull', knows: ['the ledger is in customs'], relations: [], changes: [], seen: ['c1'] }];
    const m = keeperPrompt({ world: 'World: Ash', instance: 'Prime', chapter: { title: 'Salt', number: 2, text: 'x' }, people: before, known: ['Mara Voss'], cast: ['Mara Voss'] });
    expect(m[0]!.content).toContain('"recap"');
    expect(m[1]!.content).toContain('Knows: the ledger is in customs');
    expect(m[1]!.content).toContain('# Chapter 2: Salt');
  });

  it('folds a chapter into memory: now moves on, knowledge and changes accumulate, relations replace', () => {
    const r = parseKeeper(reply)!;
    const before: PersonMemory[] = [{ key: 'mara', name: 'Mara Voss', libId: 'mara', now: 'At the Gull', knows: ['the ledger is in customs'], relations: [{ with: 'Odo Pell', stance: 'trusts him' }], changes: [], seen: ['c1'] }];
    const after = mergePeople(before, r.people, { sessionId: 'c2', library: [{ id: 'mara', name: 'Mara Voss' }] });
    const mara = after.find((p) => p.key === 'mara')!;
    expect(mara.now).toBe('Hiding in the net loft');
    expect(mara.knows).toEqual(['the ledger is in customs', 'Odo Pell sold them out']);
    expect(mara.relations).toEqual([{ with: 'Odo Pell', stance: 'wants him dead' }]);
    expect(mara.changes).toEqual(['burned left hand']);
    expect(mara.seen).toEqual(['c1', 'c2']);
    const sefa = after.find((p) => p.name === 'Sefa Quill')!;
    expect(sefa.key).toBe(personKey('Sefa Quill'));
    expect(parseKeeper('{"recap": {}}')).toBeNull();
  });

  it('keeps only newcomers that are new to the library and the instance', () => {
    const r = parseKeeper(reply)!;
    const fresh = freshEntries(r.newcomers, { known: ['Mara Voss'], entries: [{ key: 'n:net loft', kind: 'location', name: 'Net Loft', note: '', from: 'c1' }], sessionId: 'c2' });
    expect(fresh.map((e) => e.name)).toEqual(['Sefa Quill']);
  });
});

describe('reading memory back', () => {
  const recaps: Recap[] = [1, 2, 3].map((i) => ({ sessionId: `c${i}`, title: `Chapter ${i}`, summary: `Long summary of chapter ${i}. `.repeat(20), ending: `End of ${i}.`, open: [`thread ${i}`], upTo: null, at: i }));
  it('gives the latest chapter in full and older ones as far as budget allows', () => {
    const tight = renderPreviously(recaps, 260);
    expect(tight).toContain('Still open: thread 3');
    expect(tight).toContain('## Chapter 2\nEnd of 2.');
    expect(renderPreviously([], 500)).toBe('');
  });
  it('brings in the people and instance-only things the passage is about', () => {
    const people: PersonMemory[] = [{ key: 'mara', name: 'Mara Voss', now: 'Hiding', knows: ['a secret'], relations: [], changes: [], seen: [] }, { key: 'n:odo', name: 'Odo Pell', now: 'Gone', knows: [], relations: [], changes: [], seen: [] }];
    const out = renderPeople(people, [], 'Mara climbed the stair.', 500);
    expect(out).toContain('## Mara Voss');
    expect(out).not.toContain('Odo');
    expect(renderEntries([{ key: 'n:sefa quill', kind: 'character', name: 'Sefa Quill', note: 'a customs clerk', from: 'c1' }], ['Sefa Quill'], '', 200)).toContain('Sefa Quill (character): a customs clerk');
  });
  it('orders chapters by when they start, and trims long chapters for the keeper', () => {
    expect(chapterOrder([{ id: 'b', clockStart: 10, createdAt: 1 }, { id: 'a', clockStart: 0, createdAt: 2 }]).map((x) => x.id)).toEqual(['a', 'b']);
    const t = chapterText({ summary: 'Before.', prose: ['x'.repeat(100), 'y'.repeat(100)], maxChars: 50 });
    expect(t.startsWith('(Earlier in this chapter, in brief) Before.')).toBe(true);
    expect(t.endsWith('y'.repeat(50))).toBe(true);
  });
});

describe('portrait direction', () => {
  it('portraits follow the curated direction instead of the general framing', () => {
    expect(composePicture('character', 'A grey-eyed woman.', { art: 'Ink.', portrait: 'Oil on panel, bust, rim light' })).toBe('Oil on panel, bust, rim light. A grey-eyed woman. No text or lettering.');
    expect(composePicture('location', 'A harbour.', { art: 'Ink.', portrait: 'Oil' })).toMatch(/^Ink\./);
    expect(portraitDirectionPrompt({ world: 'World: Ash', art: 'Ink.', current: '', people: ['a tall smuggler'], wish: 'moodier' })[1]!.content).toContain('What the writer wants: moodier');
  });
});

describe('chapters in context', () => {
  it('puts what the instance remembers in front of the writer', async () => {
    const { assembleContext } = await import('../context/assemble');
    const { beat, session, universe } = await import('./fixtures');
    const ctx = assembleContext({
      path: [beat({ id: 'b1', parentId: null, text: 'Mara climbed the stair.' })], style: null, species: [], lore: [], model: 'x', characters: [], universe: universe(),
      session: session({ universeId: 'u1', instanceId: 'i1', world: { continuity: true, chronicle: true } }),
      world: { entities: [], instance: null, events: [], siblings: [], now: 0, scene: { locationId: null, locationName: '' }, player: null, memory: { previously: '# Previously, in this version of the world\n## Chapter 1', people: '# What this version of the world remembers of them\n## Mara Voss', entries: '' } },
    });
    const keys = ctx.layers.map((l) => l.key);
    expect(keys).toContain('previously');
    expect(keys).toContain('remembered');
    expect(keys).not.toContain('instance');
  });
});
