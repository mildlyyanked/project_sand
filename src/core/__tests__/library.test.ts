import { describe, expect, it } from 'vitest';
import type { Character, Species, Universe } from '../types';
import type { WorldEntity } from '../world/types';
import { foldLegacy, upgradeCharacter, upgradeEntity, upgradeSpecies, upgradeWorld } from '../world/upgrade';
import { connectionsOf, edges, groupConnections, guessTie, neighbourhood, parseTies, sameTie, tieLines, tiesFromText, type StoredLink } from '../world/links';
import { characterDraft, draftCard, entityDraft, hooks, libraryDrafts, planDrafts, type Draft, type Library } from '../world/drafts';
import { entryShape, forgeShape, parseForgeDrafts } from '../world/forge';
import { changeDrafts, coverage, dayOf, parseAgentReply, parseQuestion, worldOfTheDay, agentPrompt } from '../world/agent';
import { finishForge, proposalCount, type Job } from '../jobs';
import { bibleOf } from '../world/schema';
import { DEFAULT_CALENDAR } from '../world/calendar';

const ent = (id: string, kind: WorldEntity['kind'], name: string, data: Record<string, unknown> = {}, parentId: string | null = null): WorldEntity => ({ id, universeId: 'u', kind, name, parentId, summary: '', keys: [], data, createdAt: 0, updatedAt: 0 });
const person = (id: string, name: string, p: Partial<Character> = {}): Character => ({ id, universeId: 'u', speciesId: null, name, lifeStage: '', adult: true, summary: '', voice: '', tells: '', relationships: '', limits: '', preferences: '', data: {}, createdAt: 0, updatedAt: 0, ...p });
const world: Universe = { id: 'u', name: 'Vell', description: 'A drowned city.', isDefault: false, data: { genre: 'drowned fantasy', rules: '', society: '', themes: '', currency: 'crowns', calendar: DEFAULT_CALENDAR }, createdAt: 0, updatedAt: 0 };

describe('upgrading the library', () => {
  it('folds a place\'s old fields into description and life, word for word', () => {
    const e = ent('p', 'location', 'The Gull', { description: 'A tavern on stilts.', atmosphere: 'Damp and loud.', climate: 'Fog most days', features: 'A trapdoor to the water.', travel: 'By skiff', population: 'Dockhands', services: 'Ale, beds', resources: 'Rainwater', danger: 2 });
    const r = upgradeEntity(e, []);
    expect(r.changed).toBe(true);
    expect(r.row.data.description).toBe('A tavern on stilts.\n\nDamp and loud.\n\nClimate and terrain: Fog most days\n\nNotable features: A trapdoor to the water.\n\nGetting there: By skiff');
    expect(r.row.data.life).toBe('Dockhands\n\nTrade and services: Ale, beds\n\nTo be found: Rainwater');
    expect(r.row.data.danger).toBe(2);
    for (const k of ['atmosphere', 'climate', 'features', 'travel', 'population', 'services', 'resources']) expect(k in r.row.data).toBe(false);
    expect(upgradeEntity(r.row, []).changed).toBe(false);
  });

  it('reads a faction\'s allies and enemies into typed ties, keeping what names nobody', () => {
    const guild = ent('g', 'organization', 'Salt Guild', { goals: 'Own the tides.', methods: 'Bribes', allies: 'The Tidewardens, since the flood.', enemies: 'Smugglers of every stripe.' });
    const r = upgradeEntity(guild, [{ id: 't', name: 'The Tidewardens' }, { id: 'g', name: 'Salt Guild' }]);
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toMatchObject({ from: 'g', to: 't', type: 'ally' });
    expect(r.links[0]!.note).toContain('since the flood');
    expect(r.row.data.aims).toContain('Own the tides.');
    expect(r.row.data.aims).toContain('Methods: Bribes');
    expect(r.row.data.aims).toContain('Enemies: Smugglers of every stripe.');
    expect(r.row.data.aims).not.toContain('Allies:');
  });

  it('turns a character\'s goals, fears and tells into wants and personality, and their relationships into ties', () => {
    const c = person('m', 'Mara Voss', { tells: 'Taps her teeth.', relationships: 'Tomas Voss is her younger brother. She hates Ilse Dray. Owes money to a fence called Pike.', data: { personality: 'Wry.', goals: 'A ship of her own', fears: 'Deep water' } as Character['data'] });
    const r = upgradeCharacter(c, [{ id: 't', name: 'Tomas Voss' }, { id: 'i', name: 'Ilse Dray' }]);
    expect(r.row.data.drives).toBe('Wants: A ship of her own\n\nFears: Deep water');
    expect(r.row.data.personality).toBe('Wry.\n\nTells: Taps her teeth.');
    expect(r.row.tells).toBe('');
    expect(r.row.relationships).toBe('Owes money to a fence called Pike.');
    expect(r.links.map((l) => [l.to, l.type])).toEqual([['t', 'family'], ['i', 'enemy']]);
  });

  it('folds species notes and traits, and the world\'s loose art lines into one style bible', () => {
    const s: Species = { id: 's', universeId: 'u', name: 'Selkin', adulthood: 'After the first moult', notes: 'Sing at dusk.', data: { traits: 'Patient', abilities: 'Breathe water', culture: 'Clan pools.' } };
    const r = upgradeSpecies(s, []);
    expect(r.row.data.nature).toBe('Patient\n\nGifts: Breathe water');
    expect(r.row.data.culture).toBe('Clan pools.\n\nSing at dusk.');
    expect(r.row.notes).toBe('');
    const w = upgradeWorld({ ...world, data: { ...world.data, tone: 'Melancholy', technology: 'Clockwork', artStyle: 'Ink and wash', sigilStyle: 'Woodcut', portraitStyle: 'Bust, rim light', rules: 'Tides obey the bells.' } });
    expect(w.row.data.genre).toBe('drowned fantasy. Tone: Melancholy');
    expect(w.row.data.rules).toBe('Tides obey the bells.\n\nTechnology: Clockwork');
    expect(w.row.data.art).toEqual({ look: 'Ink and wash', sigils: 'Woodcut', portraits: 'Bust, rim light' });
    expect('artStyle' in w.row.data).toBe(false);
    expect(upgradeWorld(w.row).changed).toBe(false);
  });

  it('folds a forge reply in the old shape too', () => {
    expect(foldLegacy('item', { name: 'Bell', properties: 'Calls the tide', origin: 'Cast in the flood' }).data).toMatchObject({ powers: 'Calls the tide', history: 'Cast in the flood' });
    const [d] = parseForgeDrafts('character', '{"characters":[{"name":"Odo","goals":"Revenge","fears":"Fire","tells":"Whistles"}]}')!;
    expect(d!.fields.drives).toBe('Wants: Revenge\n\nFears: Fire');
    expect(d!.fields.personality).toBe('Tells: Whistles');
  });
});

describe('links', () => {
  const lib = {
    entities: [ent('city', 'location', 'Vell'), ent('gull', 'location', 'The Gull', { controlledBy: 'guild' }, 'city'), ent('guild', 'organization', 'Salt Guild', { leader: 'mara', headquarters: 'gull' }), ent('bell', 'item', 'Drowned Bell', { owner: 'tomas', location: 'gull' })],
    characters: [person('mara', 'Mara', { data: { homeLocationId: 'gull', memberships: [{ orgId: 'guild', role: 'leader' }] } }), person('tomas', 'Tomas', { data: { memberships: [{ orgId: 'guild', role: 'oarsman' }] } })],
    species: [] as Species[],
  };
  const stored: StoredLink[] = [{ id: 'l1', universeId: 'u', from: 'mara', to: 'tomas', type: 'family', note: 'her brother', createdAt: 0 }, { id: 'l2', universeId: 'u', from: 'mara', to: 'gone', type: 'enemy', note: '', createdAt: 0 }];
  const g = edges(lib, stored);

  it('derive the hierarchy and roles from fields, and drop stored ties to missing entries', () => {
    const types = g.map((e) => `${e.from}>${e.type}>${e.to}`);
    expect(types).toEqual(expect.arrayContaining(['gull>within>city', 'guild>controls>gull', 'guild>seat>gull', 'mara>leads>guild', 'tomas>holds>bell', 'bell>kept>gull', 'mara>home>gull', 'tomas>member>guild', 'mara>family>tomas']));
    // The leader is not also listed as a plain member.
    expect(types).not.toContain('mara>member>guild');
    expect(types.some((x) => x.includes('gone'))).toBe(false);
  });

  it('read from either side, grouped', () => {
    const gull = groupConnections(connectionsOf('gull', g)).map((x) => x.label);
    expect(gull).toEqual(['Inside', 'Home of', 'Seat of', 'Controlled by', 'Keeps']);
    expect(connectionsOf('tomas', g).find((c) => c.other === 'mara')).toMatchObject({ label: 'Family', note: 'her brother' });
    expect([...neighbourhood('gull', g)].sort()).toEqual(['bell', 'city', 'guild', 'mara']);
    expect(tieLines('tomas', g, (id) => ({ mara: 'Mara' } as Record<string, string>)[id])).toEqual(['Family: Mara (her brother)']);
  });

  it('match the same tie either way when it is symmetric', () => {
    expect(sameTie({ from: 'a', to: 'b', type: 'ally' }, { from: 'b', to: 'a', type: 'ally' })).toBe(true);
    expect(sameTie({ from: 'a', to: 'b', type: 'mentor' }, { from: 'b', to: 'a', type: 'mentor' })).toBe(false);
    expect(guessTie('She serves him faithfully')).toBe('serves');
    expect(parseTies([{ to: 'Mara', type: 'sister', note: 'older' }, { to: '' }, { to: 'Pike', type: 'enemy' }])).toEqual([{ to: 'Mara', type: 'family', note: 'older' }, { to: 'Pike', type: 'enemy', note: '' }]);
    expect(tiesFromText('Mara trained him. Nobody else matters.', [{ id: 'm', name: 'Mara' }], { from: 'x', universeId: 'u' })[0]).toMatchObject({ to: 'm', type: 'mentor' });
  });
});

describe('ties through drafts and plans', () => {
  const lib: Library = { universe: world, entities: [ent('guild', 'organization', 'Salt Guild')], characters: [person('mara', 'Mara Voss')], species: [], lore: [], links: [{ id: 'l', universeId: 'u', from: 'guild', to: 'mara', type: 'enemy', note: 'she burned a ledger', createdAt: 0 }] };

  it('drafts carry their ties by name, and cards show them', () => {
    const d = characterDraft(lib.characters[0]!, lib);
    expect(d.fields.ties).toEqual([{ to: 'Salt Guild', type: 'enemy', note: 'she burned a ledger' }]);
    expect(draftCard(d)).toContain('Ties: Enemy Salt Guild (she burned a ledger)');
    expect(entityDraft(lib.entities[0]!, lib).fields.ties).toEqual([{ to: 'Mara Voss', type: 'enemy', note: 'she burned a ledger' }]);
  });

  it('plans resolve forged ties to new and old entries; ties to strangers stay as words', () => {
    const drafts: Draft[] = [
      { id: 'n1', kind: 'character', name: 'Tomas Voss', fields: { summary: 'An oarsman.', ties: [{ to: 'Mara Voss', type: 'family', note: 'her brother' }, { to: 'Pike', type: 'rival', note: 'over a girl' }] } },
      { id: 'n2', kind: 'organization', name: 'Tidewardens', fields: { ties: [{ to: 'Salt Guild', type: 'rival', note: '' }, { to: 'Tomas Voss', type: 'enemy', note: '' }] } },
    ];
    const plan = planDrafts(drafts, lib, 'u');
    expect(plan.links.map((l) => `${l.from}>${l.type}>${l.to}`)).toEqual(['n1>family>mara', 'n2>rival>guild', 'n2>enemy>n1']);
    expect(plan.characters.find((c) => c.id === 'n1')!.relationships).toBe('Rival Pike: over a girl.');
  });

  it('an edit that leaves a field out keeps it', () => {
    const c = person('mara', 'Mara Voss', { summary: 'A smuggler.', voice: 'Dry.', limits: 'No children.' });
    const plan = planDrafts([{ id: 'mara', kind: 'character', name: 'Mara Voss', existing: true, fields: { home: '' } }], { ...lib, characters: [c] }, 'u');
    expect(plan.characters[0]).toMatchObject({ summary: 'A smuggler.', voice: 'Dry.', limits: 'No children.' });
  });

  it('loose threads include ties to entries that do not exist', () => {
    const pool = [...libraryDrafts(lib), { id: 'z', kind: 'character' as const, name: 'Odo', fields: { faction: 'Salt Guild', ties: [{ to: 'The Hollow King', type: 'serves' as const, note: '' }] } }];
    expect(hooks(pool, 20)).toContain('Odo\'s serves The Hollow King is not in the library.');
  });
});

describe('forge shapes', () => {
  it('are built from the fields the editors show', () => {
    const place = entryShape('location');
    expect(place).toMatch(/^\{"name", "within": string/);
    expect(place).toContain('"life": string');
    expect(place).toContain('"ties": [{"to"');
    expect(place).not.toContain('atmosphere');
    expect(entryShape('character')).toContain('"drives": string');
    expect(entryShape('character')).not.toContain('lookalike');
    expect(entryShape('character')).toMatch(/"attributes": \{"might": 1-5/);
    expect(entryShape('lore')).toMatch(/^\{"title", "category": one of history/);
    expect(forgeShape('world')).toContain('"art": {"look": string');
  });

  it('parse ties and the world\'s bible', () => {
    const [w] = parseForgeDrafts('world', '{"name":"Vell","description":"x","genre":"y","art":{"look":"Ink","sigils":"Woodcut","bogus":"z"}}')!;
    expect(w!.fields.art).toEqual(bibleOf({ look: 'Ink', sigils: 'Woodcut' }));
    const [c] = parseForgeDrafts('character', '{"characters":[{"name":"Odo","ties":[{"to":"Mara","type":"friend","note":"old crew"}]}]}')!;
    expect(c!.fields.ties).toEqual([{ to: 'Mara', type: 'friend', note: 'old crew' }]);
  });
});

describe('the world agent', () => {
  const pool = libraryDrafts({ universe: world, entities: [ent('g', 'organization', 'Salt Guild'), ent('p', 'location', 'The Gull', { type: 'building' })], characters: [person('m', 'Mara Voss', { data: { appearance: 'Tall.' } })], species: [], lore: [] });

  it('reads coverage: counts, what is missing, what is thin', () => {
    const c = coverage(pool.filter((d) => d.kind !== 'world'));
    expect(c).toContain('Counts: 1 places, 1 factions, 1 characters, 0 peoples, 0 things, 0 lore.');
    expect(c).toContain('Nothing yet: things, lore.');
    expect(c).toMatch(/Thin entries: .*Salt Guild \(no description, aims and methods, leader, headquarters\)/);
  });

  it('splits a reply into what it says, what it proposes and the brief', () => {
    const text = 'The guild needs a rival. Who do they fear?\n\n```json\n{"brief": "Grim, wet, political.", "proposals": {"factions": [{"name": "Tidewardens", "summary": "Keepers of the bells."}]}, "changes": [{"entry": "Salt Guild", "field": "aims", "value": "Own every tide."}, {"entry": "Nobody", "field": "aims", "value": "x"}, {"entry": "The Gull", "field": "nonsense", "value": "x"}]}\n```';
    const r = parseAgentReply(text);
    expect(r.reply).toBe('The guild needs a rival. Who do they fear?');
    expect(r.brief).toBe('Grim, wet, political.');
    expect(r.drafts.map((d) => d.name)).toEqual(['Tidewardens']);
    const ch = changeDrafts(pool, r.changes);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ id: 'g', existing: true, fields: { aims: 'Own every tide.', _changed: ['aims'] } });
    expect(parseAgentReply('Just talk.')).toMatchObject({ reply: 'Just talk.', drafts: [], changes: [], brief: null });
  });

  it('asks with the world, the brief, the focus and the answer to today\'s question', () => {
    const msgs = agentPrompt({ world: 'Vell', knowledge: '# World: Vell', coverage: 'Counts: 1 places.', brief: 'Grim.', thread: [{ role: 'user', text: 'Hi', data: {} }, { role: 'agent', text: 'Hello', data: {} }], focus: pool.find((d) => d.name === 'Mara Voss'), intent: 'people in her life', message: 'Her brother.', answering: 'Who does Mara owe?' });
    expect(msgs[0]!.content).toContain('curious');
    expect(msgs[1]!.content).toContain('# The brief (what the writer wants)\nGrim.');
    expect(msgs[1]!.content).toContain('The writer wants: people in her life. Tie whatever you propose to Mara Voss.');
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(msgs[5]!.content).toContain('Today\'s question was: “Who does Mara owe?”');
  });

  it('parses today\'s question and picks a world for the day', () => {
    expect(parseQuestion('{"question": "Who rings the bells?", "why": "Opens the cult.", "about": "the bells"}')).toEqual({ question: 'Who rings the bells?', why: 'Opens the cult.', about: 'the bells' });
    expect(parseQuestion('Sure!\nWho rings the bells at low tide?')!.question).toBe('Who rings the bells at low tide?');
    expect(dayOf(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07');
    const worlds = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const days = ['2026-11-07', '2026-11-08', '2026-11-09'].map((d) => worldOfTheDay(worlds, d)!.id);
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(worldOfTheDay([], '2026-11-07')).toBeNull();
  });
});

describe('jobs', () => {
  it('finish a forge: tie to the anchor, never offer a name the world has', () => {
    const out = finishForge({ kind: 'character', model: 'm', messages: [], maxTokens: 1, anchor: { kind: 'organization', name: 'Salt Guild' }, taken: ['character:mara voss'] }, '{"characters":[{"name":"Mara Voss"},{"name":"Odo"}]}');
    expect(out.drafts.map((d) => d.name)).toEqual(['Odo']);
    expect(out.drafts[0]!.fields.faction).toBe('Salt Guild');
    expect(() => finishForge({ kind: 'character', model: 'm', messages: [], maxTokens: 1, taken: [] }, 'Sorry, I cannot.')).toThrow(/expected JSON/);
  });

  it('count what still waits on a decision', () => {
    const base = { id: 'j', universeId: 'u', title: 't', error: null, attempts: 0, progress: 0, createdAt: 0, updatedAt: 0 };
    const forge: Job = { ...base, kind: 'forge', status: 'done', input: {} as never, output: { drafts: [{ id: 'a', kind: 'lore', name: 'A', fields: {} }, { id: 'b', kind: 'lore', name: 'B', fields: {} }], truncated: false }, decisions: { a: 'accepted' } };
    expect(proposalCount(forge)).toBe(1);
    expect(proposalCount({ ...forge, decisions: { a: 'accepted', b: 'dismissed' } })).toBe(0);
    expect(proposalCount({ ...forge, status: 'running', output: null })).toBe(0);
    expect(proposalCount({ ...base, kind: 'bible', status: 'done', input: {} as never, output: { bible: { look: 'x' } }, decisions: {} })).toBe(1);
  });
});
