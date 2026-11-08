import { normName } from '../world/drafts';
import { area, bbox, blob, centroid, clamp, dist, fractal, inside, meander, rect, scatter, seeded, smooth, spanningTree } from './geom';
import type { MapPlan, PlanFeature } from './plan';
import { KIND_INFO } from './style';
import { BARRIER_HALF, growStreets, hull, metresPer, tile, type Density, type TownSpec } from './town';
import { MAP_H, MAP_W, type AreaKind, type LineKind, type MapArea, type MapDoc, type MapKind, type MapLabel, type MapLine, type MapPin, type MapScale, type Pt, type ThemeKey } from './types';

/**
 * From a plan to a map. The plan places things; this gives them shape: a
 * fractal coast, a river that wanders, forests filled with trees, a city cut
 * into blocks by its streets, a building cut into rooms with doors between
 * them. Same plan and seed, same map. Whatever the plan leaves out is
 * invented here, so a map can be drawn with no model at all.
 */
export interface BuildChild { id: string; name: string; type?: string }
export interface BuildCtx {
  locationId: string;
  universeId: string;
  kind: MapKind;
  theme: ThemeKey;
  title: string;
  children: BuildChild[];
  seed: number;
  now: number;
  /** Pins that stay where they are: a redraw that keeps the places. */
  keepPins?: MapPin[];
}

const S = 10; // plan grid → map units
const AREA_KINDS = new Set<string>(['land', 'water', 'forest', 'mountains', 'hills', 'desert', 'swamp', 'ice', 'farmland', 'district', 'park', 'plaza', 'block', 'room', 'hall', 'yard']);
export const isAreaKind = (k: string): k is AreaKind => AREA_KINDS.has(k);

/** How far each kind of map reaches, west edge to east edge, and what a plan's number means. */
const SPAN: Record<MapKind, { unit: 'm' | 'km'; min: number; max: number; def: number }> = {
  globe: { unit: 'km', min: 2000, max: 400000, def: 40000 },
  region: { unit: 'km', min: 2, max: 6000, def: 120 },
  city: { unit: 'm', min: 200, max: 80000, def: 3000 },
  site: { unit: 'm', min: 20, max: 6000, def: 400 },
  floor: { unit: 'm', min: 4, max: 1000, def: 30 },
};

export function scaleOf(kind: MapKind, across: number | null): MapScale {
  const s = SPAN[kind];
  let a = across ?? s.def;
  // Models mix units up: a city "3" across is 3 km, a region "40000" across is metres.
  if (s.unit === 'm' && a < s.min && a * 1000 >= s.min) a *= 1000;
  if (s.unit === 'km' && kind === 'region' && a > s.max && a / 1000 <= s.max) a /= 1000;
  a = clamp(a, s.min, s.max);
  return { unit: s.unit, per: a / MAP_W };
}

/** Marks drawn inside an area (trees, peaks, tufts), roughly this far apart in map units. */
const MARK_GAP: Partial<Record<AreaKind, number>> = { forest: 15, mountains: 30, hills: 34, swamp: 20, desert: 30, farmland: 26 };

export function marksFor(kind: AreaKind, points: Pt[], seed: number): Pt[] | undefined {
  const gap = MARK_GAP[kind];
  return gap ? scatter(points, gap, seeded(seed), 220) : undefined;
}

type R = () => number;

class Ids {
  private n = 0;
  next(p: string) { this.n += 1; return `${p}${this.n.toString(36)}`; }
}

const box = (f: PlanFeature) => ({ cx: (f.x ?? 50) * S, cy: (f.y ?? 35) * S, w: (f.w ?? 12) * S, h: (f.h ?? 9) * S });
const scaled = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x * S, y * S]);

/** An organic area from a box or a sketch. */
function organic(f: PlanFeature, r: R, rough = 0.32, rounds = 3): Pt[] {
  if (f.points && f.points.length >= 3) return fractal(scaled(f.points), r, { rounds, rough });
  const b = box(f);
  return fractal(blob(b.cx, b.cy, b.w / 2, b.h / 2, r, 12, 0.22), r, { rounds, rough });
}

/** A sea on one side of the map, with a coastline worth looking at. */
function seaOn(side: string, r: R): Pt[] | null {
  const depth = 140 + r() * 120;
  const coast = (a: Pt, b: Pt) => fractal([a, [(a[0] + b[0]) / 2 + (r() - 0.5) * 120, (a[1] + b[1]) / 2 + (r() - 0.5) * 120], b], r, { rounds: 5, rough: 0.45, closed: false });
  const o = 40;
  switch (side) {
    case 'west': return [[-o, -o], ...coast([depth, -o], [depth + (r() - 0.5) * 80, MAP_H + o]), [-o, MAP_H + o]];
    case 'east': return [[MAP_W + o, MAP_H + o], ...coast([MAP_W - depth, MAP_H + o], [MAP_W - depth + (r() - 0.5) * 80, -o]), [MAP_W + o, -o]];
    case 'north': return [[MAP_W + o, -o], ...coast([MAP_W + o, depth * 0.8], [-o, depth * 0.8 + (r() - 0.5) * 60]), [-o, -o]];
    case 'south': return [[-o, MAP_H + o], ...coast([-o, MAP_H - depth * 0.8], [MAP_W + o, MAP_H - depth * 0.8 + (r() - 0.5) * 60]), [MAP_W + o, MAP_H + o]];
    default: return null;
  }
}

/** Is a point on dry land, given the ground and the water and land drawn on it? */
export function onLand(p: Pt, ground: 'land' | 'water', areas: MapArea[]): boolean {
  let land = ground === 'land';
  const layers = areas.filter((a) => a.kind === 'land' || a.kind === 'water').sort((a, b) => area(b.points) - area(a.points));
  for (const a of layers) if (inside(p, a.points)) land = a.kind === 'land';
  return land;
}

/** The emptiest good spot: away from every pin, where `ok` says a place can stand. */
function freeSpot(r: R, taken: Pt[], ok: (p: Pt) => boolean, margin = 70): Pt {
  let best: Pt | null = null;
  let bestD = -1;
  for (let i = 0; i < 80; i++) {
    const p: Pt = [margin + r() * (MAP_W - 2 * margin), margin + r() * (MAP_H - 2 * margin)];
    if (!ok(p)) continue;
    const d = taken.length ? Math.min(...taken.map((t) => dist(t, p))) : 1000;
    if (d > bestD) { bestD = d; best = p; }
  }
  return best ?? [MAP_W / 2 + (r() - 0.5) * 200, MAP_H / 2 + (r() - 0.5) * 200];
}

/** Terrain a region needs when the plan gives too little. */
function autoTerrain(kind: MapKind, r: R, have: Set<string>): PlanFeature[] {
  const out: PlanFeature[] = [];
  const at = () => ({ x: 12 + r() * 76, y: 10 + r() * 50 });
  if (kind === 'globe') {
    const n = 3 + Math.floor(r() * 3);
    if (!have.has('land')) for (let i = 0; i < n; i++) { const c = at(); out.push({ kind: 'land', ...c, w: 14 + r() * 22, h: 10 + r() * 18 }); }
    return out;
  }
  if (!have.has('forest')) for (let i = 0; i < 2 + Math.floor(r() * 3); i++) out.push({ kind: 'forest', ...at(), w: 8 + r() * 16, h: 6 + r() * 12 });
  if (!have.has('mountains') && r() < 0.75) out.push({ kind: 'mountains', ...at(), w: 18 + r() * 14, h: 6 + r() * 6 });
  if (!have.has('hills')) out.push({ kind: 'hills', ...at(), w: 10 + r() * 12, h: 8 + r() * 8 });
  if (!have.has('farmland') && r() < 0.6) out.push({ kind: 'farmland', ...at(), w: 10 + r() * 10, h: 6 + r() * 8 });
  if (!have.has('water') && r() < 0.5) out.push({ kind: 'water', ...at(), w: 5 + r() * 6, h: 3 + r() * 4 });
  return out;
}

const DISTRICT_NAMES: Record<ThemeKey, string[]> = {
  fantasy: ['Old Town', 'Market Ward', 'Temple Hill', 'Tanners\' Row', 'Riverside', 'Castle Ward', 'Lantern Quarter'],
  ancient: ['Acropolis', 'Agora', 'Potters\' Quarter', 'Harbour Ward', 'Necropolis', 'Palace Ward', 'Fishers\' Row'],
  modern: ['Downtown', 'Old Town', 'Harbourside', 'Northside', 'The Flats', 'University District', 'Westgate'],
  scifi: ['Hab Ring A', 'Spinward Hab', 'Hydroponics', 'Docks', 'Admin Core', 'Fabrication', 'Commons'],
  cyberpunk: ['Neon Mile', 'Corpo Plaza', 'The Stacks', 'Night Market', 'Old Port', 'Chrome Heights', 'Undercity'],
  steampunk: ['Foundry Row', 'Brassworks', 'Aerodrome', 'Gaslight Ward', 'Canal End', 'Guildhall', 'Smokestack'],
  postapoc: ['The Crater', 'Scrapyard', 'Old Mall', 'Water Works', 'The Wall', 'Market Tents', 'Overpass'],
  gothic: ['Cathedral Close', 'Gallows Hill', 'Old Quarter', 'Riverside', 'Bone Market', 'Lamplighters', 'The Rookery'],
};
const ROOM_NAMES: Record<ThemeKey, string[]> = {
  fantasy: ['Hall', 'Kitchen', 'Larder', 'Parlour', 'Chamber', 'Store', 'Chapel', 'Study'],
  ancient: ['Atrium', 'Kitchen', 'Storeroom', 'Shrine', 'Bedchamber', 'Courtyard', 'Granary', 'Dining room'],
  modern: ['Lobby', 'Kitchen', 'Office', 'Living room', 'Bedroom', 'Bathroom', 'Storage', 'Meeting room'],
  scifi: ['Airlock', 'Ops', 'Galley', 'Bunks', 'Engineering', 'Med bay', 'Cargo', 'Lab'],
  cyberpunk: ['Entry', 'Server room', 'Bar', 'Back office', 'Clinic', 'Storage', 'Lounge', 'Crash room'],
  steampunk: ['Foyer', 'Boiler room', 'Workshop', 'Drawing room', 'Study', 'Scullery', 'Gallery', 'Store'],
  postapoc: ['Entry', 'Bunkroom', 'Stores', 'Workshop', 'Kitchen', 'Lookout', 'Infirmary', 'Cache'],
  gothic: ['Great hall', 'Chapel', 'Library', 'Crypt stair', 'Kitchen', 'Bedchamber', 'Gallery', 'Study'],
};

const typed = (ctx: BuildCtx, re: RegExp) => ctx.children.filter((c) => re.test(c.type ?? ''));

/**
 * A building cut into rooms: split the floor in two, then each half, until
 * the rooms are room-sized. Cuts land on a 10-unit grid so walls line up.
 */
function splitRooms(x: number, y: number, w: number, h: number, r: R, depth: number): { x: number; y: number; w: number; h: number }[] {
  const snap = (v: number) => Math.round(v / 10) * 10;
  if (depth <= 0 || (w < 180 && h < 160)) return [{ x, y, w, h }];
  const vertical = w / h > 1.15 || (w / h > 0.85 && r() < 0.5);
  const t = 0.36 + r() * 0.28;
  if (vertical) {
    const c = snap(w * t);
    return [...splitRooms(x, y, c, h, r, depth - 1), ...splitRooms(x + c, y, w - c, h, r, depth - 1)];
  }
  const c = snap(h * t);
  return [...splitRooms(x, y, w, c, r, depth - 1), ...splitRooms(x, y + c, w, h - c, r, depth - 1)];
}

/** Doors between rooms that share a wall: enough that every room can be reached, a few more for life. */
function doorsFor(rooms: MapArea[], r: R, ids: Ids, outline: { x: number; y: number; w: number; h: number }): MapLine[] {
  const rb = rooms.map((a) => bbox(a.points));
  const shared: { i: number; j: number; at: [Pt, Pt] }[] = [];
  const tol = 12;
  for (let i = 0; i < rb.length; i++) for (let j = i + 1; j < rb.length; j++) {
    const a = rb[i]!; const b = rb[j]!;
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const half = 9;
    if (oy >= 36 && (Math.abs(a.x + a.w - b.x) <= tol || Math.abs(b.x + b.w - a.x) <= tol)) {
      const x = Math.abs(a.x + a.w - b.x) <= tol ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2;
      const my = Math.max(a.y, b.y) + oy / 2;
      shared.push({ i, j, at: [[x, my - half], [x, my + half]] });
    } else if (ox >= 36 && (Math.abs(a.y + a.h - b.y) <= tol || Math.abs(b.y + b.h - a.y) <= tol)) {
      const y = Math.abs(a.y + a.h - b.y) <= tol ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2;
      const mx = Math.max(a.x, b.x) + ox / 2;
      shared.push({ i, j, at: [[mx - half, y], [mx + half, y]] });
    }
  }
  // Join the rooms like a tree first, so none is shut off; then add a few loops.
  const parent = rb.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const out: MapLine[] = [];
  for (const s of [...shared].sort(() => r() - 0.5)) {
    const a = find(s.i); const b = find(s.j);
    if (a !== b) { parent[a] = b; out.push({ id: ids.next('d'), kind: 'door', points: s.at }); }
    else if (r() < 0.18) out.push({ id: ids.next('d'), kind: 'door', points: s.at });
  }
  // A way in: the room lowest on the plan opens to the outside.
  const bottom = outline.y + outline.h;
  const front = rb.map((b, i) => ({ b, i })).filter(({ b }) => Math.abs(b.y + b.h - bottom) <= tol).sort((p, q) => q.b.w - p.b.w)[0];
  if (front) { const mx = front.b.x + front.b.w / 2; out.push({ id: ids.next('d'), kind: 'door', name: 'Entrance', points: [[mx - 12, bottom], [mx + 12, bottom]] }); }
  return out;
}

/** Keep a label's text on the canvas: roughly as wide as its letters. */
export function fitLabel(l: MapLabel): MapLabel {
  const size = l.size === 'l' ? 26 : l.size === 'm' ? 18 : 13;
  const half = (l.text.length * size * (l.size === 'l' ? 0.85 : 0.6)) / 2 + 16;
  if (!l.angle) l.x = clamp(l.x, Math.min(MAP_W / 2, half), Math.max(MAP_W / 2, MAP_W - half));
  l.y = clamp(l.y, size + 16, MAP_H - 16);
  return l;
}

export function buildMap(plan: MapPlan, ctx: BuildCtx): MapDoc {
  const r = seeded(ctx.seed);
  const ids = new Ids();
  const kind = ctx.kind;
  const allowedAreas = new Set<string>(KIND_INFO[kind].areas);
  const allowedLines = new Set<string>(KIND_INFO[kind].lines);
  const feats: PlanFeature[] = plan.features.filter((f) => (isAreaKind(f.kind) ? allowedAreas.has(f.kind) : allowedLines.has(f.kind)));
  const areas: MapArea[] = [];
  const lines: MapLine[] = [];
  const addArea = (k: AreaKind, points: Pt[], name?: string) => {
    const a: MapArea = { id: ids.next('a'), kind: k, points, ...(name ? { name } : {}) };
    const m = marksFor(k, points, ctx.seed + areas.length * 7919);
    if (m) a.marks = m;
    areas.push(a);
    return a;
  };
  const addLine = (k: LineKind, points: Pt[], name?: string) => { const l: MapLine = { id: ids.next('l'), kind: k, points, ...(name ? { name } : {}) }; lines.push(l); return l; };

  let townSpec: TownSpec | null = null;
  let ground: 'land' | 'water' = kind === 'globe' || plan.sea === 'around' ? 'water' : 'land';

  // ---- Ground and water --------------------------------------------------
  if (kind === 'globe') {
    const have = new Set(feats.map((f) => f.kind));
    const land = [...feats.filter((f) => f.kind === 'land'), ...autoTerrain('globe', r, have)];
    for (const f of land) {
      const b = box(f);
      const shape = f.points && f.points.length >= 3 ? fractal(scaled(f.points), r, { rounds: 4, rough: 0.45 }) : fractal(blob(b.cx, b.cy, b.w / 2, b.h / 2, r, 20, 0.38), r, { rounds: 4, rough: 0.5 });
      addArea('land', shape, f.name);
    }
    // Islands off the coasts, and terrain on the continents when the plan gives none.
    const conts = areas.filter((a) => a.kind === 'land');
    for (let i = 0; i < 4 + Math.floor(r() * 5); i++) {
      const c = conts[Math.floor(r() * conts.length)];
      if (!c) break;
      const e = c.points[Math.floor(r() * c.points.length)]!;
      const [cx, cy] = centroid(c.points);
      const out: Pt = [e[0] + (e[0] - cx) * (0.08 + r() * 0.15), e[1] + (e[1] - cy) * (0.08 + r() * 0.15)];
      addArea('land', fractal(blob(out[0], out[1], 6 + r() * 14, 4 + r() * 10, r, 8, 0.3), r, { rounds: 3, rough: 0.45 }));
    }
    if (!feats.some((f) => f.kind === 'mountains' || f.kind === 'forest' || f.kind === 'desert')) {
      for (const c of conts) {
        const b = bbox(c.points);
        const at = (): Pt | null => { for (let i = 0; i < 30; i++) { const p: Pt = [b.x + r() * b.w, b.y + r() * b.h]; if (inside(p, c.points)) return p; } return null; };
        const m = at(); if (m) { const ang = r() * Math.PI; const len = Math.max(b.w, b.h) * (0.25 + r() * 0.2); feats.push({ kind: 'mountains', x: m[0] / S, y: m[1] / S, w: (Math.abs(Math.cos(ang)) * len + 20) / S, h: (Math.abs(Math.sin(ang)) * len + 20) / S }); }
        const f = at(); if (f) feats.push({ kind: r() < 0.7 ? 'forest' : 'swamp', x: f[0] / S, y: f[1] / S, w: b.w * (0.15 + r() * 0.15) / S, h: b.h * (0.15 + r() * 0.15) / S });
        const d = at(); if (d && Math.abs(d[1] - MAP_H / 2) < 140 && r() < 0.6) feats.push({ kind: 'desert', x: d[0] / S, y: d[1] / S, w: b.w * (0.2 + r() * 0.15) / S, h: b.h * (0.15 + r() * 0.1) / S });
      }
    }
    // Ice at the poles, ragged where it meets the sea.
    const cap = (y: number, top: boolean): Pt[] => {
      const edge = fractal([[-40, y], [MAP_W / 2, y + (r() - 0.5) * 20], [MAP_W + 40, y]], r, { rounds: 5, rough: 0.3, closed: false });
      return top ? [[-40, -40], ...edge, [MAP_W + 40, -40]] : [[-40, MAP_H + 40], ...edge, [MAP_W + 40, MAP_H + 40]];
    };
    addArea('ice', cap(28 + r() * 14, true));
    addArea('ice', cap(MAP_H - 30 - r() * 14, false));
  } else if (kind === 'region' || kind === 'city') {
    if (plan.sea === 'around') {
      addArea('land', fractal(blob(MAP_W / 2, MAP_H / 2, MAP_W * 0.36, MAP_H * 0.36, r, 14, 0.25), r, { rounds: 4, rough: 0.4 }));
    } else if (plan.sea !== 'none') {
      const sea = seaOn(plan.sea, r);
      if (sea) addArea('water', sea);
    }
  }
  if (kind === 'floor') ground = 'land';

  const landAt = (p: Pt) => onLand(p, ground, areas);

  // ---- Planned areas -----------------------------------------------------
  const have = new Set(feats.map((f) => f.kind));
  const planned = kind === 'region' && feats.filter((f) => isAreaKind(f.kind)).length < 4 ? [...feats, ...autoTerrain('region', r, have)] : feats;

  if (kind === 'floor') {
    const roomFeats = planned.filter((f) => f.kind === 'room' || f.kind === 'hall' || f.kind === 'yard');
    const snap = (v: number) => Math.round(v / 10) * 10;
    let outline = { x: 140, y: 110, w: 720, h: 480 };
    if (roomFeats.length >= 2) {
      for (const f of roomFeats) {
        if (f.points && f.points.length >= 3) { addArea(f.kind as AreaKind, scaled(f.points).map(([x, y]) => [snap(x), snap(y)] as Pt), f.name); continue; }
        const b = box(f);
        addArea(f.kind as AreaKind, rect(snap(b.cx - b.w / 2), snap(b.cy - b.h / 2), snap(b.w), snap(b.h)), f.name);
      }
      const bb = bbox(areas.flatMap((a) => a.points));
      outline = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
    } else {
      const names = [...ctx.children.map((c) => c.name), ...ROOM_NAMES[ctx.theme]];
      const cells = splitRooms(outline.x, outline.y, outline.w, outline.h, r, 3);
      cells.forEach((c, i) => addArea(i === 0 && cells.length > 3 ? 'hall' : 'room', rect(c.x, c.y, c.w, c.h), names[i] ?? undefined));
    }
    lines.push(...doorsFor(areas.filter((a) => a.kind !== 'yard'), r, ids, outline));
    for (const f of planned) if (f.kind === 'corridor' && f.points) addLine('corridor', scaled(f.points));
  } else if (kind === 'city') {
    const rough = ctx.theme === 'modern' || ctx.theme === 'cyberpunk' || ctx.theme === 'scifi' ? 0.08 : 0.18;
    for (const f of planned) {
      if (!isAreaKind(f.kind) || f.kind === 'district' || f.kind === 'block') continue;
      addArea(f.kind, f.kind === 'plaza' ? organic(f, r, 0.05, 1) : organic(f, r, f.kind === 'water' ? 0.35 : 0.2, f.kind === 'water' ? 4 : 2), f.name);
    }
    // Districts, from the plan or laid out in a ring round an old centre.
    let districts = planned.filter((f) => f.kind === 'district');
    if (!districts.length) {
      const names = [...typed(ctx, /district/).map((c) => c.name), ...DISTRICT_NAMES[ctx.theme]];
      const n = 4 + Math.floor(r() * 3);
      districts = [{ kind: 'district', name: names[0], x: 50, y: 35, w: 26, h: 19 }];
      for (let i = 1; i < n; i++) {
        const a = (i / (n - 1)) * Math.PI * 2 + r() * 0.4;
        districts.push({ kind: 'district', name: names[i], x: 50 + Math.cos(a) * 25, y: 35 + Math.sin(a) * 18, w: 28 + r() * 8, h: 20 + r() * 6 });
      }
    }
    const organicTown = !(ctx.theme === 'modern' || ctx.theme === 'cyberpunk' || ctx.theme === 'scifi');
    const density: Density = plan.density ?? (ctx.theme === 'cyberpunk' || ctx.theme === 'scifi' ? 4 : 3);
    const shapes = districts.map((f) => (f.points && f.points.length >= 3 ? smooth(scaled(f.points), 1, true) : fractal(blob(box(f).cx, box(f).cy, box(f).w / 2, box(f).h / 2, r, 11, organicTown ? 0.2 : 0.08), r, { rounds: 2, rough: organicTown ? 0.22 : rough })));
    // A town of any size is one place: its districts tile its whole outline back to back. Only a scatter of farms has fields between.
    let dAreas: MapArea[];
    if (density >= 2) {
      const h0 = hull(shapes.flat());
      const c0 = centroid(h0);
      const grown = h0.map(([x, y]) => [c0[0] + (x - c0[0]) * 1.04, c0[1] + (y - c0[1]) * 1.04] as Pt);
      const outline = organicTown ? fractal(smooth(grown, 1, true), r, { rounds: 2, rough: 0.12 }) : smooth(grown, 1, true);
      const cells = tile(outline, shapes.map((p) => centroid(p)));
      dAreas = districts.map((f, k) => addArea('district', cells[k]!.length >= 3 ? cells[k]! : shapes[k]!, f.name));
    } else dAreas = districts.map((f, k) => addArea('district', shapes[k]!, f.name));
    // Rivers, canals and rails from the plan; the plan's own avenues become the town's main roads.
    const given: Pt[][] = [];
    for (const f of planned) {
      if (isAreaKind(f.kind) || !f.points) continue;
      if (f.kind === 'avenue' || f.kind === 'street') {
        const pts = organicTown ? smooth(fractal(scaled(f.points), r, { rounds: 3, rough: 0.07, closed: false }), 1) : smooth(scaled(f.points), 1);
        given.push(pts);
        if (f.name) lines.push({ id: ids.next('l'), kind: f.kind, name: f.name, points: pts });
        continue;
      }
      addLine(f.kind, f.kind === 'river' ? meander(scaled(f.points), r, 0.12) : smooth(scaled(f.points), 1), f.name);
    }
    // A wall for the cities of older worlds, if the plan did not say.
    const walled = planned.some((f) => f.kind === 'wall') || (['fantasy', 'ancient', 'gothic', 'steampunk'].includes(ctx.theme) && r() < 0.55);
    if (walled && !lines.some((l) => l.kind === 'wall')) {
      // The wall follows the town's edge, a little outside it.
      const h1 = hull(dAreas.flatMap((d) => d.points));
      const c1 = centroid(h1);
      const ring = h1.map(([x, y]) => [c1[0] + (x - c1[0]) * 1.025, c1[1] + (y - c1[1]) * 1.025] as Pt);
      addLine('wall', [...ring, ring[0]!]);
    }
    const plazaAt = dAreas[0] ? centroid(dAreas[0].points) : null;
    if (plazaAt && !areas.some((a) => a.kind === 'plaza')) addArea('plaza', organicTown ? fractal(blob(plazaAt[0], plazaAt[1], 18, 14, r, 7, 0.15), r, { rounds: 1, rough: 0.1 }) : rect(plazaAt[0] - 22, plazaAt[1] - 16, 44, 32));
    // The town itself: streets grown from its main roads, buildings set along them (see town.ts).
    const half = BARRIER_HALF;
    // The street network at the town's real size; lanes and buildings are grown from it as you look (town.ts).
    const town = growStreets({
      r,
      urban: dAreas.map((d) => d.points),
      open: areas.filter((a) => a.kind === 'water' || a.kind === 'park' || a.kind === 'plaza' || a.kind === 'forest').map((a) => a.points),
      barriers: lines.filter((l) => half[l.kind]).map((l) => ({ points: l.points, half: half[l.kind]! })),
      roads: given,
      centre: plazaAt ?? [MAP_W / 2, MAP_H / 2],
      grid: !organicTown,
      density,
      m: metresPer(scaleOf('city', plan.across)),
      w: MAP_W,
      h: MAP_H,
      reach: dAreas.map((d) => centroid(d.points)),
    });
    const round = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    for (const pts of town.avenues) if (!given.includes(pts)) addLine('avenue', round(pts));
    for (const pts of town.streets) addLine('street', round(pts));
    townSpec = { density, grid: !organicTown, seed: ctx.seed };
  } else if (kind === 'site') {
    for (const f of planned) {
      if (!isAreaKind(f.kind)) continue;
      const b = box(f);
      const pts = f.points && f.points.length >= 3 ? scaled(f.points) : f.kind === 'block' || f.kind === 'yard' || f.kind === 'plaza' ? rect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h) : organic(f, r, 0.25, 2);
      addArea(f.kind, pts, f.name);
    }
    if (!areas.some((a) => a.kind === 'block')) {
      const names = ctx.children.map((c) => c.name);
      const yard = { x: 200 + r() * 60, y: 120 + r() * 40, w: 520 + r() * 80, h: 400 + r() * 50 };
      addArea('yard', rect(yard.x, yard.y, yard.w, yard.h));
      const ring = rect(yard.x - 6, yard.y - 6, yard.w + 12, yard.h + 12);
      addLine('wall', [...ring, ring[0]!]);
      addArea('block', rect(yard.x + yard.w * 0.3, yard.y + 40, yard.w * 0.42, yard.h * 0.38), names[0]);
      const blocks = () => areas.filter((a) => a.kind === 'block');
      for (let i = 1; i < 3 + Math.floor(r() * 3); i++) {
        for (let tries = 0; tries < 30; tries++) {
          const w = 70 + r() * 70; const h = 50 + r() * 50;
          const x = yard.x + 20 + r() * (yard.w - w - 40); const y = yard.y + 20 + r() * (yard.h - h - 40);
          const box4 = rect(x - 14, y - 14, w + 28, h + 28);
          if (blocks().some((b) => b.points.some((p) => inside(p, box4)) || box4.some((p) => inside(p, b.points)))) continue;
          addArea('block', rect(x, y, w, h), names[i]);
          break;
        }
      }
      for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
        const side = r() < 0.5;
        const cx = side ? (r() < 0.5 ? yard.x - 70 - r() * 60 : yard.x + yard.w + 70 + r() * 60) : yard.x + r() * yard.w;
        const cy = side ? yard.y + r() * yard.h : (r() < 0.5 ? yard.y - 60 : yard.y + yard.h + 60);
        addArea('forest', fractal(blob(cx, cy, 30 + r() * 50, 25 + r() * 40, r, 10, 0.3), r, { rounds: 2, rough: 0.3 }));
      }
      if (r() < 0.5) addArea('water', fractal(blob(yard.x + yard.w * (0.15 + r() * 0.7), yard.y + yard.h - 50, 22 + r() * 16, 14 + r() * 10, r, 10, 0.2), r, { rounds: 2, rough: 0.25 }));
    }
    for (const f of planned) if (!isAreaKind(f.kind) && f.points) addLine(f.kind, smooth(scaled(f.points), 1), f.name);
    if (!lines.some((l) => l.kind === 'street' || l.kind === 'track')) {
      const main = areas.find((a) => a.kind === 'block');
      if (main) { const c = centroid(main.points); addLine(kind === 'site' && ['modern', 'cyberpunk', 'scifi'].includes(ctx.theme) ? 'street' : 'track', smooth([[c[0] + (r() - 0.5) * 300, MAP_H + 20], [c[0] + (r() - 0.5) * 80, (c[1] + MAP_H) / 2], [c[0], bbox(main.points).y + bbox(main.points).h]], 2)); }
    }
  } else {
    // Globe and region: terrain, then the lines across it.
    for (const f of planned) {
      if (!isAreaKind(f.kind) || (kind === 'globe' && f.kind === 'land')) continue;
      addArea(f.kind, organic(f, r, f.kind === 'water' ? 0.4 : 0.32, f.kind === 'water' ? 4 : 3), f.name);
    }
    for (const f of planned) {
      if (isAreaKind(f.kind) || !f.points) continue;
      const pts = scaled(f.points);
      addLine(f.kind, f.kind === 'river' ? meander(pts, r, 0.2) : f.kind === 'border' ? fractal(pts, r, { rounds: 4, rough: 0.2, closed: false }) : smooth(fractal(pts, r, { rounds: 2, rough: 0.08, closed: false }), 1), f.name);
    }
    // A river from the high ground to the sea, when the plan has none.
    if (kind === 'region' && !lines.some((l) => l.kind === 'river') && r() < 0.85) {
      const hi = areas.find((a) => a.kind === 'mountains' || a.kind === 'hills');
      const from: Pt = hi ? centroid(hi.points) : [r() * MAP_W, -10];
      const sea = areas.find((a) => a.kind === 'water' && area(a.points) > 60000);
      const to: Pt = sea ? centroid(sea.points) : [MAP_W - from[0] * 0.6, MAP_H + 10];
      addLine('river', meander([from, [(from[0] + to[0]) / 2 + (r() - 0.5) * 200, (from[1] + to[1]) / 2], to], r, 0.22));
    }
  }

  // ---- Pins --------------------------------------------------------------
  const pins: MapPin[] = [];
  const keep = new Map((ctx.keepPins ?? []).map((p) => [p.entityId ?? `name:${normName(p.name)}`, p]));
  const byName = new Map(ctx.children.map((c) => [normName(c.name), c]));
  const used = new Set<string>();
  const taken = (): Pt[] => pins.map((p) => [p.x, p.y]);
  const standIn = kind === 'floor' ? areas.filter((a) => a.kind === 'room' || a.kind === 'hall') : kind === 'city' ? areas.filter((a) => a.kind === 'district') : kind === 'site' ? areas.filter((a) => a.kind === 'yard' || a.kind === 'block') : [];
  const canStand = (p: Pt) => (standIn.length ? standIn.some((a) => inside(p, a.points)) : true) && (kind === 'floor' || landAt(p));
  const put = (name: string, entityId: string | null, at: Pt) => {
    const k = entityId ?? `name:${normName(name)}`;
    const kept = keep.get(k);
    pins.push({ id: kept?.id ?? ids.next('p'), entityId, name, x: kept ? kept.x : at[0], y: kept ? kept.y : at[1] });
    if (entityId) used.add(entityId);
  };
  // A place named like an area of the map stands in it (a room, a district, a building).
  const areaNamed = (name: string) => areas.find((a) => a.name && normName(a.name) === normName(name));
  for (const p of plan.places) {
    const c = byName.get(normName(p.name));
    if (c && used.has(c.id)) continue;
    const a = areaNamed(p.name);
    let at: Pt = a ? centroid(a.points) : [p.x * S, p.y * S];
    if (!canStand(at)) at = freeSpot(r, taken(), canStand);
    put(c?.name ?? p.name, c?.id ?? null, at);
  }
  for (const c of ctx.children) {
    if (used.has(c.id)) continue;
    const a = areaNamed(c.name);
    const freeRoom = kind === 'floor' ? areas.find((x) => (x.kind === 'room' || x.kind === 'hall') && !pins.some((p) => inside([p.x, p.y], x.points))) : undefined;
    put(c.name, c.id, a ? centroid(a.points) : freeRoom ? centroid(freeRoom.points) : freeSpot(r, taken(), canStand));
  }
  // Kept pins that are not in the plan stay too (hand-placed ones above all).
  for (const p of ctx.keepPins ?? []) if (!pins.some((x) => x.id === p.id)) pins.push(p);

  // Roads between the places of a region, when the plan drew none.
  if (kind === 'region' && !lines.some((l) => l.kind === 'road' || l.kind === 'track') && pins.length >= 2) {
    const pts = pins.map((p) => [p.x, p.y] as Pt);
    for (const [i, j] of spanningTree(pts)) {
      const a = pts[i]!; const b = pts[j]!;
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const road = smooth(fractal([a, mid, b], r, { rounds: 3, rough: 0.12, closed: false }), 2);
      const wet = road.filter((p) => !landAt(p)).length / road.length;
      if (wet < 0.25) addLine(dist(a, b) > 350 ? 'track' : 'road', road);
    }
  }

  // ---- Labels ------------------------------------------------------------
  const labels: MapLabel[] = plan.labels.map((l) => ({ id: ids.next('t'), text: l.text, x: l.x * S, y: l.y * S, size: l.size ?? 'm' }));
  // Areas, lines and pins carry their own names; a plan label that only repeats one is dropped.
  const named = new Set([...areas, ...lines].map((x) => (x.name ? normName(x.name) : '')).concat(pins.map((p) => normName(p.name)), [normName(ctx.title)]));
  const free = labels.filter((l) => !named.has(normName(l.text)));
  labels.length = 0;
  labels.push(...free.slice(0, 6));

  return {
    locationId: ctx.locationId,
    universeId: ctx.universeId,
    kind,
    theme: ctx.theme,
    title: plan.title || ctx.title,
    w: MAP_W,
    h: MAP_H,
    scale: scaleOf(kind, plan.across),
    ...(townSpec ? { town: townSpec } : {}),
    ground,
    areas,
    lines,
    labels,
    pins,
    seed: ctx.seed,
    updatedAt: ctx.now,
  };
}

/** A plan with nothing in it: the builder invents the whole map. For when there is no model, or as a first sketch. */
export function emptyPlan(title: string, sea: MapPlan['sea'] = 'none'): MapPlan {
  return { title, theme: null, across: null, unit: null, sea, features: [], places: [], labels: [] };
}

/** A sea side picked by the seed: most regions have none, some a coast, a few are islands. */
export function seaFor(kind: MapKind, seed: number): MapPlan['sea'] {
  if (kind !== 'region' && kind !== 'city') return 'none';
  const v = seeded(seed ^ 0x5eed)();
  return v < 0.45 ? 'none' : v < 0.88 ? (['west', 'east', 'south', 'north'] as const)[Math.floor(v * 97) % 4]! : kind === 'region' ? 'around' : 'south';
}
