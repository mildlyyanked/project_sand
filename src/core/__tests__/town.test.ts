import { describe, expect, it } from 'vitest';
import { buildMap, emptyPlan } from '../map/build';
import { crossAt, growTown, ROAD_HALF } from '../map/town';
import { inside, toSegment } from '../map/geom';
import type { MapDoc, Pt } from '../map/types';

const ctx = (theme: MapDoc['theme'], seed = 4) => ({ locationId: 'L', universeId: 'U', kind: 'city' as const, theme, title: 'Town', children: [], seed, now: 1 });

describe('growing towns', () => {
  it('finds where segments cross', () => {
    expect(crossAt([0, 0], [10, 10], [0, 10], [10, 0])).toEqual([5, 5]);
    expect(crossAt([0, 0], [1, 1], [5, 0], [6, 1])).toBeNull();
  });
  for (const theme of ['fantasy', 'cyberpunk'] as const) {
    it(`lines buildings up along streets and never on them (${theme})`, () => {
      const t0 = Date.now();
      const doc = buildMap(emptyPlan('Town'), ctx(theme));
      const ms = Date.now() - t0;
      const blocks = doc.areas.filter((a) => a.kind === 'block');
      const roads = doc.lines.filter((l) => l.kind === 'avenue' || l.kind === 'street' || l.kind === 'lane');
      expect(ms).toBeLessThan(4000);
      expect(blocks.length).toBeGreaterThan(300);
      expect(roads.filter((l) => l.kind === 'street').length).toBeGreaterThan(10);
      expect(roads.some((l) => l.kind === 'lane')).toBe(theme === 'fantasy');
      const half = { avenue: ROAD_HALF.avenue, street: ROAD_HALF.street, lane: ROAD_HALF.lane } as Record<string, number>;
      // No building corner sits in a roadway.
      let bad = 0;
      for (const b of blocks.slice(0, 400)) for (const p of b.points) for (const l of roads) for (let k = 0; k < l.points.length - 1; k++) if (toSegment(p, l.points[k]!, l.points[k + 1]!) < half[l.kind]! - 0.5) bad++;
      expect(bad).toBe(0);
      // Every building fronts a street: one of its edges lies close along one.
      const fronting = blocks.slice(0, 300).filter((b) => roads.some((l) => l.points.some((_, k) => k < l.points.length - 1 && toSegment(b.points[0]!, l.points[k]!, l.points[k + 1]!) < half[l.kind]! + 4)));
      expect(fronting.length).toBeGreaterThan(280);
      // Buildings do not overlap.
      for (const a of blocks.slice(0, 200)) for (const b of blocks.slice(0, 200)) if (a !== b) expect(inside([(a.points[0]![0] + a.points[2]![0]) / 2, (a.points[0]![1] + a.points[2]![1]) / 2], b.points)).toBe(false);
    });
  }
  it('stops side streets where they meet another street', () => {
    const square: Pt[] = [[100, 100], [600, 100], [600, 500], [100, 500]];
    const t = growTown({ r: (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(), urban: [square], open: [], barriers: [], roads: [], centre: [350, 300], grid: true, w: 1000, h: 700 });
    expect(t.avenues.length).toBeGreaterThan(2);
    expect(t.buildings.length).toBeGreaterThan(50);
  });
});
