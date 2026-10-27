import { describe, expect, it } from 'vitest';
import type { WorldEntity, PovState, WorldCalendar } from '../world/types';
import { initialPov } from '../world/survival';
import { character } from './fixtures';
import { DEFAULT_KIT } from '../sim/kit';
import { seedWorld } from '../sim/seed';
import { applyOps, type SimContext } from '../sim/ops';
import { runTurn, replay } from '../sim/turn';
import { fallbackLayout, findPath, layoutPrompt, parseLayout, passCost, rasterize, scaleOf, spotAt, whereLine, at, SCALES } from '../sim/grid';
import { mapNeeds, resolveMap } from '../sim/map';
import type { SimState } from '../sim/types';

const cal: WorldCalendar = { kind: 'custom', start: '', yearLabel: '', startYear: 1, daysPerYear: 0, monthNames: [], hoursPerDay: 24 };
const loc = (id: string, name: string, type: string, parentId: string | null = null): WorldEntity => ({ id, universeId: 'u1', kind: 'location', name, parentId, summary: '', keys: [], data: { type }, createdAt: 0, updatedAt: 0 });
const entities = [loc('city', 'Port Ash', 'city'), loc('docks', 'The Docks', 'district', 'city'), loc('gull', 'The Gull Tavern', 'building', 'docks')];
const you = character({ id: 'you', name: 'Ren Hale' });
const ctx: SimContext = { kit: DEFAULT_KIT, calendar: cal, difficulty: 'story', currency: 'coins', playerName: 'Ren Hale' };
const pov = (): PovState => ({ ...initialPov({ money: 50 }), relations: {} });
const world = (): SimState => seedWorld({ entities, characters: [you], player: you, castIds: [], startId: 'docks', startName: '', clock: 12 * 60, calendar: cal, seed: 3 });

const docksLayout = JSON.stringify({
  note: 'Cranes and fish stink.', base: 'buildings',
  areas: [{ terrain: 'water', x: 0, y: 0, w: 16, h: 2 }],
  lines: [{ terrain: 'road', points: [[0, 6], [15, 6]] }, { terrain: 'road', points: [[8, 2], [8, 11]] }],
  spots: [{ name: 'The Gull Tavern', venue: 'tavern', x: 4, y: 5, note: 'Smoky.', danger: 0, library: 'The Gull Tavern' }, { name: 'Net Loft', venue: 'workshop', x: 12, y: 8, note: 'Menders.', danger: 1, library: '' }, { name: 'Bad Spot', venue: 'other', x: 4, y: 5, note: '', danger: 0, library: '' }],
  features: [{ name: 'the old crane', x: 9, y: 2, note: 'Groaning.' }],
  entry: { x: 8, y: 11 },
});

describe('scales and terrain', () => {
  it('reads the scale of a place and what can be crossed at it', () => {
    expect(scaleOf({ venue: 'district', type: 'district' })).toBe('quarter');
    expect(scaleOf({ venue: 'settlement', type: 'city' })).toBe('city');
    expect(scaleOf({ venue: 'tavern', type: 'building' })).toBe('interior');
    expect(scaleOf({ venue: 'region', type: 'planet' })).toBe('world');
    expect(passCost('~', 'quarter')).toBeNull();
    expect(passCost('~', 'region')).toBe(3);
    expect(passCost(' ', 'system')).toBe(1);
    expect(passCost('B', 'site')).toBeNull();
  });
});

describe('layouts', () => {
  it('parses a layout, keeps spots apart, and leaves everything reachable', () => {
    const lay = parseLayout(docksLayout, 'quarter')!;
    const { level, spots } = rasterize(lay, 'quarter');
    expect(level.cells.length).toBe(SCALES.quarter.w * SCALES.quarter.h);
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(3);
    for (const s of spots) expect(findPath(level, level.entry, s)).not.toBeNull();
    expect(at(level, 8, 6)).toBe('=');
    expect(parseLayout('nonsense', 'quarter')).toBeNull();
  });
  it('lays out by rules when it must, with the places that must be there', () => {
    for (const scale of ['interior', 'site', 'quarter', 'city', 'region', 'realm', 'world', 'system'] as const) {
      const { level, spots } = rasterize(fallbackLayout({ scale, must: [{ name: 'A', venue: 'tavern' }, { name: 'B', venue: 'shop' }], seed: 1, name: 'X' }), scale);
      expect(spots.map((s) => s.name)).toEqual(['A', 'B']);
      for (const s of spots) expect(findPath(level, level.entry, s)).not.toBeNull();
    }
  });
  it('asks for the places that must be on the map, by name, and the larger place around', () => {
    const m = layoutPrompt({ mode: 'around', place: { name: 'Port Ash', venue: 'settlement', type: 'city', note: '' }, scale: 'region', chain: [], must: [{ name: 'Port Ash', venue: 'settlement', note: '' }], world: 'World: W' });
    expect(m[0]!.content).toContain('16 columns by 12 rows');
    expect(m[0]!.content).toContain('"name": string (the larger place)');
    expect(m[1]!.content).toContain('- Port Ash (settlement)');
  });
});

describe('moving on the map', () => {
  const mapped = () => applyOps(world(), pov(), [{ op: 'level', place: 'docks', layout: parseLayout(docksLayout, 'quarter')! }], ctx).sim;
  it('maps a place onto its library children and makes the rest', () => {
    const s = mapped();
    expect(s.places.gull!.x).toBe(4);
    expect(Object.values(s.places).some((p) => p.name === 'Net Loft' && p.parent === 'docks' && p.work)).toBe(true);
    expect(s.places.docks!.level!.features[0]!.name).toBe('the old crane');
  });
  it('walks by path, logs plain walks and narrates going in', () => {
    let s = mapped();
    s.pos = { ...s.places.docks!.level!.entry };
    const walk = resolveMap(s, { kind: 'walk', x: 8, y: 6 }, { kit: DEFAULT_KIT, calendar: cal });
    expect(walk.ops[0]).toMatchObject({ op: 'step', x: 8, y: 6 });
    s = runTurn(s, pov(), walk, ctx).sim;
    expect(s.pos).toEqual({ x: 8, y: 6 });
    const into = resolveMap(s, { kind: 'enter', place: 'gull' }, { kit: DEFAULT_KIT, calendar: cal });
    expect(into.narrate).toBe(true);
    expect(into.ops.map((o) => o.op)).toEqual(['step', 'enter']);
    expect(mapNeeds(s, { kind: 'enter', place: 'gull' })).toEqual([{ mode: 'inside', place: 'gull', scale: 'interior' }]);
    const t = runTurn(s, pov(), into, ctx);
    expect(t.sim.here).toBe('gull');
    expect(t.sim.pos).toBeNull();
    expect(replay(s, pov(), t.record.ops, ctx)).toEqual(t.sim);
  });
  it('comes back out where the place stands, and makes the world beyond the top', () => {
    let s = mapped();
    s = applyOps(s, pov(), [{ op: 'enter', place: 'gull' }, { op: 'leave' }], ctx).sim;
    expect(s.here).toBe('docks');
    expect(s.pos).toEqual({ x: 4, y: 5 });
    expect(spotAt(s, 'docks', 4, 5)!.id).toBe('gull');
    expect(whereLine(s)).toContain('The Gull Tavern');
    s = applyOps(s, pov(), [{ op: 'leave' }], ctx).sim;
    expect(s.here).toBe('city');
    expect(mapNeeds(s, { kind: 'leave' })).toEqual([{ mode: 'around', place: 'city', scale: 'region' }]);
    const up = applyOps(s, pov(), [{ op: 'parent', name: 'The Salt Coast', type: 'region' }, { op: 'level', place: 'The Salt Coast', layout: fallbackLayout({ scale: 'region', must: [{ name: 'Port Ash', venue: 'settlement' }], seed: 1, name: 'coast' }) }, { op: 'leave' }], ctx).sim;
    expect(up.places[up.here]!.name).toBe('The Salt Coast');
    expect(up.pos).toEqual({ x: up.places.city!.x, y: up.places.city!.y });
  });
  it('finds a place right where the player stands', () => {
    const s = mapped();
    s.pos = { x: 10, y: 6 };
    const r = applyOps(s, pov(), [{ op: 'place', name: 'A Hidden Stair', venue: 'other', here: true }], ctx);
    const stair = Object.values(r.sim.places).find((p) => p.name === 'A Hidden Stair')!;
    expect(stair.parent).toBe('docks');
    expect(Math.max(Math.abs(stair.x! - 10), Math.abs(stair.y! - 6))).toBeLessThanOrEqual(1);
  });
});
