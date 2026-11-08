import { dist, fractal, inside, smooth } from './geom';
import type { Pt } from './types';

/**
 * A town grown the way towns grow: main roads first (from the centre out
 * to the gates, a ring road round the old core; or a warped grid of
 * avenues for planned cities), side streets branching off them until they
 * meet another street, lanes off those, and then buildings set along every
 * street, fronts to the road, packed tight in the middle and loosening
 * towards the edge. Because every building is placed from a street, the
 * streets and buildings always agree.
 */
export interface TownInput {
  r: () => number;
  /** Where the town is: the union of its districts. */
  urban: Pt[][];
  /** Where nothing is built: water, parks, squares. */
  open: Pt[][];
  /** Lines streets may not cross (rivers, canals, rails, walls), with their half widths. */
  barriers: { points: Pt[]; half: number }[];
  /** Main roads already given (by the plan). */
  roads: Pt[][];
  centre: Pt;
  /** Planned grid (modern and future cities) or grown (older ones). */
  grid: boolean;
  /** Grow main roads out to the map's edge when none are given. */
  gates?: number;
  w: number;
  h: number;
  maxBuildings?: number;
}
export interface Town { avenues: Pt[][]; streets: Pt[][]; lanes: Pt[][]; buildings: Pt[][] }

export const ROAD_HALF = { avenue: 6.5, street: 4, lane: 2.6 } as const;

// ---- Geometry -------------------------------------------------------------

/** Where two segments cross, if they do. */
export function crossAt(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r1 = [b[0] - a[0], b[1] - a[1]]; const r2 = [d[0] - c[0], d[1] - c[1]];
  const den = r1[0]! * r2[1]! - r1[1]! * r2[0]!;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * r2[1]! - (c[1] - a[1]) * r2[0]!) / den;
  const u = ((c[0] - a[0]) * r1[1]! - (c[1] - a[1]) * r1[0]!) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r1[0]! * t, a[1] + r1[1]! * t] : null;
}

function nearestOn(p: Pt, a: Pt, b: Pt): { at: Pt; d: number } {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  const at: Pt = [a[0] + dx * t, a[1] + dy * t];
  return { at, d: dist(p, at) };
}

/** Separating-axis overlap of two convex quads. */
function overlaps(p: Pt[], q: Pt[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!; const b = poly[(i + 1) % poly.length]!;
      const nx = -(b[1] - a[1]); const ny = b[0] - a[0];
      let pmin = Infinity; let pmax = -Infinity; let qmin = Infinity; let qmax = -Infinity;
      for (const v of p) { const s = v[0] * nx + v[1] * ny; pmin = Math.min(pmin, s); pmax = Math.max(pmax, s); }
      for (const v of q) { const s = v[0] * nx + v[1] * ny; qmin = Math.min(qmin, s); qmax = Math.max(qmax, s); }
      if (pmax <= qmin || qmax <= pmin) return false;
    }
  }
  return true;
}

/** A coarse grid of buckets, so nearby things are found without looking at everything. */
class Buckets<T> {
  private m = new Map<string, T[]>();
  constructor(private size: number) {}
  private key(x: number, y: number) { return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`; }
  add(x0: number, y0: number, x1: number, y1: number, v: T) {
    for (let x = Math.floor(x0 / this.size); x <= Math.floor(x1 / this.size); x++) for (let y = Math.floor(y0 / this.size); y <= Math.floor(y1 / this.size); y++) {
      const k = `${x},${y}`; const l = this.m.get(k); if (l) l.push(v); else this.m.set(k, [v]);
    }
  }
  near(x0: number, y0: number, x1: number, y1: number): Set<T> {
    const out = new Set<T>();
    for (let x = Math.floor(x0 / this.size); x <= Math.floor(x1 / this.size); x++) for (let y = Math.floor(y0 / this.size); y <= Math.floor(y1 / this.size); y++) for (const v of this.m.get(`${x},${y}`) ?? []) out.add(v);
    return out;
  }
  at(x: number, y: number) { return this.m.get(this.key(x, y)) ?? []; }
}

interface Seg { a: Pt; b: Pt; street: number; half: number }

// ---- Growing --------------------------------------------------------------

export function growTown(i: TownInput): Town {
  const { r } = i;
  const inTown = (p: Pt) => i.urban.some((u) => inside(p, u));
  const inOpen = (p: Pt) => i.open.some((o) => inside(p, o));
  const segs = new Buckets<Seg>(40);
  const bar = new Buckets<Seg>(40);
  for (const b of i.barriers) for (let k = 0; k < b.points.length - 1; k++) { const a = b.points[k]!; const c = b.points[k + 1]!; bar.add(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1]), { a, b: c, street: -1, half: b.half }); }
  const streets: { pts: Pt[]; level: 0 | 1 | 2 }[] = [];
  const addStreet = (pts: Pt[], level: 0 | 1 | 2) => {
    const id = streets.length;
    streets.push({ pts, level });
    const half = level === 0 ? ROAD_HALF.avenue : level === 1 ? ROAD_HALF.street : ROAD_HALF.lane;
    for (let k = 0; k < pts.length - 1; k++) { const a = pts[k]!; const b = pts[k + 1]!; segs.add(Math.min(a[0], b[0]) - 1, Math.min(a[1], b[1]) - 1, Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1, { a, b, street: id, half }); }
    return id;
  };
  const inMap = (p: Pt) => p[0] > -30 && p[0] < i.w + 30 && p[1] > -30 && p[1] < i.h + 30;

  // Main roads. In a grid, side streets run between the avenues of one direction only, so blocks come out square.
  const across = new Set<number>();
  for (const road of i.roads) addStreet(road, 0);
  if (!i.roads.length) {
    if (i.grid) {
      // A warped grid: two families of avenues at a slight angle, each bending a little.
      const ang = (r() - 0.5) * 0.5;
      const spacing = 95 + r() * 40;
      for (const fam of [0, 1]) {
        const a = ang + (fam ? Math.PI / 2 : 0);
        const dir: Pt = [Math.cos(a), Math.sin(a)]; const nor: Pt = [-dir[1], dir[0]];
        for (let off = -900; off <= 900; off += spacing * (0.8 + r() * 0.4)) {
          const start: Pt = [i.centre[0] + nor[0] * off - dir[0] * 900, i.centre[1] + nor[1] * off - dir[1] * 900];
          const pts: Pt[] = [];
          let bend = 0;
          for (let s = 0; s <= 1800; s += 20) { bend += (r() - 0.5) * 0.6; pts.push([start[0] + dir[0] * s + nor[0] * bend, start[1] + dir[1] * s + nor[1] * bend]); }
          // Keep only the part that runs through town, and a little beyond.
          const keep = pts.filter((p) => inMap(p) && (inTown(p) || i.urban.some((u) => u.some((q) => dist(q, p) < 60))));
          if (keep.length >= 3) { const id = addStreet(keep, 0); if (fam === 0) across.add(id); }
        }
      }
    } else {
      // Roads out from the old centre, wandering, to the edge of the map.
      const n = i.gates ?? 4 + Math.floor(r() * 3);
      const phase = r() * Math.PI * 2;
      for (let g = 0; g < n; g++) {
        let a = phase + (g / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
        const pts: Pt[] = [i.centre];
        let p = i.centre;
        for (let s = 0; s < 120 && inMap(p); s++) { a += (r() - 0.5) * 0.18; p = [p[0] + Math.cos(a) * 14, p[1] + Math.sin(a) * 14]; pts.push(p); }
        addStreet(smooth(pts, 1), 0);
      }
      // A ring road round the old core.
      const rad = 0.42 * Math.min(...i.urban.map((u) => { const xs = u.map((q) => q[0]); const ys = u.map((q) => q[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }), 400);
      const ring = fractal(Array.from({ length: 10 }, (_, k) => { const t = (k / 10) * Math.PI * 2; return [i.centre[0] + Math.cos(t) * rad * (0.9 + r() * 0.2), i.centre[1] + Math.sin(t) * rad * 0.8 * (0.9 + r() * 0.2)] as Pt; }), r, { rounds: 2, rough: 0.12 });
      const closed = smooth([...ring, ring[0]!], 1);
      if (closed.filter(inTown).length > closed.length * 0.6) addStreet(closed, 0);
    }
  }

  /** Grow one street from a point, heading a way, until it meets something. Returns its points. */
  const grow = (from: Pt, heading: number, parent: number, level: 1 | 2, maxLen: number): Pt[] | null => {
    const step = 9;
    const pts: Pt[] = [from];
    let p = from; let a = heading;
    const wiggle = i.grid ? 0.015 : level === 1 ? 0.12 : 0.18;
    for (let s = 0; s * step < maxLen; s++) {
      a += (r() - 0.5) * wiggle * 2;
      const q: Pt = [p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step];
      if (!inTown(q) || inOpen(q)) return pts.length >= 3 ? pts : null;
      // Crossing a river or a wall ends it.
      for (const b of bar.near(Math.min(p[0], q[0]) - 10, Math.min(p[1], q[1]) - 10, Math.max(p[0], q[0]) + 10, Math.max(p[1], q[1]) + 10)) {
        if (crossAt(p, q, b.a, b.b) || nearestOn(q, b.a, b.b).d < b.half + 3) return pts.length >= 3 ? pts : null;
      }
      // Meeting another street ends it there: a junction.
      for (const o of segs.near(Math.min(p[0], q[0]) - 8, Math.min(p[1], q[1]) - 8, Math.max(p[0], q[0]) + 8, Math.max(p[1], q[1]) + 8)) {
        if (o.street === parent && s < 2) continue;
        const x = crossAt(p, q, o.a, o.b);
        if (x) { pts.push(x); return pts.length >= 3 ? pts : null; }
        const n = nearestOn(q, o.a, o.b);
        if (n.d < 5) { pts.push(n.at); return pts.length >= 3 ? pts : null; }
      }
      // Too close alongside another street: it would only duplicate it.
      if (s >= 1) for (const o of segs.near(q[0] - 12, q[1] - 12, q[0] + 12, q[1] + 12)) {
        if (o.street === parent) continue;
        if (nearestOn(q, o.a, o.b).d < (i.grid ? 18 : 12)) return pts.length >= 4 ? pts : null;
      }
      pts.push(q); p = q;
    }
    return pts.length >= 3 ? pts : null;
  };

  /** Branch off a street every so often, on both sides. */
  const branch = (id: number, level: 1 | 2) => {
    const pts = streets[id]!.pts;
    const spacing = level === 1 ? (i.grid ? 58 : 40) : 34;
    let walked = r() * spacing * 0.6 + 12;
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]!; const b = pts[k + 1]!;
      const len = dist(a, b);
      while (acc + len >= walked) {
        const t = (walked - acc) / len;
        const at: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
        for (const side of [1, -1]) {
          if (r() < (i.grid ? (level === 2 ? 0.55 : 0.1) : 0.22)) continue;
          const turn = i.grid ? Math.PI / 2 : Math.PI / 2 + (r() - 0.5) * 0.7;
          const start: Pt = [at[0] + Math.cos(dir + side * turn) * 2, at[1] + Math.sin(dir + side * turn) * 2];
          const s = grow(start, dir + side * turn, id, level, level === 1 ? 160 + r() * 160 : 60 + r() * 70);
          if (s) addStreet([at, ...s.slice(1)], level);
        }
        walked += spacing * (0.75 + r() * 0.5);
      }
      acc += len;
    }
  };

  const mains = streets.map((_, k) => k);
  for (const id of mains) if (!i.grid || !i.roads.length && across.has(id) || i.roads.length) branch(id, 1);
  // A district no road reached gets a street of its own, from its middle towards the town's.
  for (const u of i.urban) {
    const reached = streets.reduce((n, st) => n + st.pts.filter((p) => inside(p, u)).length, 0);
    if (reached >= 10) continue;
    const c: Pt = [u.reduce((a, p) => a + p[0], 0) / u.length, u.reduce((a, p) => a + p[1], 0) / u.length];
    if (!inside(c, u)) continue;
    const toward = Math.atan2(i.centre[1] - c[1], i.centre[0] - c[0]);
    for (const a of [toward, toward + Math.PI]) {
      const st = grow(c, a, -1, 1, 400);
      if (st) { const id = addStreet(st, 1); mains.push(id); branch(id, 1); }
    }
  }
  // Lanes off the streets: the old towns' alleys. Planned cities keep to their grid.
  if (!i.grid) {
    const seconds = streets.map((s, k) => (s.level === 1 ? k : -1)).filter((k) => k >= 0);
    for (const id of seconds) branch(id, 2);
  }

  // ---- Buildings along every street ---------------------------------------
  const built = new Buckets<Pt[]>(30);
  const buildings: Pt[][] = [];
  const max = i.maxBuildings ?? 2600;
  const centreR = Math.max(120, ...i.urban.map((u) => Math.max(...u.map((q) => dist(q, i.centre)))));
  const clearOfStreets = (p: Pt) => {
    for (const o of segs.near(p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9)) if (nearestOn(p, o.a, o.b).d < o.half + 0.6) return false;
    for (const b of bar.near(p[0] - 12, p[1] - 12, p[0] + 12, p[1] + 12)) if (nearestOn(p, b.a, b.b).d < b.half + 1.5) return false;
    return true;
  };
  const fitsAt = (q4: Pt[]) => {
    const m: Pt = [(q4[0]![0] + q4[2]![0]) / 2, (q4[0]![1] + q4[2]![1]) / 2];
    return q4.every((q) => inTown(q) && !inOpen(q)) && q4.every(clearOfStreets) && clearOfStreets(m)
      && ![...built.near(Math.min(...q4.map((q) => q[0])), Math.min(...q4.map((q) => q[1])), Math.max(...q4.map((q) => q[0])), Math.max(...q4.map((q) => q[1])))].some((o) => overlaps(o, q4));
  };
  const keepAt = (q4: Pt[]) => { buildings.push(q4); built.add(Math.min(...q4.map((q) => q[0])), Math.min(...q4.map((q) => q[1])), Math.max(...q4.map((q) => q[0])), Math.max(...q4.map((q) => q[1])), q4); };
  // Fronts first, on every street; the backs only once every street has its row.
  const backs: Pt[][] = [];
  const order = streets.map((s, k) => ({ s, k })).sort((a, b) => a.s.level - b.s.level);
  for (const { s } of order) {
    const half = s.level === 0 ? ROAD_HALF.avenue : s.level === 1 ? ROAD_HALF.street : ROAD_HALF.lane;
    // Walk the street by distance: a lot at a time, each square to the street where it stands.
    const cum: number[] = [0];
    for (let k = 1; k < s.pts.length; k++) cum.push(cum[k - 1]! + dist(s.pts[k - 1]!, s.pts[k]!));
    const total = cum[cum.length - 1]!;
    const at = (d: number): { p: Pt; dir: Pt } => {
      let k = 1; while (k < cum.length - 1 && cum[k]! < d) k++;
      const a = s.pts[k - 1]!; const b = s.pts[k]!;
      const t = (d - cum[k - 1]!) / ((cum[k]! - cum[k - 1]!) || 1);
      const l = dist(a, b) || 1;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    };
    for (const side of [1, -1]) {
      let d = 3 + r() * 4;
      while (d < total - 4 && buildings.length < max) {
        const { p, dir } = at(d);
        const nor: Pt = [-dir[1] * side, dir[0] * side];
        const core = 1 - Math.min(1, dist(p, i.centre) / centreR);
        const lw = (i.grid ? 12 + r() * 12 : 5.5 + r() * 6) * (1 + (1 - core) * 0.3);
        const ld = (i.grid ? 15 + r() * 9 : 6 + r() * 7) * (0.8 + core * 0.5);
        const off = half + 1 + (i.grid ? 1.5 : 0.3 + r() * 0.6);
        const f0: Pt = [p[0] + nor[0] * off, p[1] + nor[1] * off];
        const lot = (w: number, dd: number): Pt[] => [f0, [f0[0] + dir[0] * w, f0[1] + dir[1] * w], [f0[0] + dir[0] * w + nor[0] * dd, f0[1] + dir[1] * w + nor[1] * dd], [f0[0] + nor[0] * dd, f0[1] + nor[1] * dd]];
        // Gardens and gaps: more of them towards the edge of town.
        const gap = r() < 0.04 + (1 - core) * 0.18;
        // A lot that does not fit (a cross street, a corner, the next street behind) is tried narrower and shallower.
        let placed: { w: number; dd: number } | null = null;
        if (!gap) for (const [fw, fd] of [[1, 1], [0.65, 1], [1, 0.6], [0.55, 0.55]] as const) { const q = lot(lw * fw, ld * fd); if (lw * fw >= 4 && fitsAt(q)) { keepAt(q); placed = { w: lw * fw, dd: ld * fd }; break; } }
        if (placed) {
          // Behind the front row, the backs: sheds, yards built over, a second house. Denser in the middle.
          if (r() < (i.grid ? 0.55 : 0.25 + core * 0.55)) {
            const o2 = off + placed.dd + (i.grid ? 2 : 1);
            const d2 = (i.grid ? 9 + r() * 8 : 4 + r() * 6);
            const w2 = placed.w * (0.6 + r() * 0.4);
            const b0: Pt = [p[0] + nor[0] * o2 + dir[0] * (placed.w - w2) * r(), p[1] + nor[1] * o2 + dir[1] * (placed.w - w2) * r()];
            backs.push([b0, [b0[0] + dir[0] * w2, b0[1] + dir[1] * w2], [b0[0] + dir[0] * w2 + nor[0] * d2, b0[1] + dir[1] * w2 + nor[1] * d2], [b0[0] + nor[0] * d2, b0[1] + nor[1] * d2]]);
          }
          d += placed.w + (i.grid ? 2.5 + r() * 3 : 0.6 + r() * 1.2);
        } else d += gap ? lw : 3;
      }
    }
  }

  for (const b of backs) if (buildings.length < max && fitsAt(b)) keepAt(b);

  const pick = (lv: number) => streets.filter((s) => s.level === lv).map((s) => s.pts);
  return { avenues: pick(0), streets: pick(1), lanes: pick(2), buildings };
}
