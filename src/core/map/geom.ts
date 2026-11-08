import type { Pt } from './types';

/** A seeded generator of numbers in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashOf(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A rough ellipse: the starting shape of a lake, a forest, a district. */
export function blob(cx: number, cy: number, rx: number, ry: number, r: () => number, n = 14, wobble = 0.25): Pt[] {
  const out: Pt[] = [];
  const phase = r() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const k = 1 + (r() - 0.5) * 2 * wobble;
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}

/**
 * Midpoint displacement: each edge is split and its middle pushed sideways
 * by a share of its length, a few times over, which is what makes a
 * coastline look like a coastline instead of a polygon.
 */
export function fractal(points: Pt[], r: () => number, o: { rounds?: number; rough?: number; closed?: boolean } = {}): Pt[] {
  let pts = points;
  const closed = o.closed ?? true;
  for (let k = 0; k < (o.rounds ?? 3); k++) {
    const next: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      next.push(a);
      const len = dist(a, b);
      const off = (r() - 0.5) * len * (o.rough ?? 0.35);
      const nx = -(b[1] - a[1]) / (len || 1);
      const ny = (b[0] - a[0]) / (len || 1);
      next.push([(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off]);
    }
    if (!closed) next.push(pts[n - 1]!);
    pts = next;
  }
  return pts;
}

/** Chaikin corner cutting: smooth a path (rivers, roads) without moving its ends. */
export function smooth(points: Pt[], rounds = 2, closed = false): Pt[] {
  let pts = points;
  for (let k = 0; k < rounds; k++) {
    if (pts.length < 3) return pts;
    const next: Pt[] = closed ? [] : [pts[0]!];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) next.push(pts[n - 1]!);
    pts = next;
  }
  return pts;
}

/** A path made to wander: the shape of a river between two points. */
export function meander(points: Pt[], r: () => number, rough = 0.18): Pt[] {
  return smooth(fractal(points, r, { rounds: 3, rough, closed: false }), 2);
}

export function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) c = !c;
  }
  return c;
}

export function centroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / (poly.length || 1), y / (poly.length || 1)];
}

export function bbox(poly: Pt[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function area(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  return Math.abs(s / 2);
}

export const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** Distance from a point to a segment, and to a polyline. */
export function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
export function toPolyline(p: Pt, pts: Pt[], closed = false): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) d = Math.min(d, toSegment(p, pts[i]!, pts[(i + 1) % pts.length]!));
  return d;
}

/** Points scattered inside a polygon, about `gap` apart: where trees or peaks are drawn. */
export function scatter(poly: Pt[], gap: number, r: () => number, max = 160): Pt[] {
  const b = bbox(poly);
  const out: Pt[] = [];
  for (let y = b.y + gap / 2; y < b.y + b.h; y += gap) {
    for (let x = b.x + gap / 2; x < b.x + b.w; x += gap) {
      const p: Pt = [x + (r() - 0.5) * gap * 0.8, y + (r() - 0.5) * gap * 0.8];
      if (inside(p, poly)) out.push(p);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Minimum spanning tree over points (Prim): the roads a region needs to join its places. */
export function spanningTree(pts: Pt[]): [number, number][] {
  if (pts.length < 2) return [];
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  while (inTree.size < pts.length) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const i of inTree) for (let j = 0; j < pts.length; j++) {
      if (inTree.has(j)) continue;
      const d = dist(pts[i]!, pts[j]!);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (!best) break;
    edges.push(best);
    inTree.add(best[1]);
  }
  return edges;
}

/** An SVG path for a polygon or a polyline. */
export function pathOf(pts: Pt[], closed: boolean): string {
  if (!pts.length) return '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  return closed ? `${d}Z` : d;
}

/**
 * A smooth SVG path through every point (Catmull-Rom as cubic Béziers):
 * soft coasts and rivers that still pass exactly through the points you
 * drag in the editor.
 */
export function curveOf(pts: Pt[], closed: boolean): string {
  if (pts.length < 3) return pathOf(pts, closed);
  const n = pts.length;
  const at = (i: number): Pt => (closed ? pts[((i % n) + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}
