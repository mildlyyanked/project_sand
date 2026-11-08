import { describe, expect, it } from 'vitest';
import { area, bbox, fractal, inside, rect, seeded, smooth, spanningTree } from '../map/geom';
import { buildMap, emptyPlan, onLand, scaleOf, seaFor } from '../map/build';
import { mapPlanPrompt, parseMapPlan } from '../map/plan';
import { compass, formatDistance, mapKindOf, scaleBar, themeFor } from '../map/style';
import { bearing, latLon, mercY, metresBetween, onFoot, whereLines } from '../map/geo';
import type { MapDoc } from '../map/types';
import { dropEchoLabels, placeLabels } from '../map/labels';
import { addArea, deleteVertex, hitTest, insertVertex, moveBy, moveVertex, pushHistory, redo, remove, rename, undo } from '../map/edit';

const ctx = (kind: MapDoc['kind'], children: { id: string; name: string; type?: string }[] = [], theme: MapDoc['theme'] = 'fantasy') => ({ locationId: 'L', universeId: 'U', kind, theme, title: 'Here', children, seed: 42, now: 1 });

describe('map style', () => {
  it('picks a map kind from the place type', () => {
    expect(mapKindOf('planet')).toBe('globe');
    expect(mapKindOf('City')).toBe('city');
    expect(mapKindOf('building')).toBe('floor');
    expect(mapKindOf('ruin')).toBe('site');
    expect(mapKindOf(undefined)).toBe('region');
  });
  it('reads a theme from the world', () => {
    expect(themeFor('Neon-soaked cyberpunk noir')).toBe('cyberpunk');
    expect(themeFor('Hard science fiction aboard an orbital colony')).toBe('scifi');
    expect(themeFor('High fantasy with dragons')).toBe('fantasy');
    expect(themeFor('Contemporary crime')).toBe('modern');
    expect(themeFor('')).toBe('fantasy');
  });
  it('words distances, scale bars and directions', () => {
    expect(formatDistance(100, { unit: 'km', per: 0.12 })).toBe('12 km');
    expect(formatDistance(10, { unit: 'm', per: 2.5 })).toBe('25 m');
    expect(scaleBar({ unit: 'km', per: 0.12 }, 150).label).toBe('20 km');
    expect(compass({ x: 0, y: 0 }, { x: 10, y: -10 })).toBe('north-east');
    expect(compass({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('south');
  });
});

describe('map geometry', () => {
  it('is seeded and deterministic', () => {
    const a = seeded(7); const b = seeded(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('roughens and smooths without losing the shape', () => {
    const sq = rect(0, 0, 100, 100);
    const f = fractal(sq, seeded(1), { rounds: 3, rough: 0.2 });
    expect(f.length).toBe(32);
    expect(area(f)).toBeGreaterThan(5000);
    const s = smooth([[0, 0], [50, 50], [100, 0]], 2);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([100, 0]);
    expect(inside([50, 50], sq)).toBe(true);
    expect(inside([150, 50], sq)).toBe(false);
  });
  it('joins points with a spanning tree', () => {
    expect(spanningTree([[0, 0], [10, 0], [100, 0]])).toHaveLength(2);
  });
});

describe('map plans', () => {
  it('asks for every place inside, by name, and keeps the entries true', () => {
    const m = mapPlanPrompt({ kind: 'city', place: { name: 'Vel Harrow', type: 'city', summary: 'A river port', description: 'Built on both banks of the Sable.' }, children: [{ name: 'Copper Gate', type: 'landmark', summary: '' }], within: [{ name: 'The Reach', type: 'region', summary: '' }], siblings: ['Ost'], world: { name: 'Aster', genre: 'fantasy', rules: '' }, theme: 'fantasy' });
    const text = m.map((x) => x.content).join('\n');
    expect(text).toContain('Copper Gate');
    expect(text).toContain('Built on both banks of the Sable.');
    expect(text).toContain('never contradict'.replace('never', 'Never'));
    expect(text).toContain('city plan');
  });
  it('reads a plan leniently', () => {
    const p = parseMapPlan('Here you go:\n```json\n{"title":"The Reach","across":"140","sea":"west","features":[{"kind":"lake","x":40,"y":30,"w":8,"h":5},{"kind":"river","points":[[10,10],{"x":50,"y":40}]},{"kind":"volcano","x":1,"y":1}],"places":[{"name":"Ost","x":120,"y":20}],"labels":[{"text":"The Mere","x":40,"y":30}]}\n```');
    expect(p).not.toBeNull();
    expect(p!.across).toBe(140);
    expect(p!.sea).toBe('west');
    expect(p!.features.map((f) => f.kind)).toEqual(['water', 'river']);
    expect(p!.places[0]).toEqual({ name: 'Ost', x: 100, y: 20 });
    expect(parseMapPlan('no idea')).toBeNull();
  });
  it('makes sense of units', () => {
    expect(scaleOf('city', 3).per).toBeCloseTo(3);
    expect(scaleOf('region', 120)).toEqual({ unit: 'km', per: 0.12 });
    expect(scaleOf('floor', null).unit).toBe('m');
  });
});

describe('building maps', () => {
  it('places every child place, by name where the plan names it', () => {
    const plan = parseMapPlan('{"title":"The Reach","across":120,"sea":"west","features":[{"kind":"forest","name":"Greywood","x":60,"y":20,"w":20,"h":12}],"places":[{"name":"ost","x":70,"y":40}]}')!;
    const doc = buildMap(plan, ctx('region', [{ id: 'c1', name: 'Ost', type: 'town' }, { id: 'c2', name: 'Fenwick', type: 'village' }]));
    expect(doc.pins.map((p) => p.entityId).sort()).toEqual(['c1', 'c2']);
    expect(doc.pins.find((p) => p.entityId === 'c1')!.name).toBe('Ost');
    expect(doc.areas.some((a) => a.kind === 'water')).toBe(true);
    expect(doc.areas.find((a) => a.name === 'Greywood')!.marks!.length).toBeGreaterThan(5);
    // The forest carries its own name; nothing stores it twice.
    expect(doc.labels.some((l) => l.text === 'Greywood')).toBe(false);
    expect(placeLabels(doc, { scale: 0.4 }).some((l) => l.text === 'Greywood' && l.role === 'area')).toBe(true);
    for (const p of doc.pins) expect(onLand([p.x, p.y], doc.ground, doc.areas)).toBe(true);
    expect(doc.lines.some((l) => l.kind === 'road' || l.kind === 'track')).toBe(true);
  });
  it('is the same map for the same plan and seed', () => {
    const a = buildMap(emptyPlan('X', 'east'), ctx('region'));
    const b = buildMap(emptyPlan('X', 'east'), ctx('region'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('draws a globe with land, ice and graticule room', () => {
    const doc = buildMap(emptyPlan('Aster'), ctx('globe', [{ id: 'n', name: 'Nation' }]));
    expect(doc.ground).toBe('water');
    expect(doc.areas.filter((a) => a.kind === 'land').length).toBeGreaterThanOrEqual(3);
    expect(doc.areas.filter((a) => a.kind === 'ice')).toHaveLength(2);
    expect(doc.scale.unit).toBe('km');
  });
  it('cuts a city into districts and blocks', () => {
    const doc = buildMap(emptyPlan('Vel Harrow'), ctx('city', [{ id: 'g', name: 'Copper Gate', type: 'landmark' }], 'modern'));
    expect(doc.areas.filter((a) => a.kind === 'district').length).toBeGreaterThanOrEqual(4);
    // Buildings are grown from the streets as you look; the map keeps the streets and how dense the town is.
    expect(doc.town).toBeTruthy();
    expect(doc.lines.filter((l) => l.kind === 'street').length).toBeGreaterThan(20);
    expect(doc.lines.some((l) => l.kind === 'avenue')).toBe(true);
    expect(doc.pins).toHaveLength(1);
  });
  it('cuts a building into rooms joined by doors, a room per place', () => {
    const doc = buildMap(emptyPlan('The Gilded Eel'), ctx('floor', [{ id: 'r1', name: 'Tap room', type: 'room' }, { id: 'r2', name: 'Cellar', type: 'room' }]));
    const rooms = doc.areas.filter((a) => a.kind === 'room' || a.kind === 'hall');
    expect(rooms.length).toBeGreaterThanOrEqual(4);
    expect(doc.lines.filter((l) => l.kind === 'door').length).toBeGreaterThanOrEqual(rooms.length);
    expect(doc.lines.some((l) => l.name === 'Entrance')).toBe(true);
    const tap = doc.pins.find((p) => p.entityId === 'r1')!;
    const room = rooms.find((a) => a.name === 'Tap room')!;
    const b = bbox(room.points);
    expect(tap.x).toBeCloseTo(b.x + b.w / 2, 0);
    // Rooms do not overlap.
    for (const a of rooms) for (const o of rooms) if (a !== o) expect(inside([bbox(a.points).x + 1, bbox(a.points).y + 1], o.points)).toBe(false);
  });
  it('uses planned rooms when the model gives them', () => {
    const plan = parseMapPlan('{"title":"Shrine","across":20,"features":[{"kind":"room","name":"Nave","x":50,"y":30,"w":40,"h":30},{"kind":"room","name":"Vestry","x":80,"y":30,"w":20,"h":30}],"places":[]}')!;
    const doc = buildMap(plan, ctx('floor', [{ id: 'v', name: 'Vestry' }]));
    expect(doc.areas.map((a) => a.name)).toEqual(['Nave', 'Vestry']);
    expect(doc.lines.filter((l) => l.kind === 'door' && !l.name)).toHaveLength(1);
    expect(doc.pins[0]!.x).toBe(800);
  });
  it('keeps hand-placed pins on a redraw', () => {
    const first = buildMap(emptyPlan('R'), ctx('region', [{ id: 'c1', name: 'Ost' }]));
    const moved = { ...first.pins[0]!, x: 123, y: 456 };
    const extra = { id: 'mine', entityId: null, name: 'A hut', x: 10, y: 10 };
    const again = buildMap(emptyPlan('R'), { ...ctx('region', [{ id: 'c1', name: 'Ost' }]), seed: 9, keepPins: [moved, extra] });
    expect(again.pins.find((p) => p.entityId === 'c1')).toMatchObject({ x: 123, y: 456, id: moved.id });
    expect(again.pins.find((p) => p.id === 'mine')).toBeTruthy();
  });
  it('picks sea sides by seed', () => {
    expect(seaFor('floor', 3)).toBe('none');
    expect(['none', 'west', 'east', 'south', 'north', 'around']).toContain(seaFor('region', 3));
  });
});

describe('map geography', () => {
  const doc = buildMap(emptyPlan('R'), ctx('region'));
  const flat: MapDoc = { ...doc, scale: { unit: 'km', per: 0.1 }, pins: [{ id: 'a', entityId: 'A', name: 'Ost', x: 100, y: 100 }, { id: 'b', entityId: 'B', name: 'Fenwick', x: 400, y: 500 }, { id: 'c', entityId: null, name: 'Tower', x: 110, y: 100 }] };
  it('measures and words the way between pins', () => {
    expect(metresBetween(flat, flat.pins[0]!, flat.pins[1]!)).toBeCloseTo(50000);
    expect(bearing(flat, flat.pins[0]!, flat.pins[1]!)).toBe('50 km south-east (2 days on foot)');
    expect(bearing(flat, flat.pins[0]!, flat.pins[2]!)).toBe('1 km east (15 minutes on foot)');
    expect(onFoot(100)).toBe('');
  });
  it('measures a globe along the sphere', () => {
    const g: MapDoc = { ...flat, kind: 'globe', scale: { unit: 'km', per: 40.075 } };
    const eq = mercY(g, 0);
    expect(eq).toBeCloseTo(350);
    expect(latLon(g, 500, mercY(g, 0.5)).lat).toBeCloseTo(0.5);
    // A quarter of the way round the equator is a quarter of the circumference.
    expect(metresBetween(g, { x: 250, y: eq }, { x: 500, y: eq }) / 1000).toBeCloseTo(10018.75, 0);
  });
  it('tells the writer where the scene sits', () => {
    const lines = whereLines([{ id: 'A', name: 'Ost' }, { id: 'R', name: 'The Reach' }], (id) => (id === 'R' ? flat : null));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('From Ost, on the map of The Reach: Tower is 1 km east');
    expect(lines[0]).toContain('Fenwick is 50 km south-east');
    expect(whereLines([{ id: 'X', name: 'Nowhere' }, { id: 'R', name: 'The Reach' }], () => flat)).toEqual([]);
  });
});


describe('editing maps', () => {
  const base: MapDoc = { ...buildMap(emptyPlan('E'), ctx('floor')), areas: [], lines: [], labels: [], pins: [] };
  const doc = addArea({ ...base, pins: [{ id: 'p', entityId: null, name: 'Well', x: 500, y: 300 }], labels: [{ id: 't', text: 'Greywood', x: 200, y: 100, size: 'm' }], lines: [{ id: 'l', kind: 'road', points: [[0, 600], [1000, 600]] }] }, { id: 'a', kind: 'forest', points: [[100, 100], [400, 100], [400, 400], [100, 400]] });
  it('hits what is under a finger, pins and handles first', () => {
    expect(hitTest(doc, [503, 298], 12)).toEqual({ type: 'pin', id: 'p' });
    expect(hitTest(doc, [200, 95], 12)).toEqual({ type: 'label', id: 't' });
    expect(hitTest(doc, [500, 604], 12)).toEqual({ type: 'line', id: 'l' });
    expect(hitTest(doc, [300, 300], 12)).toEqual({ type: 'area', id: 'a' });
    expect(hitTest(doc, [102, 398], 12, { type: 'area', id: 'a' })).toEqual({ type: 'area', id: 'a', vertex: 3 });
    expect(hitTest(doc, [250, 101], 12, { type: 'area', id: 'a' })).toEqual({ type: 'area', id: 'a', mid: 0 });
    expect(hitTest(doc, [900, 100], 12)).toBeNull();
  });
  it('edits shapes and keeps decoration with them', () => {
    expect(doc.areas[0]!.marks!.length).toBeGreaterThan(10);
    const s = { type: 'area' as const, id: 'a' };
    const ins = insertVertex(doc, s, 0);
    expect(ins.index).toBe(1);
    expect(ins.doc.areas[0]!.points[1]).toEqual([250, 100]);
    const moved = moveVertex(ins.doc, s, 1, [250, 20]);
    expect(moved.areas[0]!.points[1]).toEqual([250, 20]);
    expect(deleteVertex(moved, s, 1).areas[0]!.points).toHaveLength(4);
    expect(deleteVertex(deleteVertex(doc, s, 0), s, 0).areas[0]!.points).toHaveLength(3);
    const shifted = moveBy(doc, s, 10, 0);
    expect(shifted.areas[0]!.marks![0]![0]).toBeCloseTo(doc.areas[0]!.marks![0]![0] + 10);
    expect(rename(doc, { type: 'pin', id: 'p' }, 'Old well').pins[0]!.name).toBe('Old well');
    expect(remove(doc, { type: 'line', id: 'l' }).lines).toHaveLength(0);
  });
  it('undoes and redoes', () => {
    const next = remove(doc, { type: 'pin', id: 'p' });
    const h = pushHistory({ past: [], future: [] }, doc);
    const u = undo(h, next)!;
    expect(u.doc).toBe(doc);
    const r = redo(u.h, u.doc)!;
    expect(r.doc).toBe(next);
    expect(undo({ past: [], future: [] }, doc)).toBeNull();
  });
});

describe('placing labels', () => {
  const base: MapDoc = { ...buildMap(emptyPlan('L'), ctx('region')), areas: [], lines: [], labels: [], pins: [] };
  const doc: MapDoc = {
    ...base,
    areas: [{ id: 'f', kind: 'forest', name: 'Greywood', points: [[100, 100], [500, 100], [500, 400], [100, 400]] }, { id: 'tiny', kind: 'water', name: 'The Very Long Name of a Pond', points: [[700, 600], [710, 600], [710, 610], [700, 610]] }],
    lines: [{ id: 'r', kind: 'river', name: 'Sable', points: [[0, 500], [300, 520], [600, 500], [1000, 520]] }],
    pins: [{ id: 'a', entityId: null, name: 'Ost', x: 300, y: 250 }, { id: 'b', entityId: null, name: 'Fen', x: 306, y: 252 }, { id: 'c', entityId: null, name: 'Edge', x: 990, y: 300 }],
    labels: [{ id: 't', text: 'The Grey Sea', x: 2, y: 60, size: 'l' }],
  };
  it('sizes text for the screen at every zoom', () => {
    const near = placeLabels(doc, { scale: 4 }).find((l) => l.text === 'Ost')!;
    const far = placeLabels(doc, { scale: 0.4 }).find((l) => l.text === 'Ost')!;
    expect(near.size * 4).toBeCloseTo(far.size * 0.4);
  });
  it('lets the important name win a collision and shows the others closer in', () => {
    const crowd: MapDoc = { ...doc, areas: [], lines: [], labels: [], pins: [{ id: 'a', entityId: null, name: 'Ost', x: 300, y: 250 }, ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: `n${i}`, entityId: null, name: `Hamlet ${i}`, x: 300 + (i % 3) * 4, y: 250 + Math.floor(i / 3) * 4 }))] };
    const shapeOf = (p: { id: string }) => (p.id === 'a' ? 'city' as const : 'mark' as const);
    const far = placeLabels(crowd, { scale: 0.4, shapeOf });
    expect(far.some((l) => l.text === 'Ost')).toBe(true);
    expect(far.filter((l) => l.role === 'pin').length).toBeLessThan(7);
    expect(placeLabels(crowd, { scale: 20, shapeOf }).filter((l) => l.role === 'pin')).toHaveLength(7);
    // Never two names over each other.
    const boxes = far.map((l) => ({ x0: l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - l.text.length * l.size * 0.6 : l.x - l.text.length * l.size * 0.3, y0: l.y - l.size }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(Math.abs(boxes[i]!.x0 - boxes[j]!.x0) + Math.abs(boxes[i]!.y0 - boxes[j]!.y0)).toBeGreaterThan(1);
  });
  it('keeps names on the canvas and in what they name', () => {
    const ls = placeLabels(doc, { scale: 0.4 });
    const edge = ls.find((l) => l.text === 'Edge')!;
    expect(edge.anchor).toBe('end');
    const sea = ls.find((l) => l.text === 'The Grey Sea')!;
    expect(sea.x).toBeGreaterThan(30);
    expect(ls.some((l) => l.text.startsWith('The Very Long'))).toBe(false);
    const moved = { ...doc, areas: [{ ...doc.areas[0]!, points: doc.areas[0]!.points.map(([x, y]) => [x + 300, y] as [number, number]) }] };
    expect(placeLabels(moved, { scale: 1 }).find((l) => l.text === 'Greywood')!.x).toBeCloseTo(600, 0);
  });
  it('always shows the selected thing', () => {
    expect(placeLabels(doc, { scale: 0.4, selected: { type: 'area', id: 'tiny' } }).some((l) => l.id === 'tiny')).toBe(true);
  });
  it('drops stored labels that only repeat a name', () => {
    expect(dropEchoLabels({ ...doc, labels: [...doc.labels, { id: 'x', text: 'greywood', x: 0, y: 0, size: 'm' }] }).labels).toHaveLength(1);
  });
  it('reads the kind the model judged from the plan', () => {
    expect(parseMapPlan('{"kind":"city","title":"Spirehold","across":12000,"features":[{"kind":"district","x":50,"y":35,"w":30,"h":20}]}')!.kind).toBe('city');
    expect(scaleOf('city', 12000).per).toBeCloseTo(12);
  });
});
