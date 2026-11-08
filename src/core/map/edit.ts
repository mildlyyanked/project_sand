import { marksFor } from './build';
import { dist, inside, toPolyline, toSegment } from './geom';
import type { AreaKind, LineKind, MapArea, MapDoc, MapLabel, MapLine, MapPin, Pt } from './types';

/**
 * Editing a map by hand: what a touch lands on, and every change the editor
 * can make, each returning a new map. Areas keep their decoration in step
 * with their shape.
 */
export type SelType = 'pin' | 'area' | 'line' | 'label';
export interface Sel { type: SelType; id: string }
export interface Hit extends Sel { vertex?: number; mid?: number }

const LABEL_SIZE = { s: 13, m: 18, l: 26 } as const;

/** What is under a point, nearest first in importance: handles of the selection, pins, labels, lines, areas (smallest first). */
export function hitTest(doc: MapDoc, p: Pt, tol: number, selected?: Sel | null, o: { areas?: boolean } = {}): Hit | null {
  if (selected && (selected.type === 'area' || selected.type === 'line')) {
    const pts = selected.type === 'area' ? doc.areas.find((a) => a.id === selected.id)?.points : doc.lines.find((l) => l.id === selected.id)?.points;
    if (pts) {
      let best = -1; let bd = tol * 1.3;
      pts.forEach((q, i) => { const d = dist(p, q); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) return { ...selected, vertex: best };
      const closed = selected.type === 'area';
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
        const a = pts[i]!; const b = pts[(i + 1) % pts.length]!;
        if (dist(p, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) < tol) return { ...selected, mid: i };
      }
    }
  }
  let pin: MapPin | null = null; let pd = tol * 1.4;
  for (const x of doc.pins) { const d = dist(p, [x.x, x.y]); if (d < pd) { pd = d; pin = x; } }
  if (pin) return { type: 'pin', id: pin.id };
  for (const l of doc.labels) {
    const s = LABEL_SIZE[l.size];
    const w = l.text.length * s * 0.33 + tol * 0.5;
    if (Math.abs(p[0] - l.x) < w && p[1] < l.y + tol * 0.5 && p[1] > l.y - s - tol * 0.5) return { type: 'label', id: l.id };
  }
  let line: MapLine | null = null; let ld = tol;
  for (const l of doc.lines) { const d = toPolyline(p, l.points, false); if (d < ld) { ld = d; line = l; } }
  if (line) return { type: 'line', id: line.id };
  if (o.areas === false) return null;
  const under = doc.areas.filter((a) => inside(p, a.points));
  if (!under.length) return null;
  // The smallest area under the finger is the one meant: the room, not the house; the lake, not the land.
  const size = (a: MapArea) => { let s = 0; for (let i = 0, j = a.points.length - 1; i < a.points.length; j = i++) s += (a.points[j]![0] + a.points[i]![0]) * (a.points[j]![1] - a.points[i]![1]); return Math.abs(s); };
  const a = under.sort((x, y) => size(x) - size(y))[0]!;
  return { type: 'area', id: a.id };
}

const withMarks = (a: MapArea, seed: number): MapArea => {
  const m = marksFor(a.kind, a.points, seed);
  const { marks: _old, ...rest } = a;
  return m ? { ...rest, marks: m } : rest;
};

const mapAreas = (doc: MapDoc, id: string, f: (a: MapArea) => MapArea): MapDoc => ({ ...doc, areas: doc.areas.map((a) => (a.id === id ? withMarks(f(a), doc.seed + a.points.length) : a)) });
const mapLines = (doc: MapDoc, id: string, f: (l: MapLine) => MapLine): MapDoc => ({ ...doc, lines: doc.lines.map((l) => (l.id === id ? f(l) : l)) });

export function pointsOf(doc: MapDoc, s: Sel): Pt[] | null {
  if (s.type === 'area') return doc.areas.find((a) => a.id === s.id)?.points ?? null;
  if (s.type === 'line') return doc.lines.find((l) => l.id === s.id)?.points ?? null;
  return null;
}

export function setPoints(doc: MapDoc, s: Sel, pts: Pt[]): MapDoc {
  if (s.type === 'area') return mapAreas(doc, s.id, (a) => ({ ...a, points: pts }));
  if (s.type === 'line') return mapLines(doc, s.id, (l) => ({ ...l, points: pts }));
  return doc;
}

export function moveVertex(doc: MapDoc, s: Sel, i: number, to: Pt): MapDoc {
  const pts = pointsOf(doc, s);
  if (!pts || !pts[i]) return doc;
  return setPoints(doc, s, pts.map((p, k) => (k === i ? to : p)));
}

/** Split an edge at its middle; returns the map and the new vertex's index. */
export function insertVertex(doc: MapDoc, s: Sel, edge: number, at?: Pt): { doc: MapDoc; index: number } {
  const pts = pointsOf(doc, s);
  if (!pts) return { doc, index: -1 };
  const a = pts[edge]!; const b = pts[(edge + 1) % pts.length]!;
  const p: Pt = at ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const next = [...pts.slice(0, edge + 1), p, ...pts.slice(edge + 1)];
  return { doc: setPoints(doc, s, next), index: edge + 1 };
}

/** Remove a vertex, keeping at least a triangle (area) or a segment (line). */
export function deleteVertex(doc: MapDoc, s: Sel, i: number): MapDoc {
  const pts = pointsOf(doc, s);
  if (!pts || pts.length <= (s.type === 'area' ? 3 : 2)) return doc;
  return setPoints(doc, s, pts.filter((_, k) => k !== i));
}

/** Move a whole thing by an offset. */
export function moveBy(doc: MapDoc, s: Sel, dx: number, dy: number): MapDoc {
  switch (s.type) {
    case 'pin': return { ...doc, pins: doc.pins.map((p) => (p.id === s.id ? { ...p, x: p.x + dx, y: p.y + dy } : p)) };
    case 'label': return { ...doc, labels: doc.labels.map((l) => (l.id === s.id ? { ...l, x: l.x + dx, y: l.y + dy } : l)) };
    case 'area': return { ...doc, areas: doc.areas.map((a) => (a.id === s.id ? { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as Pt), marks: a.marks?.map(([x, y]) => [x + dx, y + dy] as Pt) } : a)) };
    case 'line': return mapLines(doc, s.id, (l) => ({ ...l, points: l.points.map(([x, y]) => [x + dx, y + dy] as Pt) }));
  }
}

export function moveTo(doc: MapDoc, s: Sel, at: Pt): MapDoc {
  if (s.type === 'pin') return { ...doc, pins: doc.pins.map((p) => (p.id === s.id ? { ...p, x: at[0], y: at[1] } : p)) };
  if (s.type === 'label') return { ...doc, labels: doc.labels.map((l) => (l.id === s.id ? { ...l, x: at[0], y: at[1] } : l)) };
  return doc;
}

export function remove(doc: MapDoc, s: Sel): MapDoc {
  switch (s.type) {
    case 'pin': return { ...doc, pins: doc.pins.filter((p) => p.id !== s.id) };
    case 'label': return { ...doc, labels: doc.labels.filter((l) => l.id !== s.id) };
    case 'area': return { ...doc, areas: doc.areas.filter((a) => a.id !== s.id) };
    case 'line': return { ...doc, lines: doc.lines.filter((l) => l.id !== s.id) };
  }
}

/** Duplicate a thing a little down and to the right; returns the copy's selection. */
export function duplicate(doc: MapDoc, s: Sel, newId: string): { doc: MapDoc; sel: Sel } {
  const off = 24;
  if (s.type === 'area') { const a = doc.areas.find((x) => x.id === s.id); if (a) return { doc: { ...doc, areas: [...doc.areas, { ...a, id: newId, points: a.points.map(([x, y]) => [x + off, y + off] as Pt), marks: a.marks?.map(([x, y]) => [x + off, y + off] as Pt) }] }, sel: { type: 'area', id: newId } }; }
  if (s.type === 'line') { const l = doc.lines.find((x) => x.id === s.id); if (l) return { doc: { ...doc, lines: [...doc.lines, { ...l, id: newId, points: l.points.map(([x, y]) => [x + off, y + off] as Pt) }] }, sel: { type: 'line', id: newId } }; }
  if (s.type === 'label') { const l = doc.labels.find((x) => x.id === s.id); if (l) return { doc: { ...doc, labels: [...doc.labels, { ...l, id: newId, x: l.x + off, y: l.y + off }] }, sel: { type: 'label', id: newId } }; }
  return { doc, sel: s };
}

export const addArea = (doc: MapDoc, a: Omit<MapArea, 'marks'>): MapDoc => ({ ...doc, areas: [...doc.areas, withMarks(a, doc.seed + doc.areas.length)] });
export const addLine = (doc: MapDoc, l: MapLine): MapDoc => ({ ...doc, lines: [...doc.lines, l] });
export const addPin = (doc: MapDoc, p: MapPin): MapDoc => ({ ...doc, pins: [...doc.pins, p] });
export const addLabel = (doc: MapDoc, l: MapLabel): MapDoc => ({ ...doc, labels: [...doc.labels, l] });

export function setAreaKind(doc: MapDoc, id: string, kind: AreaKind): MapDoc { return mapAreas(doc, id, (a) => ({ ...a, kind })); }
export function setLineKind(doc: MapDoc, id: string, kind: LineKind): MapDoc { return mapLines(doc, id, (l) => ({ ...l, kind })); }
export function rename(doc: MapDoc, s: Sel, name: string): MapDoc {
  switch (s.type) {
    case 'pin': return { ...doc, pins: doc.pins.map((p) => (p.id === s.id ? { ...p, name } : p)) };
    case 'label': return { ...doc, labels: doc.labels.map((l) => (l.id === s.id ? { ...l, text: name } : l)) };
    case 'area': return { ...doc, areas: doc.areas.map((a) => (a.id === s.id ? { ...a, name: name || undefined } : a)) };
    case 'line': return mapLines(doc, s.id, (l) => ({ ...l, name: name || undefined }));
  }
}
export function patchLabel(doc: MapDoc, id: string, p: Partial<MapLabel>): MapDoc { return { ...doc, labels: doc.labels.map((l) => (l.id === id ? { ...l, ...p } : l)) }; }
export function linkPin(doc: MapDoc, id: string, entityId: string | null, name?: string): MapDoc { return { ...doc, pins: doc.pins.map((p) => (p.id === id ? { ...p, entityId, name: name ?? p.name } : p)) }; }

/** Bring forward or send back within its own layer (areas of a kind draw in list order). */
export function reorder(doc: MapDoc, s: Sel, dir: 1 | -1): MapDoc {
  const move = <T extends { id: string }>(xs: T[]) => {
    const i = xs.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= xs.length) return xs;
    const out = [...xs];
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  };
  if (s.type === 'area') return { ...doc, areas: move(doc.areas) };
  if (s.type === 'line') return { ...doc, lines: move(doc.lines) };
  return doc;
}

/** Snap a point to a grid (floor plans); free elsewhere. */
export const snapTo = (p: Pt, step: number): Pt => (step > 0 ? [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step] : p);

/** Nearest point on any edge of the selection: where a tap on an edge adds a vertex. */
export function nearestEdge(pts: Pt[], p: Pt, closed: boolean): { edge: number; d: number } {
  let edge = -1; let d = Infinity;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const e = toSegment(p, pts[i]!, pts[(i + 1) % pts.length]!); if (e < d) { d = e; edge = i; } }
  return { edge, d };
}

/** A bounded undo history. */
export interface History { past: MapDoc[]; future: MapDoc[] }
export const pushHistory = (h: History, before: MapDoc, max = 60): History => ({ past: [...h.past.slice(-(max - 1)), before], future: [] });
export function undo(h: History, now: MapDoc): { h: History; doc: MapDoc } | null {
  const prev = h.past[h.past.length - 1];
  return prev ? { h: { past: h.past.slice(0, -1), future: [now, ...h.future] }, doc: prev } : null;
}
export function redo(h: History, now: MapDoc): { h: History; doc: MapDoc } | null {
  const next = h.future[0];
  return next ? { h: { past: [...h.past, now], future: h.future.slice(1) }, doc: next } : null;
}
