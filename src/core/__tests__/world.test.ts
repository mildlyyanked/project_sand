import { describe, expect, it } from 'vitest';
import { formatDuration, formatShort, formatTime, fromParts, parseDuration, timeOfDay, toParts } from '../world/calendar';
import { applyDelta, initialPov, parseEffects, parseInventory, passTime, renderPov, useItem } from '../world/survival';
import { attributeModifier, outcomeOf, renderCheck, rollCheck, statePenalty } from '../world/dice';
import { childrenOf, locationChain, mentions, resolveRefs, scanEntities } from '../world/scan';
import { renderSiblings, selectContinuity, renderContinuity } from '../world/continuity';
import { parseChronicle, parseRuling, chroniclePrompt } from '../world/chronicle';
import { renderEntity, worldTemplateEmpty } from '../world/render';
import { assembleContext } from '../context/assemble';
import type { WorldEntity, WorldEvent } from '../world/types';
import { beat, character, session, universe } from './fixtures';

const ent = (p: Partial<WorldEntity> & { id: string; name: string }): WorldEntity => ({ universeId: 'u1', kind: 'location', parentId: null, summary: '', keys: [], data: {}, createdAt: 0, updatedAt: 0, ...p });
const ev = (p: Partial<WorldEvent> & { id: string; at: number; title: string }): WorldEvent => ({ instanceId: 'i1', sessionId: null, beatId: null, kind: 'event', text: '', entities: [], importance: 1, createdAt: p.at, ...p });

describe('calendar', () => {
  it('formats gregorian and custom time', () => {
    expect(formatTime({ kind: 'gregorian', start: '2026-10-14T08:00', yearLabel: '', startYear: 1, daysPerYear: 365, monthNames: [], hoursPerDay: 24 }, 90)).toBe('Wed 14 Oct 2026, 09:30');
    const cal = { kind: 'custom' as const, start: '', yearLabel: 'AF', startYear: 312, daysPerYear: 360, monthNames: ['Thaw', 'Bloom', 'Ember', 'Frost'], hoursPerDay: 24 };
    expect(formatTime(cal, 0)).toBe('Year 312 AF, Thaw 1, 00:00');
    expect(formatTime(cal, 1440 * 95 + 75)).toBe('Year 312 AF, Bloom 6, 01:15');
    expect(formatTime(cal, 1440 * 360)).toBe('Year 313 AF, Thaw 1, 00:00');
    expect(formatTime({ ...cal, daysPerYear: 0 }, 1440 * 33 + 600)).toBe('Day 34, 10:00');
    expect(formatShort(cal, 0)).toBe('Thaw 1, 00:00');
  });
  it('parses the durations models write', () => {
    expect(parseDuration(25)).toBe(25);
    expect(parseDuration('20 minutes')).toBe(20);
    expect(parseDuration('3 days 4 hours')).toBe(3 * 1440 + 240);
    expect(parseDuration('2 weeks')).toBe(20160);
    expect(parseDuration('3 hours')).toBe(180);
    expect(parseDuration('an hour and a half')).toBe(90);
    expect(parseDuration('2 days')).toBe(2880);
    expect(parseDuration('a few minutes')).toBe(3);
    expect(parseDuration('40 seconds')).toBe(1);
    expect(parseDuration('nonsense')).toBe(0);
    expect(formatDuration(195)).toBe('3 h 15 min');
    expect(formatDuration(2900)).toBe('2 days');
  });
  it('names the time of day', () => {
    expect(timeOfDay(undefined, 0)).toBe('morning');
    expect(timeOfDay(undefined, 10 * 60)).toBe('evening');
    expect(timeOfDay(undefined, 14 * 60)).toBe('night');
  });
});

describe('survival', () => {
  it('reads inventories and effects as people write them', () => {
    expect(parseInventory('2 × waterskin\nrope\nration x3\n- 2 torches')).toEqual([{ name: 'waterskin', qty: 2 }, { name: 'rope', qty: 1 }, { name: 'ration', qty: 3 }, { name: 'torches', qty: 2 }]);
    expect(parseEffects('satiety +30, water +10, health -5')).toEqual({ satiety: 30, hydration: 10, health: -5 });
    expect(parseEffects('Restores 20 health')).toEqual({ health: 20 });
    expect(parseEffects({ food: 15 })).toEqual({ satiety: 15 });
  });
  it('lets hunger and thirst bite with time, not in story difficulty', () => {
    const s = initialPov({});
    expect(passTime(s, 600, 'story').state.resources).toEqual(s.resources);
    const t = passTime(s, 60 * 10, 'survival');
    expect(t.state.resources.hydration).toBe(30);
    expect(t.state.resources.satiety).toBe(50);
    const parched = passTime({ ...s, resources: { ...s.resources, hydration: 5 } }, 120, 'survival');
    expect(parched.state.resources.hydration).toBe(0);
    expect(parched.state.resources.health).toBeLessThan(100);
    expect(parched.notes.join(' ')).toMatch(/Water ran out/);
  });
  it('restores energy while resting', () => {
    const s = { ...initialPov({}), resources: { health: 80, energy: 10, satiety: 80, hydration: 80, morale: 50 } };
    const r = passTime(s, 360, 'survival', true).state.resources;
    expect(r.energy).toBe(94);
    expect(r.health).toBe(92);
  });
  it('applies deltas: items, conditions, objectives, relations, money', () => {
    const s = initialPov({ money: 10, inventory: '2 × ration' });
    const { state } = applyDelta(s, { resources: { health: -30 }, money: -4, gained: [{ name: 'Lantern', qty: 1 }], lost: [{ name: 'ration', qty: 1 }], conditionsAdded: ['sprained ankle'], objectivesAdded: ['Find the ferryman'], relations: [{ name: 'Ora', delta: 2, note: 'owes you' }] });
    expect(state.resources.health).toBe(70);
    expect(state.money).toBe(6);
    expect(state.inventory).toEqual([{ name: 'ration', qty: 1 }, { name: 'Lantern', qty: 1 }]);
    expect(state.conditions).toEqual(['sprained ankle']);
    const done = applyDelta(state, { objectivesDone: ['find the ferryman'], conditionsRemoved: ['ankle'] }).state;
    expect(done.objectives[0]!.done).toBe(true);
    expect(done.conditions).toEqual([]);
    expect(state.relations.Ora).toEqual({ attitude: 2, note: 'owes you' });
    const ate = useItem(state, 'ration', { satiety: 30 }).state;
    expect(ate.inventory.find((i) => i.name === 'ration')).toBeUndefined();
    expect(ate.resources.satiety).toBe(100);
  });
  it('falls when health reaches zero and says so to the writer', () => {
    const { state } = applyDelta(initialPov({}), { resources: { health: -100 } });
    expect(state.down).toBe(true);
    expect(renderPov(state, { name: 'Ora', currency: 'crowns', difficulty: 'hardcore' })).toMatch(/fallen/);
  });
});

describe('dice', () => {
  it('maps attributes and conditions to modifiers', () => {
    expect([1, 2, 3, 4, 5].map(attributeModifier)).toEqual([-2, 0, 2, 4, 6]);
    const hurt = { ...initialPov({}), resources: { health: 20, energy: 10, satiety: 50, hydration: 50, morale: 50 }, conditions: ['broken arm'] };
    expect(statePenalty(hurt)).toBe(-5);
  });
  it('bands outcomes and honours natural 1 and 20', () => {
    expect(outcomeOf(20, 5, 24)).toBe('crit-success');
    expect(outcomeOf(1, 30, 5)).toBe('crit-fail');
    expect(outcomeOf(10, 17, 12)).toBe('crit-success');
    expect(outcomeOf(10, 12, 12)).toBe('success');
    expect(outcomeOf(10, 9, 12)).toBe('partial');
    expect(outcomeOf(10, 6, 12)).toBe('fail');
  });
  it('rolls with the given generator and renders a ruling without numbers for the prose', () => {
    const c = rollCheck({ attribute: 'agility', difficulty: 12, score: 3, rng: () => 0.45, onFailure: 'the guard turns' });
    expect(c.roll).toBe(10);
    expect(c.total).toBe(12);
    expect(c.outcome).toBe('success');
    expect(renderCheck({ ...c, outcome: 'fail' })).toMatch(/FAILURE.*the guard turns.*do not mention dice/);
  });
});

describe('scan and refs', () => {
  const vell = ent({ id: 'L1', name: 'Vell', data: { type: 'city' } });
  const quarter = ent({ id: 'L2', name: 'Drowned Quarter', parentId: 'L1' });
  const market = ent({ id: 'L3', name: 'Tide Market', parentId: 'L2', keys: ['stalls'] });
  const guild = ent({ id: 'O1', name: 'Salvage Guild', kind: 'organization' });
  const all = [vell, quarter, market, guild];
  it('finds whole-word mentions and keys', () => {
    expect(mentions('She came to Vell at dusk.', 'Vell')).toBe(true);
    expect(mentions('Vellum and ink', 'Vell')).toBe(false);
    expect(scanEntities(all, 'The stalls were empty; the salvage guild had come.').map((e) => e.id)).toEqual(['L3', 'O1']);
  });
  it('builds place chains and lists children', () => {
    expect(locationChain('L3', all).map((e) => e.name)).toEqual(['Vell', 'Drowned Quarter', 'Tide Market']);
    expect(childrenOf('L1', all).map((e) => e.id)).toEqual(['L2']);
    expect(renderEntity(market, all, () => undefined)).toContain('Within: Vell › Drowned Quarter');
  });
  it('resolves names to elements, keeping unknown ones', () => {
    const refs = resolveRefs(['Mara', 'tide market', 'Someone New', 'Mara'], { characters: [character()], entities: all, species: [] });
    expect(refs).toEqual([{ kind: 'character', id: 'c1', name: 'Mara' }, { kind: 'location', id: 'L3', name: 'Tide Market' }, { kind: 'unknown', id: null, name: 'Someone New' }]);
  });
});

describe('continuity', () => {
  const events = [
    ev({ id: 'e1', at: 100, title: 'The flood', importance: 3 }),
    ev({ id: 'e2', at: 200, title: 'Mara loses her hand', kind: 'state', text: 'lost her left hand', entities: [{ kind: 'character', id: 'c1', name: 'Mara' }] }),
    ev({ id: 'e3', at: 250, title: 'A cart overturns' }),
    ev({ id: 'e4', at: 900, title: 'Mara is crowned', importance: 2, entities: [{ kind: 'character', id: 'c1', name: 'Mara' }] }),
    ev({ id: 'e5', at: 950, title: 'Something unrelated', importance: 1 }),
  ];
  it('keeps major and involved events, and established later events as constraints', () => {
    const c = selectContinuity(events, 500, { ids: new Set(['c1']), names: ['Mara'] }, 2000);
    expect(c.past.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(c.future.map((e) => e.id)).toEqual(['e4']);
    expect(c.states[0]!.name).toBe('Mara');
    const text = renderContinuity(c, { now: 500 });
    expect(text).toMatch(/Mara: lost her left hand/);
    expect(text).toMatch(/Established for later[\s\S]*Mara is crowned/);
  });
  it('marks the dead as dead', () => {
    const c = selectContinuity([...events, ev({ id: 'e6', at: 300, title: 'Mara dies', kind: 'death', text: 'drowned at the weir', entities: [{ kind: 'character', id: 'c1', name: 'Mara' }] })], 500, { ids: new Set(['c1']), names: ['Mara'] }, 2000);
    expect(renderContinuity(c, { now: 500 })).toMatch(/Mara died .*drowned at the weir. They cannot appear alive/);
  });
  it('lists sibling stories within budget, before or after now', () => {
    const t = renderSiblings([{ title: 'The Weir', mode: 'writer', clockStart: 0, clock: 300, summary: 'Mara drowns.', excerpt: '' }, { title: 'Crown', mode: 'pov', clockStart: 800, clock: 1000, summary: 'A coronation.', excerpt: '' }], 1000, undefined, 500);
    expect(t).toMatch(/Crown \(played\).*after now: do not contradict/);
    expect(t).toMatch(/The Weir.*\(before now\)/);
  });
});

describe('chronicle and referee', () => {
  it('parses a chronicle with player bookkeeping', () => {
    const r = parseChronicle('```json\n{"elapsed": "2 hours", "resting": false, "location": "Tide Market", "events": [{"title": "Ora strikes a deal", "text": "She buys passage.", "importance": 2, "kind": "event", "who": ["Ora"]}], "changes": [{"who": "Ora", "change": "owes the guild", "kind": "relation"}], "player": {"resources": {"health": -5, "satiety": "20"}, "money": -12, "gained": ["ferry token"], "lost": [{"name": "knife", "qty": 1}], "objectivesAdded": ["Reach the far shore"], "relations": [{"name": "Ferryman", "delta": 5}]}}\n```');
    expect(r?.minutes).toBe(120);
    expect(r?.locationName).toBe('Tide Market');
    expect(r?.events[0]).toMatchObject({ importance: 2, who: ['Ora'] });
    expect(r?.player?.resources).toEqual({ health: -5, satiety: 20 });
    expect(r?.player?.gained).toEqual([{ name: 'ferry token', qty: 1 }]);
    expect(r?.player?.relations?.[0]!.delta).toBe(2);
    expect(parseChronicle('{"elapsed": 5, "location": "unchanged"}')?.locationName).toBeNull();
  });
  it('parses a ruling or none', () => {
    expect(parseRuling('{"check": null}')).toBeNull();
    expect(parseRuling('{"check": {"attribute": "Wits", "difficulty": 30, "why": "dark", "success": "spot it", "failure": "miss it"}}')).toEqual({ attribute: 'wits', difficulty: 25, why: 'dark', onSuccess: 'spot it', onFailure: 'miss it' });
  });
  it('asks for player bookkeeping only in play', () => {
    expect(chroniclePrompt({ worldName: 'W', now: 'x', location: '', known: [], passage: 'p' })[0]!.content).not.toContain('"player"');
    expect(chroniclePrompt({ worldName: 'W', now: 'x', location: '', known: [], passage: 'p', pov: { name: 'Ora', sheet: 's', action: 'a', ruling: '' } })[0]!.content).toContain('"player"');
  });
});

describe('assembling with a world', () => {
  const path = [beat({ id: 'b1', parentId: null, text: 'They reached the Tide Market as the salvage guild arrived.' })];
  const vell = ent({ id: 'L1', name: 'Vell', data: { type: 'city', description: 'A drowned city.' } });
  const market = ent({ id: 'L3', name: 'Tide Market', parentId: 'L1', data: { atmosphere: 'brine and shouting' } });
  const guild = ent({ id: 'O1', name: 'Salvage Guild', kind: 'organization', data: { goals: 'Own the tides' } });
  const base = { path, style: null, species: [], lore: [], model: 'x' };
  it('adds nothing for the empty real world with continuity off (vanilla)', () => {
    const real = universe({ isDefault: true, name: 'The real world' });
    const plain = assembleContext({ ...base, session: session(), characters: [], universe: null });
    const withWorld = assembleContext({ ...base, session: session({ universeId: 'u1' }), characters: [], universe: real, world: { entities: [], instance: null, events: [], siblings: [], now: 0, scene: { locationId: null, locationName: '' }, player: null } });
    expect(withWorld.messages).toEqual(plain.messages);
  });
  it('brings in the place, the elements in scene, and continuity', () => {
    const s = session({ universeId: 'u1', world: { continuity: true, chronicle: true } });
    const ctx = assembleContext({ ...base, session: s, characters: [character({ data: { homeLocationId: 'L1' } })], universe: universe({ name: 'Vell world', data: { ...universe().data, genre: 'drowned fantasy' } }), world: { entities: [vell, market, guild], instance: null, events: [ev({ id: 'e1', at: 10, title: 'The flood', importance: 3 })], siblings: [{ title: 'Elsewhere', mode: 'writer', clockStart: 0, clock: 5, summary: 'Another tale.', excerpt: '' }], now: 60, scene: { locationId: 'L3', locationName: 'Tide Market' }, player: null } });
    const keys = ctx.layers.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['universe', 'place', 'elements', 'continuity', 'stories']));
    expect(ctx.layers.find((l) => l.key === 'universe')!.text).toContain('Genre: drowned fantasy');
    expect(ctx.layers.find((l) => l.key === 'place')!.text).toContain('Vell › Tide Market');
    expect(ctx.layers.find((l) => l.key === 'elements')!.text).toContain('## Salvage Guild');
    expect(ctx.layers.find((l) => l.key === 'characters')!.text).toContain('Home: Vell');
    expect(ctx.layers.find((l) => l.key === 'continuity')!.text).toContain('The flood');
  });
  it('plays: player sheet, ruling and the interactive contract', () => {
    const ora = character({ id: 'c2', name: 'Ora' });
    const s = session({ mode: 'pov', pov: { characterId: 'c2', difficulty: 'survival', checks: true, startLocationId: null } });
    const sheet = initialPov({ money: 3 });
    const check = rollCheck({ attribute: 'presence', difficulty: 14, score: 2, rng: () => 0, onFailure: 'they laugh' });
    const ctx = assembleContext({ ...base, session: s, characters: [ora], universe: null, world: { entities: [], instance: null, events: [], siblings: [], now: 0, scene: { locationId: null, locationName: '', pov: sheet }, player: ora, check } });
    expect(ctx.layers.find((l) => l.key === 'pov')!.text).toContain("Ora, the player's character");
    const post = ctx.layers.find((l) => l.key === 'post')!.text;
    expect(post).toMatch(/Never decide, speak, think or act for Ora/);
    expect(post).toMatch(/DISASTER.*they laugh/);
    expect(worldTemplateEmpty(universe())).toBe(true);
  });
});

describe('time fields', () => {
  it('round-trips gregorian and custom times', () => {
    const g = { kind: 'gregorian' as const, start: '2026-10-14T08:00', yearLabel: '', startYear: 1, daysPerYear: 365, monthNames: [], hoursPerDay: 24 };
    expect(toParts(g, 60 * 30)).toEqual({ date: '2026-10-15', day: 1, hour: 14, minute: 0 });
    expect(fromParts(g, { date: '2026-10-15', hour: 14, minute: 0 })).toBe(1800);
    expect(fromParts(g, { date: '2026-10-01', hour: 0, minute: 0 })).toBe(0);
    const c = { ...g, kind: 'custom' as const, hoursPerDay: 20 };
    expect(toParts(c, 1200 * 3 + 125)).toEqual({ date: '', day: 4, hour: 2, minute: 5 });
    expect(fromParts(c, { day: 4, hour: 2, minute: 5 })).toBe(1200 * 3 + 125);
  });
});

describe('sheet bookkeeping', () => {
  it('says what a passage did to the sheet', async () => {
    const { sheetDiff, initialPov, applyDelta } = await import('../world/survival');
    const a = initialPov({ money: 100, inventory: 'wallet\n2 × ration bar' });
    const b = applyDelta(a, { money: 40, gained: [{ name: 'transit-scrip wafer', qty: 2 }], lost: [{ name: 'ration bar', qty: 1 }], conditionsAdded: ['bruised ribs'] }).state;
    expect(sheetDiff(a, b, 'credits')).toEqual(['+40 credits', '−ration bar', '+2 transit-scrip wafer', 'bruised ribs']);
  });
  it('asks the chronicle to count money as money, in the world currency', () => {
    const m = chroniclePrompt({ worldName: 'W', now: 'x', location: '', known: [], passage: 'p', pov: { name: 'Ora', sheet: 's', action: 'a', ruling: '', currency: 'credits' } })[0]!.content;
    expect(m).toContain('in credits');
    expect(m).toContain('never in "gained"');
    expect(parseChronicle('{"elapsed":"2 minutes","player":{"money":60,"moneyNote":"two wafers of scrip"}}')?.player).toMatchObject({ money: 60, moneyNote: 'two wafers of scrip' });
  });
});
