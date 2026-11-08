import { dist, fractal, hashOf, inside, seeded, smooth } from './geom';
import type { Pt } from './types';

/**
 * Towns at their real size. Everything is measured in metres and turned
 * into map units by the map's scale, so a city fourteen kilometres across
 * has the streets and the tens of thousands of buildings a city that size
 * has. The street network (main roads and streets) is grown once and kept
 * on the map, editable like any line. Lanes and buildings are far too many
 * to keep: they are grown from the streets, the same way every time, for
 * the part of the map on screen, when you are close enough to see them.
 *
 * Growing follows how towns grow: main roads first (from the centre out to
 * the gates with a ring road round the core, or a warped grid of avenues
 * for planned cities), streets branching off them until they meet another
 * street, lanes off those; then buildings along every street, square to it,
 * front to the road, packed by the town's density and loosening at the edge.
 */

/** 1 a scatter of farms, 2 a market town, 3 a city, 4 a crowded city, 5 a megacity. */
export type Density = 1 | 2 | 3 | 4 | 5;
export interface TownSpec { density: Density; grid: boolean; seed: number }

/** Half widths of roadways, in metres: old towns are narrow, planned cities wide. */
export const ROAD_M = { avenue: 12, street: 5, lane: 2.5 } as const;
const ROAD_OLD = { avenue: 8, street: 3.5, lane: 1.8 } as const;
export const roadHalf = (kind: 'avenue' | 'street' | 'lane', grid: boolean) => (grid ? ROAD_M : ROAD_OLD)[kind];
/** Kept for tests of older maps: half widths in map units at the old fixed size. */
export const ROAD_HALF = { avenue: 6.5, street: 4, lane: 2.6 } as const;

const densityScale = (d: Density) => [0, 1.6, 1.25, 1, 0.85, 0.72][d]!;

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

export function nearestOn(p: Pt, a: Pt, b: Pt): { at: Pt; d: number } {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  const at: Pt = [a[0] + dx * t, a[1] + dy * t];
  return { at, d: dist(p, at) };
}

/** Distance from a point to a segment, with nothing allocated. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a[0] + dx * t - p[0]; const y = a[1] + dy * t - p[1];
  return Math.sqrt(x * x + y * y);
}

/** Separating-axis overlap of two convex quads. */
function overlaps(p: Pt[], q: Pt[]): boolean {
  for (const poly of [p, q]) {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!; const b = poly[(k + 1) % poly.length]!;
      const nx = -(b[1] - a[1]); const ny = b[0] - a[0];
      let pmin = Infinity; let pmax = -Infinity; let qmin = Infinity; let qmax = -Infinity;
      for (const v of p) { const s = v[0] * nx + v[1] * ny; if (s < pmin) pmin = s; if (s > pmax) pmax = s; }
      for (const v of q) { const s = v[0] * nx + v[1] * ny; if (s < qmin) qmin = s; if (s > qmax) qmax = s; }
      if (pmax <= qmin || qmax <= pmin) return false;
    }
  }
  return true;
}

/** A coarse grid of buckets, so nearby things are found without looking at everything. */
export class Buckets<T> {
  private m = new Map<number, T[]>();
  constructor(private size: number) {}
  private k(x: number, y: number) { return Math.floor(x / this.size) * 100003 + Math.floor(y / this.size); }
  add(x0: number, y0: number, x1: number, y1: number, v: T) {
    for (let x = Math.floor(x0 / this.size); x <= Math.floor(x1 / this.size); x++) for (let y = Math.floor(y0 / this.size); y <= Math.floor(y1 / this.size); y++) {
      const k = x * 100003 + y; const l = this.m.get(k); if (l) l.push(v); else this.m.set(k, [v]);
    }
  }
  near(x0: number, y0: number, x1: number, y1: number): Set<T> {
    const out = new Set<T>();
    for (let x = Math.floor(x0 / this.size); x <= Math.floor(x1 / this.size); x++) for (let y = Math.floor(y0 / this.size); y <= Math.floor(y1 / this.size); y++) for (const v of this.m.get(x * 100003 + y) ?? []) out.add(v);
    return out;
  }
  has(x: number, y: number) { return this.m.has(this.k(x, y)); }
  /** Whether anything near passes a test; stops at the first. Nothing allocated: this is the hot path. */
  some(x0: number, y0: number, x1: number, y1: number, test: (v: T) => boolean): boolean {
    const a = Math.floor(x0 / this.size); const b = Math.floor(x1 / this.size); const c = Math.floor(y0 / this.size); const d = Math.floor(y1 / this.size);
    for (let x = a; x <= b; x++) for (let y = c; y <= d; y++) { const l = this.m.get(x * 100003 + y); if (l) for (let k = 0; k < l.length; k++) if (test(l[k]!)) return true; }
    return false;
  }
}

/** The convex hull of points (monotone chain). */
export function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = []; const up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** The part of a polygon on a's side of the line halfway between a and b. */
function clipToward(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n: Pt = [b[0] - a[0], b[1] - a[1]];
  const side = (p: Pt) => (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1];
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!; const q = poly[(i + 1) % poly.length]!;
    const sp = side(p); const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

/** Districts that tile a town back to back: each the part of the outline nearest its centre. */
export function tile(outline: Pt[], centres: Pt[]): Pt[][] {
  return centres.map((c, i) => centres.reduce((poly, o, j) => (i === j || poly.length < 3 ? poly : clipToward(poly, c, o)), outline));
}

/**
 * Which cells of a region are town, open ground (water, parks, squares) or
 * neither, filled row by row: a lookup instead of a point-in-polygon test
 * for every corner of every lot.
 */
class Mask {
  private cells: Uint8Array;
  private nx: number; private ny: number;
  constructor(private x0: number, private y0: number, w: number, h: number, private cs: number, town: Pt[][], open: Pt[][]) {
    this.nx = Math.max(1, Math.ceil(w / cs)); this.ny = Math.max(1, Math.ceil(h / cs));
    this.cells = new Uint8Array(this.nx * this.ny);
    this.paint(town, 1); this.paint(open, 2);
  }
  private paint(polys: Pt[][], v: number) {
    for (const poly of polys) for (let j = 0; j < this.ny; j++) {
      const y = this.y0 + (j + 0.5) * this.cs;
      const xs: number[] = [];
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const a = poly[k]!; const b = poly[l]!;
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k]! - this.x0) / this.cs - 0.5)); const to = Math.min(this.nx - 1, Math.floor((xs[k + 1]! - this.x0) / this.cs - 0.5));
        for (let c = from; c <= to; c++) this.cells[j * this.nx + c] = v;
      }
    }
  }
  at(p: Pt): number {
    const c = Math.floor((p[0] - this.x0) / this.cs); const r = Math.floor((p[1] - this.y0) / this.cs);
    return c < 0 || r < 0 || c >= this.nx || r >= this.ny ? -1 : this.cells[r * this.nx + c]!;
  }
}

// ---- Streets --------------------------------------------------------------

export interface StreetInput {
  r: () => number;
  /** Where the town is built. */
  urban: Pt[][];
  /** Where nothing is built: water, parks, squares. */
  open: Pt[][];
  /** Lines streets may not cross (rivers, canals, rails, walls), with their half widths in map units. */
  barriers: { points: Pt[]; half: number }[];
  /** Main roads already given (by the plan). */
  roads: Pt[][];
  centre: Pt;
  grid: boolean;
  density: Density;
  /** Metres per map unit. */
  m: number;
  w: number;
  h: number;
  /** Places that should be reached by a street (district centres). */
  reach?: Pt[];
}
export interface Streets { avenues: Pt[][]; streets: Pt[][] }

interface Seg { a: Pt; b: Pt; street: number; half: number }

export function growStreets(i: StreetInput): Streets {
  const { r } = i;
  const u = (metres: number) => metres / i.m;
  const ds = densityScale(i.density);
  const step = Math.max(2.5, Math.min(14, u(28)));
  const inTown = (p: Pt) => i.urban.some((x) => inside(p, x));
  const inOpen = (p: Pt) => i.open.some((o) => inside(p, o));
  const cell = Math.max(10, u(160));
  const segs = new Buckets<Seg>(cell);
  const bar = new Buckets<Seg>(cell);
  for (const b of i.barriers) for (let k = 0; k < b.points.length - 1; k++) { const a = b.points[k]!; const c = b.points[k + 1]!; bar.add(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1]), { a, b: c, street: -1, half: b.half }); }
  const streets: { pts: Pt[]; level: 0 | 1 }[] = [];
  const addStreet = (pts: Pt[], level: 0 | 1) => {
    const id = streets.length;
    streets.push({ pts, level });
    const half = u(roadHalf(level === 0 ? 'avenue' : 'street', i.grid));
    for (let k = 0; k < pts.length - 1; k++) { const a = pts[k]!; const b = pts[k + 1]!; segs.add(Math.min(a[0], b[0]) - 1, Math.min(a[1], b[1]) - 1, Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1, { a, b, street: id, half }); }
    return id;
  };
  const inMap = (p: Pt) => p[0] > -30 && p[0] < i.w + 30 && p[1] > -30 && p[1] < i.h + 30;
  const extent = Math.max(60, ...i.urban.map((x) => { const xs = x.map((q) => q[0]); const ys = x.map((q) => q[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }));

  // Main roads. In a grid, streets run between the avenues of one direction, so blocks come out square.
  const across = new Set<number>();
  for (const road of i.roads) addStreet(road, 0);
  if (i.grid || i.roads.length < 2) {
    if (i.grid) {
      const ang = (r() - 0.5) * 0.5;
      const spacing = Math.max(u(110) * 2, Math.min(extent / 2.5, u(650 + r() * 300) * ds));
      for (const fam of [0, 1]) {
        const a = ang + (fam ? Math.PI / 2 : 0);
        const dir: Pt = [Math.cos(a), Math.sin(a)]; const nor: Pt = [-dir[1], dir[0]];
        for (let off = -1100; off <= 1100; off += spacing * (0.85 + r() * 0.3)) {
          const start: Pt = [i.centre[0] + nor[0] * off - dir[0] * 1100, i.centre[1] + nor[1] * off - dir[1] * 1100];
          const pts: Pt[] = [];
          let bend = 0;
          for (let s = 0; s <= 2200; s += Math.max(step, 6)) { bend += (r() - 0.5) * Math.min(1.5, step * 0.05); const p: Pt = [start[0] + dir[0] * s + nor[0] * bend, start[1] + dir[1] * s + nor[1] * bend]; if (inMap(p)) pts.push(p); }
          const keep = pts.filter((p) => inTown(p) || i.urban.some((x) => x.some((q) => dist(q, p) < extent * 0.08)));
          if (keep.length >= 3) { const id = addStreet(keep, 0); if (fam === 0) across.add(id); }
        }
      }
    } else {
      const n = 4 + Math.floor(r() * 3) + (i.density >= 4 ? 2 : 0);
      const phase = r() * Math.PI * 2;
      for (let g = 0; g < n; g++) {
        let a = phase + (g / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
        const pts: Pt[] = [i.centre];
        let p = i.centre;
        for (let s = 0; s < 600 && inMap(p); s++) { a += (r() - 0.5) * 0.12; p = [p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step]; pts.push(p); }
        addStreet(smooth(pts, 1), 0);
      }
      // Ring roads round the old core, and in a big town round the next ring too.
      for (const frac of i.density >= 3 && extent > u(3000) ? [0.22, 0.42] : [0.38]) {
        const rad = frac * extent;
        const ring = fractal(Array.from({ length: 12 }, (_, k) => { const t = (k / 12) * Math.PI * 2; return [i.centre[0] + Math.cos(t) * rad * (0.9 + r() * 0.2), i.centre[1] + Math.sin(t) * rad * 0.8 * (0.9 + r() * 0.2)] as Pt; }), r, { rounds: 3, rough: 0.1 });
        const closed = smooth([...ring, ring[0]!], 1);
        if (closed.filter(inTown).length > closed.length * 0.5) addStreet(closed, 0);
      }
    }
  }

  const snap = Math.max(1.2, u(12));
  const apart = Math.max(2, u(i.grid ? 75 : 42) * ds);

  /** Grow one street from a point, heading a way, until it meets something. */
  const grow = (from: Pt, heading: number, parent: number, maxLen: number): Pt[] | null => {
    const pts: Pt[] = [from];
    let p = from; let a = heading;
    const wiggle = i.grid ? 0.012 : 0.1;
    for (let s = 0; s * step < maxLen; s++) {
      a += (r() - 0.5) * wiggle * 2;
      const q: Pt = [p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step];
      if (!inTown(q) || inOpen(q)) return pts.length >= 3 ? pts : null;
      for (const b of bar.near(Math.min(p[0], q[0]) - step, Math.min(p[1], q[1]) - step, Math.max(p[0], q[0]) + step, Math.max(p[1], q[1]) + step)) {
        if (crossAt(p, q, b.a, b.b) || nearestOn(q, b.a, b.b).d < b.half + snap) return pts.length >= 3 ? pts : null;
      }
      for (const o of segs.near(Math.min(p[0], q[0]) - snap, Math.min(p[1], q[1]) - snap, Math.max(p[0], q[0]) + snap, Math.max(p[1], q[1]) + snap)) {
        if (o.street === parent && s < 2) continue;
        const x = crossAt(p, q, o.a, o.b);
        if (x) { pts.push(x); return pts.length >= 3 ? pts : null; }
        const n = nearestOn(q, o.a, o.b);
        if (n.d < snap) { pts.push(n.at); return pts.length >= 3 ? pts : null; }
      }
      // Running alongside another street, too close: it would only duplicate it. (Heading at one is fine: that is a junction to come.)
      if (s >= 1) for (const o of segs.near(q[0] - apart, q[1] - apart, q[0] + apart, q[1] + apart)) {
        if (o.street === parent) continue;
        const ol = dist(o.a, o.b) || 1;
        const along = Math.abs(Math.cos(a) * (o.b[0] - o.a[0]) / ol + Math.sin(a) * (o.b[1] - o.a[1]) / ol);
        if (along > 0.75 && nearestOn(q, o.a, o.b).d < apart) return pts.length >= 4 ? pts : null;
      }
      pts.push(q); p = q;
    }
    return pts.length >= 3 ? pts : null;
  };

  /** Branch streets off a street every so often, on both sides. */
  const branch = (id: number, spacing: number, maxLen: () => number) => {
    const pts = streets[id]!.pts;
    let walked = r() * spacing * 0.6 + spacing * 0.3;
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]!; const b = pts[k + 1]!;
      const len = dist(a, b);
      while (acc + len >= walked) {
        const t = (walked - acc) / len;
        const at: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
        for (const side of [1, -1]) {
          if (r() < (i.grid ? 0.06 : 0.18)) continue;
          const turn = i.grid ? Math.PI / 2 : Math.PI / 2 + (r() - 0.5) * 0.7;
          const start: Pt = [at[0] + Math.cos(dir + side * turn) * 0.5, at[1] + Math.sin(dir + side * turn) * 0.5];
          const s = grow(start, dir + side * turn, id, maxLen());
          if (s) addStreet([at, ...s.slice(1)], 1);
        }
        walked += spacing * (0.75 + r() * 0.5);
      }
      acc += len;
    }
  };

  const spacing = u(i.grid ? 130 : 95) * ds;
  const long = () => u(i.grid ? 2000 : 450 + r() * 650);
  const mains = streets.map((_, k) => k);
  for (const id of mains) if (!i.grid || across.has(id) || !across.size) branch(id, spacing, long);
  // Streets off streets, a generation or two, until the town is covered.
  for (let gen = 0; gen < (i.grid ? 1 : 2); gen++) {
    const firsts = streets.map((s, k) => (s.level === 1 ? k : -1)).filter((k) => k >= 0);
    for (const id of firsts) branch(id, spacing * (i.grid ? 1.1 : 1.3), () => u(i.grid ? 2000 : 300 + r() * 400));
  }
  // Anywhere still without a street gets one: sweep the town, and where no street is near, grow one both ways from there.
  for (let pass = 0; pass < 3; pass++) {
    const gap = spacing * (pass === 0 ? 2.2 : 1.6);
    const xs = i.urban.flat().map((q) => q[0]); const ys = i.urban.flat().map((q) => q[1]);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    for (let y = y0 + gap / 2; y < y1; y += gap) for (let x = x0 + gap / 2; x < x1; x += gap) {
      const c: Pt = [x + (r() - 0.5) * gap * 0.5, y + (r() - 0.5) * gap * 0.5];
      if (!inTown(c) || inOpen(c)) continue;
      const lookR = spacing * 1.1;
      if ([...segs.near(c[0] - lookR, c[1] - lookR, c[0] + lookR, c[1] + lookR)].some((o) => nearestOn(c, o.a, o.b).d < lookR)) continue;
      // Run it square to the nearest street, so it reads as part of the same town.
      let best: Seg | null = null; let bd = Infinity;
      for (const o of segs.near(c[0] - spacing * 4, c[1] - spacing * 4, c[0] + spacing * 4, c[1] + spacing * 4)) { const d = nearestOn(c, o.a, o.b).d; if (d < bd) { bd = d; best = o; } }
      const a = best ? Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]) + Math.PI / 2 : r() * Math.PI;
      const one = grow(c, a, -1, u(1500));
      const two = grow(c, a + Math.PI, -1, u(1500));
      const pts = [...(two ?? [c]).reverse(), ...(one ?? [c]).slice(1)];
      if (pts.length >= 3) { const id = addStreet(pts, 1); branch(id, spacing * 1.2, () => u(i.grid ? 2000 : 250 + r() * 350)); }
    }
  }
  // A district no street reached gets one of its own, from its middle.
  for (const c of i.reach ?? []) {
    if (!inTown(c) || [...segs.near(c[0] - u(250), c[1] - u(250), c[0] + u(250), c[1] + u(250))].length) continue;
    const toward = Math.atan2(i.centre[1] - c[1], i.centre[0] - c[0]);
    for (const a of [toward, toward + Math.PI]) {
      const st = grow(c, a, -1, u(3000));
      if (st) { const id = addStreet(st, 1); branch(id, spacing, long); }
    }
  }
  const pick = (lv: number) => streets.filter((s) => s.level === lv).map((s) => s.pts);
  return { avenues: pick(0), streets: pick(1) };
}

// ---- Lanes and buildings, for a part of the map ---------------------------

export interface FillInput {
  spec: TownSpec;
  /** Metres per map unit. */
  m: number;
  urban: Pt[][];
  open: Pt[][];
  barriers: { points: Pt[]; half: number }[];
  /** The kept network: main roads (level 0) and streets (level 1), in a stable order. */
  network: { pts: Pt[]; level: 0 | 1 }[];
  centre: Pt;
  /** The part of the map to fill, in map units. */
  rect: { x: number; y: number; w: number; h: number };
  lanes: boolean;
  buildings: boolean;
  max?: number;
  /** Only what starts inside the rect itself (a tile): neighbouring tiles then never repeat each other. */
  strict?: boolean;
}
export interface Fill { lanes: Pt[][]; buildings: Pt[][] }

/**
 * Lanes and buildings for one part of a town. Every lane and lot is drawn
 * from its own street with its own seed, so the same street always grows
 * the same lanes and lots, whichever part of the map is asked for.
 */
export function fillTown(i: FillInput): Fill {
  const u = (metres: number) => metres / i.m;
  const { density, grid } = i.spec;
  const ds = densityScale(density);
  const margin = u(grid ? 320 : 220);
  const R = { x0: i.rect.x - margin, y0: i.rect.y - margin, x1: i.rect.x + i.rect.w + margin, y1: i.rect.y + i.rect.h + margin };
  const inRect = (p: Pt) => p[0] >= R.x0 && p[0] <= R.x1 && p[1] >= R.y0 && p[1] <= R.y1;
  const reach = u(300);
  const pad = u(150);
  const span = Math.max(R.x1 - R.x0, R.y1 - R.y0) + pad * 2;
  const mask = new Mask(R.x0 - pad, R.y0 - pad, R.x1 - R.x0 + pad * 2, R.y1 - R.y0 + pad * 2, Math.max(u(2.5), span / 900), i.urban, i.open);
  const slowTown = (p: Pt) => i.urban.some((x) => inside(p, x)) && !i.open.some((o) => inside(p, o));
  /** Town ground, not open: by the mask where it reaches, by the polygons beyond. */
  const ground = (p: Pt) => { const v = mask.at(p); return v === -1 ? slowTown(p) : v === 1; };
  const nearRect = (p: Pt) => p[0] >= R.x0 - reach && p[0] <= R.x1 + reach && p[1] >= R.y0 - reach && p[1] <= R.y1 + reach;
  const inTown = (p: Pt) => i.urban.some((x) => inside(p, x));
  const inOpen = (p: Pt) => i.open.some((o) => inside(p, o));
  const cell = Math.max(4, u(60));
  const segs = new Buckets<Seg>(cell);
  const bar = new Buckets<Seg>(cell);
  const touches = (pts: Pt[]) => pts.some(inRect) || pts.some((p, k) => k > 0 && crossesRect(pts[k - 1]!, p, R));
  for (const b of i.barriers) for (let k = 0; k < b.points.length - 1; k++) { const a = b.points[k]!; const c = b.points[k + 1]!; bar.add(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1]), { a, b: c, street: -1, half: b.half }); }
  const near = i.network.map((s, k) => ({ ...s, k })).filter((s) => touches(s.pts) || s.pts.some(nearRect));
  const addSegs = (pts: Pt[], id: number, half: number) => { for (let k = 0; k < pts.length - 1; k++) { const a = pts[k]!; const b = pts[k + 1]!; segs.add(Math.min(a[0], b[0]) - 0.5, Math.min(a[1], b[1]) - 0.5, Math.max(a[0], b[0]) + 0.5, Math.max(a[1], b[1]) + 0.5, { a, b, street: id, half }); } };
  for (const s of near) addSegs(s.pts, s.k, u(roadHalf(s.level === 0 ? 'avenue' : 'street', grid)));

  // Lanes: off each street, from its own seed; stopping at any street or earlier lane.
  const lanes: { pts: Pt[]; id: number; key: string }[] = [];
  if (!grid) {
    const step = Math.max(0.8, u(16));
    const snap = Math.max(0.6, u(8));
    const apart = Math.max(0.8, u(26) * ds);
    for (const s of near) {
      if (s.level !== 1) continue;
      const r = seeded(hashOf(i.spec.seed, 'lane', s.k));
      const spacing = u(62) * ds;
      let walked = r() * spacing;
      let acc = 0;
      let spawn = 0;
      for (let k = 0; k < s.pts.length - 1; k++) {
        const a = s.pts[k]!; const b = s.pts[k + 1]!;
        const len = dist(a, b);
        while (acc + len >= walked) {
          const t = (walked - acc) / len;
          const at: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
          spawn++;
          for (const side of [1, -1]) {
            const skip = r() < 0.35;
            const heading0 = dir + side * (Math.PI / 2 + (r() - 0.5) * 0.8);
            const maxLen = u(110 + r() * 160);
            const wig: number[] = Array.from({ length: 24 }, () => (r() - 0.5) * 0.3);
            if (skip || !nearRect(at)) continue;
            const pts: Pt[] = [at];
            let p: Pt = [at[0] + Math.cos(heading0) * 0.3, at[1] + Math.sin(heading0) * 0.3];
            let hd = heading0;
            let ended = false;
            for (let n = 0; n * step < maxLen && n < 24 && !ended; n++) {
              hd += wig[n]!;
              const q: Pt = [p[0] + Math.cos(hd) * step, p[1] + Math.sin(hd) * step];
              if (!inTown(q) || inOpen(q)) break;
              for (const bb of bar.near(q[0] - step, q[1] - step, q[0] + step, q[1] + step)) if (nearestOn(q, bb.a, bb.b).d < bb.half + snap) { ended = true; break; }
              if (ended) break;
              for (const o of segs.near(Math.min(p[0], q[0]) - snap, Math.min(p[1], q[1]) - snap, Math.max(p[0], q[0]) + snap, Math.max(p[1], q[1]) + snap)) {
                if (o.street === s.k && n < 2) continue;
                const x = crossAt(p, q, o.a, o.b);
                if (x) { pts.push(x); ended = true; break; }
                const nn = nearestOn(q, o.a, o.b);
                if (nn.d < snap) { pts.push(nn.at); ended = true; break; }
              }
              if (ended) break;
              if (n >= 1 && [...segs.near(q[0] - apart, q[1] - apart, q[0] + apart, q[1] + apart)].some((o) => { if (o.street === s.k) return false; const ol = dist(o.a, o.b) || 1; return Math.abs(Math.cos(hd) * (o.b[0] - o.a[0]) / ol + Math.sin(hd) * (o.b[1] - o.a[1]) / ol) > 0.75 && nearestOn(q, o.a, o.b).d < apart; })) break;
              pts.push(q); p = q;
            }
            if (pts.length >= 3) { const id = -10 - lanes.length; lanes.push({ pts, id, key: `${s.k}:${spawn}:${side}` }); addSegs(pts, id, u(roadHalf('lane', grid))); }
          }
          walked += spacing * (0.7 + r() * 0.6);
        }
        acc += len;
      }
    }
  }

  const buildings: Pt[][] = [];
  if (!i.buildings) return { lanes: lanes.map((l) => l.pts).filter((pts) => !i.strict || (pts[0]![0] >= i.rect.x && pts[0]![0] < i.rect.x + i.rect.w && pts[0]![1] >= i.rect.y && pts[0]![1] < i.rect.y + i.rect.h)), buildings };

  // Buildings: lots along every street and lane, each street with its own seed. A lot looks
  // straight back from the street to the next one and builds rows up to the middle of the
  // block, so the two sides of a block meet without anything checking against anything
  // else: a lot depends only on the streets, and is the same lot from any view.
  const max = i.max ?? 40000;
  const extent = Math.max(u(500), ...i.urban.map((x) => Math.max(...x.map((q) => dist(q, i.centre)))));
  const look = u(14); const gapRoad = u(0.8); const gapBar = u(3);
  const clear = (p: Pt) => !segs.some(p[0] - look, p[1] - look, p[0] + look, p[1] + look, (o) => segDist(p, o.a, o.b) < o.half + gapRoad)
    && !bar.some(p[0] - look * 2, p[1] - look * 2, p[0] + look * 2, p[1] + look * 2, (b) => segDist(p, b.a, b.b) < b.half + gapBar);
  const quad = (p: Pt, dir: Pt, nor: Pt, off: number, along: number, w: number, d: number): Pt[] => {
    const f: Pt = [p[0] + nor[0] * off + dir[0] * along, p[1] + nor[1] * off + dir[1] * along];
    return [f, [f[0] + dir[0] * w, f[1] + dir[1] * w], [f[0] + dir[0] * w + nor[0] * d, f[1] + dir[1] * w + nor[1] * d], [f[0] + nor[0] * d, f[1] + nor[1] * d]];
  };
  const placedB = new Buckets<Pt[]>(Math.max(2, u(30)));
  const box = (q: Pt[]) => { let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; for (const v of q) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; } return [x0, y0, x1, y1] as const; };
  const usable = (q: Pt[]) => {
    if (!(ground(q[0]!) && ground(q[1]!) && ground(q[2]!) && ground(q[3]!) && clear(q[0]!) && clear(q[1]!) && clear(q[2]!) && clear(q[3]!))) return false;
    const [x0, y0, x1, y1] = box(q);
    return !placedB.some(x0, y0, x1, y1, (o) => overlaps(o, q));
  };
  const place = (q: Pt[]) => { buildings.push(q); const [x0, y0, x1, y1] = box(q); placedB.add(x0, y0, x1, y1, q); };
  /** How far straight back from a point the next street (or the town's edge) is. */
  const maxReach = u(grid ? 220 : 150);
  const reachBack = (from: Pt, nor: Pt, own: number): number => {
    const stepL = Math.max(u(6), cell / 2);
    let hit = maxReach;
    for (let t = stepL; t <= maxReach; t += stepL) {
      const a: Pt = [from[0] + nor[0] * (t - stepL), from[1] + nor[1] * (t - stepL)];
      const b: Pt = [from[0] + nor[0] * t, from[1] + nor[1] * t];
      if (!ground(b)) { hit = t; break; }
      let found = Infinity;
      segs.some(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (o) => {
        if (o.street === own) return false;
        const x = crossAt(a, b, o.a, o.b);
        if (x) found = Math.min(found, dist(from, x) - o.half);
        return false;
      });
      if (found < Infinity) { hit = found; break; }
    }
    return hit;
  };
  const gapBase = [0, 0.32, 0.16, 0.07, 0.035, 0.015][density]!;
  const all = [...near.map((s) => ({ pts: s.pts, half: roadHalf(s.level === 0 ? 'avenue' : 'street', grid), key: String(s.k), id: s.k })), ...lanes.map((l) => ({ pts: l.pts, half: roadHalf('lane', grid), key: l.key, id: l.id }))];
  for (const s of all) {
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
      const r = seeded(hashOf(i.spec.seed, 'lots', s.key, side));
      let d = u(2) + r() * u(4);
      while (d < total - u(3) && buildings.length < max) {
        // Every draw happens whether or not the lot is on screen, so a lot is the same lot wherever you look from.
        const v = [r(), r(), r(), r(), r(), r(), r(), r()];
        const { p, dir } = at(d);
        const lw = u(grid ? 16 + v[0]! * 22 * (density >= 4 ? 1.5 : 1) : 6 + v[0]! * 8);
        const step = lw + u(grid ? 2 + v[1]! * 4 : 0.4 + v[1]! * 1);
        d += step;
        if (i.strict ? !(p[0] >= i.rect.x && p[0] < i.rect.x + i.rect.w && p[1] >= i.rect.y && p[1] < i.rect.y + i.rect.h) : !inRect(p)) continue;
        const nor: Pt = [-dir[1] * side, dir[0] * side];
        const core = 1 - Math.min(1, dist(p, i.centre) / extent);
        if (v[4]! < gapBase + (1 - core) * gapBase * 2.5) continue;
        const off = u(s.half + (grid ? 3 : 0.6 + v[3]! * 0.8));
        // Build to the middle of the block: half the way to the next street behind.
        const mid: Pt = [p[0] + dir[0] * lw * 0.5, p[1] + dir[1] * lw * 0.5];
        const room = reachBack(mid, nor, s.id) / 2 - off - u(1);
        const want = u(grid ? 15 + v[2]! * 20 * (density >= 4 ? 1.4 : 1) : (7 + v[2]! * 9) * (0.85 + core * 0.4));
        let ld = Math.min(want, room);
        if (ld < u(4)) continue;
        // A lot that meets a cross street or a corner is tried narrower.
        let w = lw;
        let front = quad(p, dir, nor, off, 0, w, ld);
        if (!usable(front)) { w = lw * 0.55; ld = Math.min(ld, want * 0.7); front = quad(p, dir, nor, off, 0, w, ld); if (!usable(front)) continue; }
        place(front);
        // Behind the front, more rows into the block, as dense as the town is, up to the middle.
        const rows = grid ? Math.max(0, density - 2) : Math.round(density * (0.4 + core * 0.6)) - 1;
        let depth = off + ld + u(grid ? 3 : 0.8);
        for (let k = 0; k < rows; k++) {
          const d2 = u(grid ? 12 + ((v[7]! + k * 0.53) % 1) * 14 : 5 + ((v[7]! + k * 0.53) % 1) * 7);
          if (depth + d2 > off + Math.max(0, room)) break;
          const w2 = w * (0.6 + ((v[6]! + k * 0.37) % 1) * 0.4);
          const q = quad(p, dir, nor, depth, (w - w2) * ((v[5]! + k * 0.29) % 1), w2, d2);
          if (!usable(q)) break;
          place(q);
          depth += d2 + u(grid ? 3 : 0.8);
        }
      }
    }
  }
  const inTile = (p: Pt) => p[0] >= i.rect.x && p[0] < i.rect.x + i.rect.w && p[1] >= i.rect.y && p[1] < i.rect.y + i.rect.h;
  const shownLanes = lanes.map((l) => l.pts).filter((pts) => (i.strict ? inTile(pts[0]!) : true));
  return { lanes: shownLanes, buildings: i.strict ? buildings : buildings.filter((q) => q.some((p) => p[0] >= i.rect.x - u(20) && p[0] <= i.rect.x + i.rect.w + u(20) && p[1] >= i.rect.y - u(20) && p[1] <= i.rect.y + i.rect.h + u(20))) };
}

function crossesRect(a: Pt, b: Pt, R: { x0: number; y0: number; x1: number; y1: number }): boolean {
  if (Math.max(a[0], b[0]) < R.x0 || Math.min(a[0], b[0]) > R.x1 || Math.max(a[1], b[1]) < R.y0 || Math.min(a[1], b[1]) > R.y1) return false;
  const c: Pt[] = [[R.x0, R.y0], [R.x1, R.y0], [R.x1, R.y1], [R.x0, R.y1]];
  return c.some((p, k) => !!crossAt(a, b, p, c[(k + 1) % 4]!));
}

/** Metres per map unit for a map's scale. */
export const metresPer = (scale: { unit: 'm' | 'km'; per: number }) => scale.per * (scale.unit === 'km' ? 1000 : 1);

/** Lines a town's streets and buildings keep clear of, with their half widths in map units. */
export const BARRIER_HALF: Partial<Record<string, number>> = { river: 9, canal: 6, rail: 4, wall: 4 };

/** Lanes and buildings for part of a town map, from what the map keeps. */
export function fillMap(doc: { town?: TownSpec; scale: { unit: 'm' | 'km'; per: number }; areas: { kind: string; points: Pt[] }[]; lines: { kind: string; points: Pt[] }[] }, rect: FillInput['rect'], o: { lanes: boolean; buildings: boolean; strict?: boolean }): Fill {
  if (!doc.town) return { lanes: [], buildings: [] };
  const districts = doc.areas.filter((a) => a.kind === 'district');
  const plaza = doc.areas.find((a) => a.kind === 'plaza');
  const centre: Pt = plaza ? [plaza.points.reduce((s, p) => s + p[0], 0) / plaza.points.length, plaza.points.reduce((s, p) => s + p[1], 0) / plaza.points.length] : [500, 350];
  return fillTown({
    spec: doc.town,
    m: metresPer(doc.scale),
    rect,
    lanes: o.lanes,
    buildings: o.buildings,
    strict: o.strict,
    urban: districts.map((a) => a.points),
    open: doc.areas.filter((a) => a.kind === 'water' || a.kind === 'park' || a.kind === 'plaza' || a.kind === 'forest').map((a) => a.points),
    barriers: doc.lines.filter((l) => BARRIER_HALF[l.kind]).map((l) => ({ points: l.points, half: BARRIER_HALF[l.kind]! })),
    network: doc.lines.filter((l) => l.kind === 'avenue' || l.kind === 'street').map((l) => ({ pts: l.points, level: l.kind === 'avenue' ? 0 as const : 1 as const })),
    centre,
  });
}

/** What of a town to draw at a zoom (screen pixels per metre). */
export const townDetail = (pxPerMetre: number, grid = false) => ({ lanes: pxPerMetre >= 0.3, buildings: pxPerMetre >= (grid ? 0.28 : 0.5) });

/** The size of the pieces a town is grown in, in map units: 250 metres. */
export const tileSize = (scale: { unit: 'm' | 'km'; per: number }) => 250 / metresPer(scale);
