import { describe, expect, it } from 'vitest';
import type { WorldEntity, PovState, WorldCalendar } from '../world/types';
import { initialPov } from '../world/survival';
import { character } from './fixtures';
import { venueOf, parseKit, DEFAULT_KIT } from '../sim/kit';
import { seedWorld } from '../sim/seed';
import { whereIs, peopleAt, facesAt, crowdAt } from '../sim/crowd';
import { applyOps, route, type SimContext } from '../sim/ops';
import { resolveAction } from '../sim/actions';
import { runTurn, replay, settle } from '../sim/turn';
import { parseReferee, refereePrompt, sceneForReferee } from '../sim/referee';
import { sceneForNarrator, simContract } from '../sim/narrate';
import type { SimState } from '../sim/types';

const cal: WorldCalendar = { kind: 'custom', start: '', yearLabel: '', startYear: 1, daysPerYear: 0, monthNames: [], hoursPerDay: 24 };
const at = (day: number, hour: number) => day * 1440 + hour * 60;
const loc = (id: string, name: string, type: string, parentId: string | null = null, data: Record<string, unknown> = {}): WorldEntity => ({ id, universeId: 'u1', kind: 'location', name, parentId, summary: '', keys: [], data: { type, ...data }, createdAt: 0, updatedAt: 0 });
const entities: WorldEntity[] = [
  loc('city', 'Port Ash', 'city'),
  loc('docks', 'The Docks', 'district', 'city'),
  loc('gull', 'The Gull Tavern', 'building', 'docks'),
  loc('forge', "Hale's Smithy", 'building', 'docks'),
  loc('keep', 'Voss House', 'building', 'city'),
  { id: 'runners', universeId: 'u1', kind: 'organization', name: 'Tide Runners', parentId: null, summary: '', keys: [], data: { headquarters: 'gull' }, createdAt: 0, updatedAt: 0 },
];
const you = character({ id: 'you', name: 'Ren Hale' });
const mara = character({ id: 'mara', name: 'Mara Voss', data: { homeLocationId: 'keep', memberships: [{ orgId: 'runners', role: 'captain' }] } });
const ctx: SimContext = { kit: DEFAULT_KIT, calendar: cal, difficulty: 'story', currency: 'coins', playerName: 'Ren Hale' };
const world = (clock = at(0, 20)): SimState => seedWorld({ entities, characters: [you, mara], player: you, castIds: [], startId: 'gull', startName: '', clock, calendar: cal, seed: 7 });
const pov = (money = 50): PovState => ({ ...initialPov({ money }), relations: {} });

describe('venues', () => {
  it('reads what a place is for from its name and type', () => {
    expect(venueOf('The Gull Tavern', 'building')).toBe('tavern');
    expect(venueOf('Port Ash', 'city')).toBe('settlement');
    expect(venueOf("Hale's Smithy", 'building')).toBe('shop');
    expect(venueOf('Lower-tier Hall', 'room')).toBe('hall');
    expect(venueOf('Iron Keep', 'city')).toBe('settlement');
    expect(venueOf('Old Road', 'route')).toBe('street');
    expect(venueOf('Somewhere', 'wilderness')).toBe('wild');
  });
});

describe('seeding', () => {
  const s = world();
  it('joins places to their parents with travel times and reveals the start', () => {
    expect(s.places.gull!.exits.map((e) => e.to)).toContain('docks');
    expect(route(s, 'gull', 'keep')!.minutes).toBeGreaterThan(route(s, 'gull', 'forge')!.minutes);
    expect(s.places.gull!.visited).toBe(true);
    expect(s.places.forge!.known).toBe(true);
  });
  it('staffs and stocks shops, and puts people on their rounds', () => {
    const smith = s.actors['a:staff:forge']!;
    expect(smith.work).toBe('forge');
    expect(Object.values(s.things).some((t) => t.holder === 'forge' && t.price)).toBe(true);
    expect(s.actors.mara!.work).toBe('gull');
    expect(whereIs(s.actors.mara!, { clock: at(0, 12), here: 'gull' }, cal)).toBe('gull');
    expect(whereIs(s.actors.mara!, { clock: at(0, 3), here: 'gull' }, cal)).toBe('keep');
    expect(whereIs(smith, { clock: at(0, 12), here: 'gull' }, cal)).toBe('forge');
  });
});

describe('crowds and faces', () => {
  it('fills a busy place with a crowd and the same faces for the same hour', () => {
    const s = world(at(0, 12));
    const docks = s.places.docks!;
    expect(crowdAt(s, docks, cal)).toBeGreaterThan(30);
    const a = facesAt(s, DEFAULT_KIT, docks, cal);
    expect(a.length).toBeGreaterThan(3);
    expect(facesAt(s, DEFAULT_KIT, docks, cal)).toEqual(a);
  });
  it('turns a face into a person who stays met', () => {
    const s = world(at(0, 21));
    const face = facesAt(s, DEFAULT_KIT, s.places.gull!, cal)[0]!;
    const r = applyOps(s, pov(), [{ op: 'meet', who: face.key, name: 'Bren', traits: 'a courier who owes money' }], ctx);
    const met = Object.values(r.sim.actors).find((x) => x.name === 'Bren')!;
    expect(met.haunt).toBe('gull');
    expect(peopleAt(r.sim, 'gull', cal).map((x) => x.id)).toContain(met.id);
    expect(facesAt(r.sim, DEFAULT_KIT, r.sim.places.gull!, cal).some((f) => f.key === face.key)).toBe(false);
  });
});

describe('ops', () => {
  it('moves the player by the shortest way, passing time', () => {
    const s = world();
    const r = applyOps(s, pov(), [{ op: 'go', to: 'Voss House' }], ctx);
    expect(r.sim.here).toBe('keep');
    expect(r.sim.clock).toBe(s.clock + route(s, 'gull', 'keep')!.minutes);
    expect(r.chips[0]).toMatch(/Voss House/);
  });
  it('will not let the player pay what they do not have', () => {
    const r = applyOps(world(), pov(5), [{ op: 'money', amount: -20 }], ctx);
    expect(r.pov.money).toBe(0);
    expect(r.facts[0]).toMatch(/could not pay 20/);
  });
  it('moves things between hands and remembers how people were treated', () => {
    const s = world(at(0, 12));
    const r = applyOps(s, { ...pov(), inventory: [{ name: 'Brass Key', qty: 1 }] }, [{ op: 'lose', item: 'brass key', to: 'Mara Voss' }, { op: 'attitude', who: 'Mara', delta: 1, note: 'you gave her the key' }], ctx);
    expect(r.pov.inventory).toEqual([]);
    expect(Object.values(r.sim.things).find((t) => t.name === 'Brass Key')!.holder).toBe('mara');
    expect(r.pov.relations['Mara Voss']!.attitude).toBe(1);
    expect(r.sim.actors.mara!.memory).toEqual(['you gave her the key']);
  });
  it('adds places found, leads offered and finished, beds and property', () => {
    let s = world();
    let p = pov(500);
    const r1 = applyOps(s, p, [{ op: 'place', name: 'The Salt Cellar', venue: 'tavern', note: 'a cellar bar' }, { op: 'lead', title: 'Find the ledger', giver: 'Mara Voss', reward: '40 coins', money: 40, hours: 24 }], ctx);
    s = r1.sim; p = r1.pov;
    const cellar = Object.values(s.places).find((x) => x.name === 'The Salt Cellar')!;
    expect(cellar.parent).toBe('docks');
    expect(route(s, 'gull', cellar.id)).not.toBeNull();
    expect(s.leads[0]!.deadline).toBe(s.clock + 24 * 60);
    const r2 = applyOps(s, p, [{ op: 'lead', id: s.leads[0]!.id, status: 'done' }, { op: 'lodge', place: 'gull', nights: 2 }, { op: 'stash', item: 'nothing' }], ctx);
    expect(r2.sim.leads[0]!.status).toBe('done');
    expect(r2.sim.lodging!.until).toBe(s.clock + 2 * 1440);
  });
});

describe('tapped actions', () => {
  it('buys from an open shop, not a shut one, and not beyond the purse', () => {
    const day = world(at(0, 12));
    const shut = world(at(0, 22));
    const moveTo = (s: SimState) => applyOps(s, pov(), [{ op: 'go', to: 'forge' }], ctx).sim;
    const open = moveTo(day);
    const item = Object.values(open.things).find((t) => t.holder === 'forge' && t.price)!;
    const o = { kit: DEFAULT_KIT, currency: 'coins', calendar: cal };
    const ok = resolveAction(open, pov(500), { kind: 'buy', thing: item.id }, o);
    expect(ok.ops.map((o) => o.op)).toEqual(['money', 'gain', 'time']);
    expect(resolveAction(open, pov(0), { kind: 'buy', thing: item.id }, o).ops).toEqual([]);
    const closed = moveTo(shut);
    const item2 = Object.values(closed.things).find((t) => t.holder === 'forge' && t.price)!;
    expect(resolveAction(closed, pov(500), { kind: 'buy', thing: item2.id }, o).outcome).toMatch(/shut/);
  });
  it('pays for a shift of work and rents a bed', () => {
    const s = world(at(0, 12));
    s.places.gull!.lodging = 6;
    const w = resolveAction(s, pov(), { kind: 'work' }, { kit: DEFAULT_KIT, currency: 'coins', calendar: cal });
    const t = runTurn(s, pov(), w, ctx);
    expect(t.pov.money).toBeGreaterThan(50);
    expect(t.sim.clock).toBe(s.clock + s.places.gull!.work!.hours * 60);
    const rent = resolveAction(s, pov(), { kind: 'rent', nights: 2 }, { kit: DEFAULT_KIT, currency: 'coins', calendar: cal });
    expect(runTurn(s, pov(), rent, ctx).sim.lodging!.place).toBe('gull');
  });
});

describe('turns', () => {
  it('rolls over the day: restocks, fails late leads, and replays to the same world', () => {
    let s = world(at(0, 20));
    s = applyOps(s, pov(), [{ op: 'lead', title: 'Quick job', hours: 2 }], ctx).sim;
    const t = runTurn(s, pov(), { action: 'You sleep', outcome: 'You sleep.', ops: [{ op: 'time', minutes: 12 * 60, resting: true }] }, ctx);
    expect(t.sim.leads[0]!.status).toBe('failed');
    expect(t.sim.day).toBe(1);
    expect(t.record.facts.join(' ')).toMatch(/Time ran out/);
    expect(replay(s, pov(), t.record.ops, ctx)).toEqual(t.sim);
  });
  it('settles a referee reply with dice and keeps both branches apart', () => {
    const r = parseReferee(JSON.stringify({ intent: 'pick the lock', minutes: 5, outcome: 'You work at the lock.', ops: [], check: { attribute: 'agility', difficulty: 12, why: 'old lock', success: { outcome: 'It clicks open.', ops: [{ op: 'gain', item: 'ledger' }] }, failure: { outcome: 'A pick snaps.', ops: [{ op: 'lose', item: 'lockpicks' }] } } }), true)!;
    const win = settle(r, 'You pick the lock.', { pov: pov(), scores: { agility: 5 }, rng: () => 0.99 });
    expect(win.res.outcome).toMatch(/clicks open/);
    expect(win.res.ops.map((o) => o.op)).toEqual(['gain', 'time']);
    const lose = settle(r, 'You pick the lock.', { pov: pov(), scores: { agility: 1 }, rng: () => 0 });
    expect(lose.res.outcome).toMatch(/snaps/);
    expect(parseReferee('{"ops": []}', true)).toBeNull();
  });
  it('gives the referee refs and the narrator a clean scene and contract', () => {
    const s = world(at(0, 12));
    const scene = sceneForReferee(s, DEFAULT_KIT, pov(), { calendar: cal, currency: 'coins', playerName: 'Ren Hale' });
    expect(scene).toContain('Mara Voss [mara]');
    expect(scene).toMatch(/\[f:gull:\d+:0\]/);
    expect(refereePrompt({ name: 'Ren', scene, sheet: 'x', attributes: {}, checks: true, recent: '', action: 'I ask Mara about the ship.' })[0]!.content).toContain('"op":"meet"');
    const n = sceneForNarrator(s, DEFAULT_KIT, pov(), { calendar: cal, currency: 'coins' });
    expect(n).toContain('Mara Voss');
    expect(n).not.toContain('[mara]');
    expect(simContract({ name: 'Ren' })).toContain('The world below is the truth');
  });
});

describe('kit', () => {
  it('takes a world kit and rejects a thin one', () => {
    const k = parseKit(JSON.stringify({ given: 'abcdefghij'.split(''), family: ['X'], roles: { tavern: ['barkeep', 'spacer'] }, goods: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `g${i}`, category: 'food', price: i })), wage: 30 }))!;
    expect(k.roles.tavern).toEqual(['barkeep', 'spacer']);
    expect(k.wage).toBe(30);
    expect(k.bed).toBe(DEFAULT_KIT.bed);
    expect(parseKit('{"given": ["a"]}')).toBeNull();
  });
});
