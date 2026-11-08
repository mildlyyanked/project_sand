import { describe, expect, it } from 'vitest';
import { buildMap } from '../map/build';
import { inside, toSegment } from '../map/geom';
import { parseMapPlan } from '../map/plan';
import { crossAt, fillMap, hull, metresPer, roadHalf, tile, type FillInput } from '../map/town';
import type { MapDoc, Pt } from '../map/types';

const plan = (density: number, across: number) => parseMapPlan(JSON.stringify({ kind: 'city', title: 'Sillage', across, density, features: [
  { kind: 'district', name: 'North', x: 30, y: 20, w: 30, h: 18 }, { kind: 'district', name: 'East', x: 70, y: 25, w: 26, h: 20 },
  { kind: 'district', name: 'South', x: 40, y: 52, w: 34, h: 16 }, { kind: 'park', name: 'Perfume Gardens', x: 66, y: 45, w: 10, h: 8 }] }))!;
const city = (theme: MapDoc['theme'], density = 4, across = 14000) => buildMap(plan(density, across), { locationId: 'L', universeId: 'U', kind: 'city', theme, title: 'Sillage', children: [], seed: 5, now: 1 });

export const fillFor = (doc: MapDoc, rect: FillInput['rect']) => fillMap(doc, rect, { lanes: true, buildings: true });

describe('towns at their real size', () => {
  it('finds crossings, hulls and tiles', () => {
    expect(crossAt([0, 0], [10, 10], [0, 10], [10, 0])).toEqual([5, 5]);
    expect(hull([[0, 0], [10, 0], [5, 5], [10, 10], [0, 10]])).toHaveLength(4);
    const cells = tile([[0, 0], [100, 0], [100, 100], [0, 100]], [[25, 50], [75, 50]]);
    expect(cells[0]!.every((p) => p[0] <= 50.0001)).toBe(true);
    expect(cells[1]!.every((p) => p[0] >= 49.9999)).toBe(true);
  });
  it('fills the town to its edges: districts back to back, no gaps between', () => {
    const doc = city('fantasy');
    const ds = doc.areas.filter((a) => a.kind === 'district');
    expect(ds).toHaveLength(3);
    // Points between the planned districts belong to one of them now.
    let covered = 0; let tried = 0;
    for (let x = 300; x <= 700; x += 20) for (let y = 250; y <= 450; y += 20) { tried++; if (ds.some((d) => inside([x, y], d.points))) covered++; }
    expect(covered / tried).toBeGreaterThan(0.95);
    expect(doc.town).toMatchObject({ density: 4, grid: false });
  });
  it('builds a city fourteen kilometres across with streets every hundred metres or so', () => {
    for (const theme of ['fantasy', 'cyberpunk'] as const) {
      const t0 = Date.now();
      const doc = city(theme);
      expect(Date.now() - t0).toBeLessThan(8000);
      const m = metresPer(doc.scale);
      expect(m).toBeCloseTo(14);
      const streets = doc.lines.filter((l) => l.kind === 'street');
      const length = streets.reduce((n, l) => n + l.points.reduce((a, p, k) => (k ? a + Math.hypot(p[0] - l.points[k - 1]![0], p[1] - l.points[k - 1]![1]) : a), 0), 0) * m;
      // A dense city of tens of square kilometres has hundreds of kilometres of streets.
      expect(length / 1000).toBeGreaterThan(200);
    }
  });
  it('grows lanes and buildings for the part on screen, the same way every time', () => {
    const doc = city('fantasy');
    const rect = { x: 480, y: 330, w: 60, h: 100 }; // about 0.8 × 1.4 km
    const a = fillFor(doc, rect);
    const b = fillFor(doc, rect);
    expect(a.buildings.length).toBeGreaterThan(400);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // A wider view holds the same buildings where it overlaps.
    const wide = fillFor(doc, { x: 460, y: 310, w: 100, h: 140 });
    const key = (q: Pt[]) => q.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(';');
    const wideKeys = new Set(wide.buildings.map(key));
    const inner = a.buildings.filter((q) => q.every((p) => p[0] > rect.x + 10 && p[0] < rect.x + rect.w - 10 && p[1] > rect.y + 10 && p[1] < rect.y + rect.h - 10));
    expect(inner.filter((q) => wideKeys.has(key(q))).length / inner.length).toBeGreaterThan(0.97);
    // Nothing is built on a roadway.
    const m = metresPer(doc.scale);
    const roads = doc.lines.filter((l) => l.kind === 'avenue' || l.kind === 'street');
    let bad = 0;
    for (const q of a.buildings.slice(0, 300)) for (const p of q) for (const l of roads) for (let k = 0; k < l.points.length - 1; k++) if (toSegment(p, l.points[k]!, l.points[k + 1]!) < roadHalf(l.kind === 'avenue' ? 'avenue' : 'street', !!doc.town?.grid) / m - 0.05) bad++;
    expect(bad).toBe(0);
  });
  it('builds sparser for a market town than for a crowded city', () => {
    const rect = { x: 470, y: 320, w: 80, h: 80 };
    const town = fillFor(city('fantasy', 2, 3000), rect).buildings.length;
    const dense = fillFor(city('fantasy', 5, 3000), rect).buildings.length;
    expect(dense).toBeGreaterThan(town);
  });
});

describe('towns grown in tiles', () => {
  it('gives the same town tile by tile as all at once, with nothing repeated', () => {
    const doc = city('fantasy');
    const size = 20;
    const tiles: ReturnType<typeof fillFor>[] = [];
    for (let x = 480; x < 520; x += size) for (let y = 330; y < 370; y += size) tiles.push(fillMap(doc, { x, y, w: size, h: size }, { lanes: true, buildings: true, strict: true }));
    const key = (q: Pt[]) => q.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(';');
    const keys = tiles.flatMap((t) => t.buildings.map(key));
    expect(new Set(keys).size).toBe(keys.length);
    const whole = new Set(fillMap(doc, { x: 480, y: 330, w: 40, h: 40 }, { lanes: true, buildings: true, strict: true }).buildings.map(key));
    expect(keys.filter((k) => whole.has(k)).length / keys.length).toBeGreaterThan(0.97);
  });
});
