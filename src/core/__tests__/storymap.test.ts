import { describe, expect, it } from 'vitest';
import type { WorldEntity } from '../world/types';
import { baseMap, line, mapPrompt, parseMap, placeTree, ring, tiesOf, unplaced, webOrder } from '../storymap';
import { character } from './fixtures';

const ent = (id: string, kind: WorldEntity['kind'], name: string, parentId: string | null = null, data: Record<string, unknown> = {}): WorldEntity => ({ id, universeId: 'u1', kind, name, parentId, summary: '', keys: [], data, createdAt: 0, updatedAt: 0 });

const entities = [
  ent('city', 'location', 'Port Ash'),
  ent('inn', 'location', 'The Gull', 'city'),
  ent('docks', 'location', 'The Docks', 'city'),
  ent('keep', 'location', 'Voss Keep'),
  ent('runners', 'organization', 'Tide Runners', null, { leader: 'mara' }),
];
const you = character({ id: 'you', name: 'Ren Hale' });
const mara = character({ id: 'mara', name: 'Mara Voss', relationships: 'Sister to Tomas Voss. She owes Ren Hale nothing.', data: { homeLocationId: 'keep', memberships: [{ orgId: 'runners', role: 'captain' }] } });
const tomas = character({ id: 'tomas', name: 'Tomas Voss', data: { memberships: [{ orgId: 'runners', role: 'deckhand' }] } });
const ilse = character({ id: 'ilse', name: 'Ilse Brant' });

describe('base map', () => {
  const map = baseMap({ entities, characters: [you, mara, tomas, ilse], player: you, locationId: 'inn', locationName: 'The Gull', relations: { 'Mara Voss': { attitude: -2, note: 'You cheated her at cards' } }, recent: ['Tomas Voss waved from the docks.', 'Mara watched you from the bar.'], castIds: [] });

  it('puts the player and whoever the last passage names in the scene, others at home or unknown', () => {
    expect(map.here).toBe('The Gull');
    expect(map.people.map((p) => [p.name, p.presence, p.at])).toEqual([['Ren Hale', 'here', 'The Gull'], ['Mara Voss', 'here', 'The Gull'], ['Tomas Voss', 'unknown', '']]);
  });

  it('nests the scene in its chain, with neighbours, and homes', () => {
    expect(map.places.map((p) => [p.name, p.within])).toEqual(expect.arrayContaining([['Port Ash', ''], ['The Gull', 'Port Ash'], ['The Docks', 'Port Ash'], ['Voss Keep', '']]));
  });

  it('draws ties from the sheet, the cards and who leads whom, once per pair', () => {
    expect(tiesOf(map, 'Mara Voss').map((x) => [x.other, x.tie.kind, x.tie.tone])).toEqual([['Ren Hale', 'enemy', -2], ['Tomas Voss', 'family', 1]]);
  });

  it('builds the place tree around the scene and lists people elsewhere', () => {
    const tree = placeTree(map);
    const city = tree.find((n) => n.place.name === 'Port Ash')!;
    expect(city.children.map((c) => c.place.name)).toEqual(['The Gull', 'The Docks']);
    expect(city.children[0]!.people.map((p) => p.name)).toEqual(['Ren Hale', 'Mara Voss']);
    expect(unplaced(map).map((p) => p.name)).toEqual(['Tomas Voss']);
  });
});

describe('read map', () => {
  it('parses the helper map, making "you" the player and keeping them in the scene', () => {
    const m = parseMap(JSON.stringify({ here: 'The Docks', places: [{ name: 'The Docks', within: 'Port Ash' }], people: [{ name: 'Mara Voss', at: 'Voss Keep', presence: 'away', doing: 'Counting debts' }, { name: 'Ilse', presence: 'lurking' }], ties: [{ a: 'you', b: 'Mara Voss', kind: 'debt', label: 'owes her', tone: -5 }, { a: 'Ilse', b: 'Ilse' }] }), { player: 'Ren Hale', known: ['Mara Voss', 'Port Ash'] })!;
    expect(m.people[0]).toMatchObject({ name: 'Ren Hale', presence: 'here', at: 'The Docks' });
    expect(m.people.find((p) => p.name === 'Ilse')!.presence).toBe('unknown');
    expect(m.people.find((p) => p.name === 'Mara Voss')!.ref).toBe('Mara Voss');
    expect(m.ties).toEqual([{ a: 'Ren Hale', b: 'Mara Voss', kind: 'debt', label: 'owes her', tone: -3 }]);
    expect(parseMap('nonsense', { known: [] })).toBeNull();
  });

  it('asks for what the player knows in play, everything otherwise', () => {
    const base = baseMap({ entities, characters: [mara], player: null, locationId: null, locationName: '', recent: [], castIds: ['mara'] });
    expect(mapPrompt({ base, library: '', recent: 'x', events: '', pov: { name: 'Ren' } })[0]!.content).toContain('only what Ren knows');
    expect(mapPrompt({ base, library: '', recent: 'x', events: '' })[0]!.content).toContain('You see everything');
  });
});

describe('web geometry', () => {
  it('orders the ring warmest first and lays out lines', () => {
    const map = { here: '', places: [], beatId: null, at: 0, people: [{ name: 'A', ref: '', at: '', presence: 'here' as const, doing: '' }, { name: 'B', ref: '', at: '', presence: 'away' as const, doing: '' }, { name: 'C', ref: '', at: '', presence: 'near' as const, doing: '' }], ties: [{ a: 'A', b: 'B', kind: 'enemy' as const, label: '', tone: -2 }, { a: 'C', b: 'A', kind: 'friend' as const, label: '', tone: 2 }] };
    expect(webOrder(map, 'A')).toEqual(['C', 'B']);
    const [top] = ring(4, 100, 100, 50);
    expect(top!.x).toBeCloseTo(100);
    expect(top!.y).toBeCloseTo(50);
    const l = line(0, 0, 30, 40, 2);
    expect(l.width).toBe(50);
    expect(l.left).toBe(-10);
    expect(l.top).toBe(19);
  });
});
