import { curveOf, pathOf } from './geom';
import { mercY } from './geo';
import type { AreaKind, LineKind, MapArea, MapDoc, MapKind, Pt } from './types';
import type { MapTheme } from './style';

/**
 * Drawing instructions for a map, as SVG path strings and stroke settings:
 * everything the renderer needs and nothing it has to work out. Many small
 * shapes of a kind (a city's blocks, a forest's trees) go into one path, so
 * a city of a thousand buildings is a handful of elements.
 */

const ORGANIC = new Set<AreaKind>(['land', 'water', 'forest', 'mountains', 'hills', 'desert', 'swamp', 'ice', 'farmland', 'park']);
/** An area's outline: soft for nature, straight for anything built. */
export const areaPath = (a: Pick<MapArea, 'kind' | 'points'>) => (ORGANIC.has(a.kind) ? curveOf(a.points, true) : pathOf(a.points, true));

/** Layer order: ground first, then terrain, then what people built, then rooms. */
const RANK: Record<AreaKind, number> = { land: 0, water: 0, ice: 1, desert: 2, farmland: 2, swamp: 3, hills: 3, forest: 4, mountains: 5, district: 6, park: 7, plaza: 7, yard: 7, block: 8, hall: 9, room: 9 };
export const areaRank = (k: AreaKind) => RANK[k];

export function areaFill(t: MapTheme, k: AreaKind): string {
  switch (k) {
    case 'land': return t.land;
    case 'water': return t.water;
    case 'forest': return t.forest;
    case 'mountains': return t.mountain;
    case 'hills': return t.hills;
    case 'desert': return t.desert;
    case 'swamp': return t.swamp;
    case 'ice': return t.ice;
    case 'farmland': return t.farmland;
    case 'district': return t.district;
    case 'park': return t.park;
    case 'plaza': return t.plaza;
    case 'block': return t.block;
    case 'room': return t.room;
    case 'hall': return t.hall;
    case 'yard': return t.plaza;
  }
}

/** The little drawings inside an area: trees, peaks, tufts, furrows, dots. One path per area. */
export function marksPath(kind: AreaKind, marks: Pt[], drawn: boolean): string {
  const f = (n: number) => n.toFixed(1);
  let d = '';
  for (const [x, y] of marks) {
    switch (kind) {
      case 'forest':
        d += drawn
          ? `M${f(x - 5)} ${f(y + 2)}Q${f(x - 6)} ${f(y - 7)} ${f(x)} ${f(y - 8)}Q${f(x + 6)} ${f(y - 7)} ${f(x + 5)} ${f(y + 2)}ZM${f(x)} ${f(y + 2)}L${f(x)} ${f(y + 5)}`
          : `M${f(x - 4)} ${f(y)}a4 4 0 1 0 8 0a4 4 0 1 0 -8 0`;
        break;
      case 'mountains':
        d += `M${f(x - 13)} ${f(y + 7)}L${f(x - 2)} ${f(y - 11)}L${f(x + 4)} ${f(y - 2)}L${f(x + 7)} ${f(y - 6)}L${f(x + 14)} ${f(y + 7)}`;
        break;
      case 'hills':
        d += `M${f(x - 10)} ${f(y + 3)}Q${f(x)} ${f(y - 9)} ${f(x + 10)} ${f(y + 3)}`;
        break;
      case 'swamp':
        d += `M${f(x - 5)} ${f(y)}L${f(x + 5)} ${f(y)}M${f(x - 2)} ${f(y)}L${f(x - 4)} ${f(y - 5)}M${f(x)} ${f(y)}L${f(x)} ${f(y - 6)}M${f(x + 2)} ${f(y)}L${f(x + 4)} ${f(y - 5)}`;
        break;
      case 'desert':
        d += `M${f(x - 6)} ${f(y)}Q${f(x - 3)} ${f(y - 3)} ${f(x)} ${f(y)}Q${f(x + 3)} ${f(y + 3)} ${f(x + 6)} ${f(y)}`;
        break;
      case 'farmland':
        d += `M${f(x - 9)} ${f(y - 4)}L${f(x + 9)} ${f(y - 4)}M${f(x - 9)} ${f(y)}L${f(x + 9)} ${f(y)}M${f(x - 9)} ${f(y + 4)}L${f(x + 9)} ${f(y + 4)}`;
        break;
      default:
    }
  }
  return d;
}

/** Whether a kind's marks are filled shapes (trees in drawn styles) or strokes. */
export const marksFilled = (kind: AreaKind, drawn: boolean) => kind === 'forest';

export interface Stroke { color: string; width: number; dash?: string; opacity?: number; cap?: 'round' | 'butt' | 'square' }

const W: Record<MapKind, number> = { globe: 0.7, region: 1, city: 1, site: 1.4, floor: 1 };

/** How a line is drawn: under-strokes first (casing, glow), the line itself last. */
export function lineStrokes(t: MapTheme, k: LineKind, kind: MapKind): Stroke[] {
  const s = W[kind];
  const glow = (color: string, width: number): Stroke[] => (t.glow ? [{ color, width: width * 3.2, opacity: 0.16 }] : []);
  switch (k) {
    case 'river': {
      const w = (kind === 'city' ? 14 : kind === 'site' ? 8 : 3.6) * s;
      return [...glow(t.river, w), { color: t.river, width: w, cap: 'round' }];
    }
    case 'canal': {
      const w = (kind === 'city' ? 9 : 3) * s;
      return [{ color: t.coast, width: w + 2, opacity: 0.5, cap: 'butt' }, { color: t.river, width: w, cap: 'butt' }];
    }
    case 'road': {
      const w = 2.6 * s;
      return t.drawn ? [{ color: t.road, width: w, dash: '7 3', cap: 'round' }] : [...glow(t.road, w), { color: t.roadCase, width: w + 2.4, cap: 'round' }, { color: t.road, width: w, cap: 'round' }];
    }
    case 'track': return [{ color: t.road, width: 1.6 * s, dash: '3 4', cap: 'round', opacity: 0.9 }];
    case 'rail': return [...glow(t.rail, 2), { color: t.rail, width: 1.6 * s }, { color: t.rail, width: 6 * s, dash: '1.2 6' }];
    case 'border': return [...glow(t.border, 2.4), { color: t.border, width: 2.4 * s, dash: '12 4 2 4', opacity: 0.85 }];
    case 'wall': {
      const w = (kind === 'region' || kind === 'globe' ? 2.6 : 4.5) * s;
      return [...glow(t.wall, w), { color: t.wall, width: w, cap: 'square' }];
    }
    case 'street': {
      const w = (kind === 'site' ? 12 : 6) * s;
      return [...glow(t.road, w * 0.4), { color: t.roadCase, width: w + 2, cap: 'round' }, { color: t.road, width: w, cap: 'round' }];
    }
    case 'avenue': {
      const w = 10 * s;
      return [...glow(t.road, w * 0.4), { color: t.roadCase, width: w + 3, cap: 'round' }, { color: t.road, width: w, cap: 'round' }];
    }
    case 'corridor': return [{ color: t.wall, width: 36, cap: 'butt' }, { color: t.hall, width: 28, cap: 'butt' }];
    case 'door': return [{ color: t.room, width: 9, cap: 'butt' }];
  }
}

export const linePath = (k: LineKind, pts: Pt[]) => (k === 'river' || k === 'road' || k === 'track' || k === 'border' ? curveOf(pts, false) : pathOf(pts, false));

/** A door's swing: a quarter circle from its hinge, so a plan reads as a plan. */
export function doorSwing(pts: Pt[]): string {
  if (pts.length < 2) return '';
  const [a, b] = [pts[0]!, pts[pts.length - 1]!];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / (len || 1);
  const ny = (b[0] - a[0]) / (len || 1);
  const tip: Pt = [a[0] + nx * len, a[1] + ny * len];
  return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}A${len.toFixed(1)} ${len.toFixed(1)} 0 0 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
}

/** Lines of latitude and longitude on a Mercator globe, every 15° and 30°. */
export function graticule(doc: Pick<MapDoc, 'w' | 'h'>): { d: string; equator: string } {
  let d = '';
  for (let lat = -75; lat <= 75; lat += 15) {
    if (lat === 0) continue;
    const y = mercY(doc, (lat * Math.PI) / 180);
    if (y > 0 && y < doc.h) d += `M0 ${y.toFixed(1)}L${doc.w} ${y.toFixed(1)}`;
  }
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = doc.w / 2 + (lon / 360) * doc.w;
    d += `M${x.toFixed(1)} 0L${x.toFixed(1)} ${doc.h}`;
  }
  const eq = mercY(doc, 0).toFixed(1);
  return { d, equator: `M0 ${eq}L${doc.w} ${eq}` };
}

/** A square grid for survey and neon styles. */
export function gridPath(w: number, h: number, step = 50): string {
  let d = '';
  for (let x = step; x < w; x += step) d += `M${x} 0L${x} ${h}`;
  for (let y = step; y < h; y += step) d += `M0 ${y}L${w} ${y}`;
  return d;
}

/** Many polygons as one path (blocks of a city). */
export const multiPath = (areas: Pick<MapArea, 'points'>[]) => areas.map((a) => pathOf(a.points, true)).join('');

/** A compass rose of n points, centred at x, y. */
export function rosePath(x: number, y: number, r: number): { dark: string; light: string } {
  let dark = '';
  let light = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const len = i % 2 ? r * 0.55 : r;
    const tip: Pt = [x + Math.cos(a) * len, y + Math.sin(a) * len];
    const side = (s: number): Pt => [x + Math.cos(a + (s * Math.PI) / 2) * r * 0.14, y + Math.sin(a + (s * Math.PI) / 2) * r * 0.14];
    const [l, rr] = [side(-1), side(1)];
    dark += `M${x.toFixed(1)} ${y.toFixed(1)}L${l[0].toFixed(1)} ${l[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}Z`;
    light += `M${x.toFixed(1)} ${y.toFixed(1)}L${rr[0].toFixed(1)} ${rr[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}Z`;
  }
  return { dark, light };
}

/** The shape a pin is drawn as, from the type of place it stands for. */
export type PinShape = 'city' | 'town' | 'site' | 'room' | 'mark';
export function pinShape(type: string | undefined | null, kind: MapKind): PinShape {
  const t = (type ?? '').toLowerCase();
  if (kind === 'floor' || t === 'room') return 'room';
  if (['city', 'nation', 'continent', 'region', 'province', 'planet', 'realm'].includes(t)) return 'city';
  if (['town', 'village', 'district', 'station'].includes(t)) return 'town';
  if (['building', 'landmark', 'ruin', 'dungeon', 'ship', 'street'].includes(t)) return 'site';
  return 'mark';
}
