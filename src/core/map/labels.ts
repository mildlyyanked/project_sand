import { normName } from '../world/drafts';
import { area as polyArea, bbox, centroid, inside } from './geom';
import type { MapDoc, MapPin } from './types';

/**
 * Where the words on a map go, for one zoom. Everything is sized in screen
 * pixels, so text reads the same whole map or street level. Names belong
 * to what they name: an area's name sits in the area and moves with it, a
 * river's name runs along it, a pin's name sits beside the pin. When names
 * would collide, the more important one wins and the other waits for you
 * to zoom in: cities before towns, big areas before small, the selected
 * thing before everything.
 */
export type PinShape = 'city' | 'town' | 'site' | 'room' | 'mark';

export interface PlacedLabel {
  key: string;
  text: string;
  /** Map units. y is the text baseline. */
  x: number;
  y: number;
  /** Font size in map units. */
  size: number;
  anchor: 'start' | 'middle' | 'end';
  angle: number;
  role: 'pin' | 'area' | 'line' | 'free';
  /** The thing it names. */
  id: string;
  water: boolean;
  bold: boolean;
  /** Letter spacing in map units (large names are spread). */
  spacing: number;
  upper: boolean;
}

export interface LabelOptions {
  /** Screen pixels per map unit. */
  scale: number;
  /** Glyph width as a share of the font size. */
  glyph?: number;
  /** Spread and capitalise large names (old maps); plain sans maps do not. */
  grand?: boolean;
  shapeOf?: (p: MapPin) => PinShape;
  /** Always shown, and placed first. */
  selected?: { type: string; id: string } | null;
  /** The part of the map on screen, in map units: what is off it is skipped. */
  view?: { x: number; y: number; w: number; h: number } | null;
}

export const FREE_PX = { s: 11, m: 14, l: 18 } as const;
export const PIN_PX: Record<PinShape, number> = { city: 14, town: 13, site: 12, room: 12, mark: 12 };
export const MARKER_PX = 8;

interface Box { x0: number; y0: number; x1: number; y1: number }
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The screen box of a label (pixels from the map's origin), rotation included. */
function boxOf(x: number, y: number, w: number, h: number, anchor: 'start' | 'middle' | 'end', angle: number): Box {
  const left = anchor === 'start' ? 0 : anchor === 'middle' ? -w / 2 : -w;
  const corners: [number, number][] = [[left, -h * 0.8], [left + w, -h * 0.8], [left + w, h * 0.25], [left, h * 0.25]];
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a); const s = Math.sin(a);
  const pts = corners.map(([u, v]) => [x + u * c - v * s, y + u * s + v * c] as const);
  return { x0: Math.min(...pts.map((p) => p[0])) - 2, y0: Math.min(...pts.map((p) => p[1])) - 2, x1: Math.max(...pts.map((p) => p[0])) + 2, y1: Math.max(...pts.map((p) => p[1])) + 2 };
}

export function placeLabels(doc: MapDoc, o: LabelOptions): PlacedLabel[] {
  const s = Math.max(0.01, o.scale);
  const glyph = o.glyph ?? 0.6;
  const W = doc.w * s; const H = doc.h * s;
  const taken: Box[] = [];
  const out: PlacedLabel[] = [];
  const shape = o.shapeOf ?? (() => 'mark' as PinShape);
  const sel = o.selected;
  const seen = (x: number, y: number) => !o.view || (x >= o.view.x && x <= o.view.x + o.view.w && y >= o.view.y && y <= o.view.y + o.view.h);
  const V = o.view ? { x0: Math.max(0, o.view.x * s), y0: Math.max(0, o.view.y * s), x1: Math.min(W, (o.view.x + o.view.w) * s), y1: Math.min(H, (o.view.y + o.view.h) * s) } : { x0: 0, y0: 0, x1: W, y1: H };
  const onCanvas = (b: Box) => b.x0 >= V.x0 && b.x1 <= V.x1 && b.y0 >= V.y0 && b.y1 <= V.y1;

  // Pin markers are always drawn: nothing may be written over them.
  for (const p of doc.pins) taken.push({ x0: p.x * s - MARKER_PX, y0: p.y * s - MARKER_PX * 1.6, x1: p.x * s + MARKER_PX, y1: p.y * s + MARKER_PX });

  type Cand = { priority: number; forced: boolean; place: () => boolean };
  const cands: Cand[] = [];
  const width = (text: string, px: number, spacing = 0) => text.length * (px * glyph + spacing);
  const put = (l: Omit<PlacedLabel, 'size' | 'spacing'> & { px: number; spacingPx: number }, b: Box) => {
    taken.push(b);
    const { px, spacingPx, ...rest } = l;
    out.push({ ...rest, size: px / s, spacing: spacingPx / s });
  };

  // Pins: beside the marker, trying right, left, above, below.
  for (const p of doc.pins) {
    const sh = shape(p);
    const forced = sel?.type === 'pin' && sel.id === p.id;
    if (!forced && !seen(p.x, p.y)) continue;
    cands.push({
      priority: forced ? 1e6 : { city: 900, town: 800, site: 700, room: 650, mark: 600 }[sh],
      forced,
      place: () => {
        const px = PIN_PX[sh];
        const w = width(p.name, px);
        const X = p.x * s; const Y = p.y * s;
        const tries: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }[] = [
          { x: X + MARKER_PX + 3, y: Y + px * 0.35, anchor: 'start' },
          { x: X - MARKER_PX - 3, y: Y + px * 0.35, anchor: 'end' },
          { x: X, y: Y - MARKER_PX * 1.6 - 3, anchor: 'middle' },
          { x: X, y: Y + MARKER_PX + px, anchor: 'middle' },
        ];
        for (const t of tries) {
          const b = boxOf(t.x, t.y, w, px * 1.2, t.anchor, 0);
          if (!onCanvas(b)) continue;
          if (taken.some((x) => hits(x, b) && !(x.x0 === X - MARKER_PX && x.y1 === Y + MARKER_PX))) { if (!forced) continue; }
          put({ key: `p${p.id}`, text: p.name, x: t.x / s, y: t.y / s, px, anchor: t.anchor, angle: 0, role: 'pin', id: p.id, water: false, bold: sh === 'city' || sh === 'town', spacingPx: 0, upper: false }, b);
          return true;
        }
        return false;
      },
    });
  }

  // Areas: their name in the middle, as big as the area allows.
  const pinNames = new Set(doc.pins.map((p) => normName(p.name)));
  for (const a of doc.areas) {
    if (!a.name || (a.kind === 'block' && !a.name)) continue;
    // A room or district already named by its pin needs no second name.
    if (pinNames.has(normName(a.name)) && doc.pins.some((p) => normName(p.name) === normName(a.name!) && inside([p.x, p.y], a.points))) continue;
    const forced = sel?.type === 'area' && sel.id === a.id;
    const c = centroid(a.points);
    const at = inside(c, a.points) ? c : a.points[0]!;
    if (!forced && !seen(at[0], at[1])) continue;
    const b = bbox(a.points);
    const areaPx = polyArea(a.points) * s * s;
    cands.push({
      priority: forced ? 1e6 : 300 + Math.min(600, Math.sqrt(areaPx) * 2),
      forced,
      place: () => {
        const big = Math.sqrt(areaPx);
        let px = Math.max(10, Math.min(20, big / 7));
        const grand = !!o.grand && px >= 15;
        const text = grand ? a.name!.toUpperCase() : a.name!;
        let spacingPx = grand ? px * 0.25 : 0;
        // Shrink to fit the area's width; if it cannot fit at the smallest size, wait for a closer zoom.
        while (px > 10 && width(text, px, spacingPx) > b.w * s * 1.05) { px -= 1; spacingPx = grand ? px * 0.25 : 0; }
        const w = width(text, px, spacingPx);
        if (!forced && w > b.w * s * 1.3) return false;
        let X = at[0] * s;
        X = Math.max(V.x0 + w / 2 + 4, Math.min(V.x1 - w / 2 - 4, X));
        const Y = Math.max(V.y0 + px + 4, Math.min(V.y1 - 6, at[1] * s + px * 0.35));
        const box = boxOf(X, Y, w, px * 1.2, 'middle', 0);
        if (!forced && taken.some((x) => hits(x, box))) return false;
        put({ key: `a${a.id}`, text, x: X / s, y: Y / s, px, anchor: 'middle', angle: 0, role: 'area', id: a.id, water: a.kind === 'water', bold: px >= 13, spacingPx, upper: grand }, box);
        return true;
      },
    });
  }

  // Lines: along their longest stretch on screen.
  for (const l of doc.lines) {
    if (!l.name || l.kind === 'door' || l.points.length < 2) continue;
    const forced = sel?.type === 'line' && sel.id === l.id;
    let best = 0; let bl = -1;
    for (let i = 0; i < l.points.length - 1; i++) {
      const p = l.points[i]!; const q = l.points[i + 1]!;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > bl && seen((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) { bl = d; best = i; }
    }
    if (bl < 0 && !forced) continue;
    // A smoothed line has many short segments: measure along a few of them together.
    const from = l.points[Math.max(0, best - 2)]!; const to = l.points[Math.min(l.points.length - 1, best + 3)]!;
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]) * s;
    cands.push({
      priority: forced ? 1e6 : 200 + Math.min(200, len / 10),
      forced,
      place: () => {
        const px = 11;
        const w = width(l.name!, px);
        if (!forced && w > len * 1.1) return false;
        let angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        const on = l.points[best]!; const nx = l.points[best + 1] ?? on;
        const X = ((on[0] + nx[0]) / 2) * s; const Y = ((on[1] + nx[1]) / 2) * s - 5;
        const box = boxOf(X, Y, w, px * 1.2, 'middle', angle);
        if (!forced && (taken.some((x) => hits(x, box)) || !onCanvas(box))) return false;
        put({ key: `l${l.id}`, text: l.name!, x: X / s, y: Y / s, px, anchor: 'middle', angle: Math.round(angle), role: 'line', id: l.id, water: l.kind === 'river' || l.kind === 'canal', bold: false, spacingPx: 0, upper: false }, box);
        return true;
      },
    });
  }

  // Free labels: written where they were put.
  for (const f of doc.labels) {
    const forced = sel?.type === 'label' && sel.id === f.id;
    if (!forced && !seen(f.x, f.y)) continue;
    cands.push({
      priority: forced ? 1e6 : { s: 250, m: 450, l: 550 }[f.size],
      forced,
      place: () => {
        const px = FREE_PX[f.size];
        const grand = !!o.grand && f.size === 'l';
        const text = grand ? f.text.toUpperCase() : f.text;
        const spacingPx = grand ? px * 0.25 : 0;
        const w = width(text, px, spacingPx);
        let X = f.x * s;
        if (!f.angle) X = Math.max(V.x0 + w / 2 + 4, Math.min(V.x1 - w / 2 - 4, X));
        const Y = Math.max(V.y0 + px + 4, Math.min(V.y1 - 6, f.y * s));
        const box = boxOf(X, Y, w, px * 1.2, 'middle', f.angle ?? 0);
        if (!forced && taken.some((x) => hits(x, box))) return false;
        put({ key: `t${f.id}`, text, x: X / s, y: Y / s, px, anchor: 'middle', angle: f.angle ?? 0, role: 'free', id: f.id, water: !!f.water, bold: f.size !== 's', spacingPx, upper: grand }, box);
        return true;
      },
    });
  }

  for (const c of cands.sort((a, b) => b.priority - a.priority)) c.place();
  return out;
}

/** Labels that only repeat the name of an area, a line or a pin: older maps stored them; names now travel with what they name. */
export function dropEchoLabels(doc: MapDoc): MapDoc {
  const names = new Set([...doc.areas, ...doc.lines].map((x) => (x.name ? normName(x.name) : '')).filter(Boolean));
  for (const p of doc.pins) names.add(normName(p.name));
  const labels = doc.labels.filter((l) => !names.has(normName(l.text)));
  return labels.length === doc.labels.length ? doc : { ...doc, labels };
}

/** How big a free label is on screen, for hit testing, in map units. */
export const labelSize = (size: 's' | 'm' | 'l', scale: number) => FREE_PX[size] / Math.max(0.01, scale);
