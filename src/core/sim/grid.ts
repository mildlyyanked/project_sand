import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import { hash, rng } from './rng';
import type { Place, SimState, Venue } from './types';

/**
 * The map of play. Every place can hold a level: a small grid of cells at its
 * own scale, from a room (a few steps a cell) up through a quarter, a city, a
 * region, a realm, a world and a star system (days a cell). The grid is
 * deliberately coarse and abstract: terrain, named spots you can enter,
 * features you can deal with, and open ground in between. Levels are laid
 * out by the helper the first time they are needed (the layout comes back as
 * rectangles, lines and points, which models handle far better than drawn
 * grids) and by rules when it cannot. RN-free.
 */
export type Scale = 'interior' | 'site' | 'quarter' | 'city' | 'region' | 'realm' | 'world' | 'system';
export const SCALE_ORDER: Scale[] = ['interior', 'site', 'quarter', 'city', 'region', 'realm', 'world', 'system'];

export const SCALES: Record<Scale, { w: number; h: number; minutes: number; label: string; cell: string; spots: string }> = {
  interior: { w: 10, h: 8, minutes: 0.15, label: 'Inside', cell: 'a few steps', spots: '1 to 4 rooms or parts you can go into, and 2 to 5 features (a counter, a hearth, a desk, stairs)' },
  site: { w: 14, h: 10, minutes: 0.5, label: 'Area', cell: 'about 30 paces', spots: '3 to 7 buildings or places to go into, and 2 to 4 features' },
  quarter: { w: 16, h: 12, minutes: 2, label: 'Quarter', cell: 'a short city block', spots: '5 to 9 places (taverns, shops, homes, yards, temples, landmarks) and 1 to 3 features' },
  city: { w: 16, h: 12, minutes: 6, label: 'City', cell: 'a neighbourhood', spots: '5 to 9 districts, quarters and landmarks' },
  region: { w: 16, h: 12, minutes: 90, label: 'Region', cell: 'a few miles of country', spots: '5 to 9 towns, villages, ruins, outposts and landmarks' },
  realm: { w: 18, h: 12, minutes: 720, label: 'Realm', cell: 'a day\'s ride', spots: '5 to 9 regions, provinces, great cities and wonders' },
  world: { w: 20, h: 12, minutes: 2880, label: 'World', cell: 'days of travel', spots: '4 to 8 realms, nations and continents' },
  system: { w: 16, h: 12, minutes: 4320, label: 'System', cell: 'days of flight', spots: '3 to 8 planets, moons and stations' },
};

export function scaleOf(p: Pick<Place, 'venue' | 'type'>): Scale {
  const BY_TYPE: Record<string, Scale> = {
    system: 'system', planet: 'world', continent: 'realm', realm: 'realm', nation: 'realm', region: 'region', province: 'region', route: 'region',
    city: 'city', town: 'city', village: 'quarter', station: 'city', district: 'quarter', wilderness: 'quarter', street: 'site', landmark: 'site', ruin: 'site', dungeon: 'site', building: 'interior', room: 'interior', ship: 'interior',
  };
  const t = BY_TYPE[p.type.toLowerCase()];
  if (t) return t;
  switch (p.venue) {
    case 'settlement': return 'city';
    case 'district': case 'wild': return 'quarter';
    case 'region': case 'road': return 'region';
    case 'street': case 'square': case 'market': case 'dock': case 'ruin': return 'site';
    default: return 'interior';
  }
}

export function upScale(s: Scale): Scale | null {
  const i = SCALE_ORDER.indexOf(s);
  return i >= 0 && i < SCALE_ORDER.length - 1 ? SCALE_ORDER[i + 1]! : null;
}

/** Terrain, one character a cell. */
export const TERRAIN: Record<string, { name: string; ch: string }> = {
  floor: { name: 'floor', ch: '.' }, wall: { name: 'wall', ch: '#' }, door: { name: 'doorway', ch: '+' }, road: { name: 'road', ch: '=' }, plaza: { name: 'paving', ch: ':' },
  grass: { name: 'grass', ch: ',' }, forest: { name: 'forest', ch: 'T' }, farmland: { name: 'fields', ch: '"' }, water: { name: 'water', ch: '~' }, deep: { name: 'deep water', ch: 'W' },
  mountain: { name: 'mountains', ch: '^' }, sand: { name: 'sand', ch: 's' }, swamp: { name: 'marsh', ch: '%' }, snow: { name: 'snow and ice', ch: '*' }, buildings: { name: 'buildings', ch: 'B' },
  void: { name: 'open space', ch: ' ' }, rubble: { name: 'rubble', ch: 'x' }, deck: { name: 'deck plating', ch: 'd' },
};
const BY_CHAR = new Map(Object.values(TERRAIN).map((t) => [t.ch, t.name]));
export const terrainName = (ch: string) => BY_CHAR.get(ch) ?? 'ground';
const charOf = (name: unknown): string | null => {
  const n = String(name ?? '').toLowerCase().trim();
  if (TERRAIN[n]) return TERRAIN[n]!.ch;
  const hit = Object.entries(TERRAIN).find(([k, v]) => n.includes(k) || n.includes(v.name));
  return hit ? hit[1].ch : null;
};

/** What a step onto a cell costs at this scale; null where you cannot go. */
export function passCost(ch: string, scale: Scale): number | null {
  const big = SCALE_ORDER.indexOf(scale) >= SCALE_ORDER.indexOf('region');
  switch (ch) {
    case '.': case '+': case ':': case ',': case '"': case 'd': return 1;
    case '=': return 0.7;
    case 's': return 1.5;
    case 'T': case '%': case '*': case 'x': return 2;
    case '^': return scale === 'interior' || scale === 'site' ? null : 3;
    case 'B': return scale === 'interior' || scale === 'site' ? null : scale === 'quarter' || scale === 'city' ? 2 : 1;
    case '~': return big ? 3 : null;
    case 'W': return scale === 'realm' || scale === 'world' || scale === 'system' ? 4 : null;
    case ' ': return scale === 'system' ? 1 : null;
    case '#': return null;
    default: return 1;
  }
}

export interface Feature { name: string; x: number; y: number; note: string }

export interface Level {
  w: number;
  h: number;
  scale: Scale;
  /** w × h terrain characters, row by row. */
  cells: string;
  entry: { x: number; y: number };
  features: Feature[];
  note: string;
}

export interface Cell { x: number; y: number }

export const at = (l: Level, x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? '#' : l.cells[y * l.w + x] ?? '#');
export const inside = (l: Level, x: number, y: number) => x >= 0 && y >= 0 && x < l.w && y < l.h;

/** Cheapest way across the grid, eight ways; diagonals cost a little more. */
export function findPath(l: Level, from: Cell, to: Cell): { path: Cell[]; cost: number } | null {
  if (!inside(l, to.x, to.y) || passCost(at(l, to.x, to.y), l.scale) == null) return null;
  const key = (x: number, y: number) => y * l.w + x;
  const dist = new Map<number, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<number, number>();
  const open: { k: number; f: number }[] = [{ k: key(from.x, from.y), f: 0 }];
  const h = (x: number, y: number) => Math.max(Math.abs(x - to.x), Math.abs(y - to.y)) * 0.7;
  const goal = key(to.x, to.y);
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const { k } = open.shift()!;
    if (k === goal) break;
    const x = k % l.w;
    const y = Math.floor(k / l.w);
    const d = dist.get(k)!;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(l, nx, ny)) continue;
      const c = passCost(at(l, nx, ny), l.scale);
      if (c == null) continue;
      const nd = d + c * (dx && dy ? 1.4 : 1);
      const nk = key(nx, ny);
      if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, k); open.push({ k: nk, f: nd + h(nx, ny) }); }
    }
  }
  if (!dist.has(goal)) return null;
  const path: Cell[] = [];
  for (let k: number | undefined = goal; k != null && k !== key(from.x, from.y); k = prev.get(k)) path.unshift({ x: k % l.w, y: Math.floor(k / l.w) });
  return { path, cost: dist.get(goal)! };
}

export function walkMinutes(l: Level, cost: number): number {
  return Math.max(1, Math.round(cost * SCALES[l.scale].minutes));
}

/** The places that sit on a level, by their cell. */
export function spotsOf(sim: SimState, placeId: string): Place[] {
  return Object.values(sim.places).filter((p) => p.parent === placeId && p.x != null && p.y != null);
}

export function spotAt(sim: SimState, placeId: string, x: number, y: number): Place | undefined {
  return spotsOf(sim, placeId).find((p) => p.x === x && p.y === y);
}

const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
export function direction(from: Cell, to: Cell): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  return DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8]!;
}

/** Where the player stands, in words: at a door, or on open ground with the nearest places around. */
export function whereLine(sim: SimState): string {
  const here = sim.places[sim.here];
  const l = here?.level;
  if (!here || !l || !sim.pos) return '';
  const spot = spotAt(sim, here.id, sim.pos.x, sim.pos.y);
  const feature = l.features.find((f) => f.x === sim.pos!.x && f.y === sim.pos!.y);
  const near = spotsOf(sim, here.id).filter((p) => p.known && p.id !== spot?.id).map((p) => ({ p, d: Math.max(Math.abs(p.x! - sim.pos!.x), Math.abs(p.y! - sim.pos!.y)) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const parts = [spot ? `You stand at the way into ${spot.name}.` : feature ? `You stand by ${feature.name}.` : `You stand on ${terrainName(at(l, sim.pos.x, sim.pos.y))}.`];
  if (near.length) parts.push(`Nearby: ${near.map(({ p, d }) => `${p.name} (${d <= 1 ? 'right beside you' : `${direction(sim.pos!, { x: p.x!, y: p.y! })}, ${d} ${d === 1 ? 'cell' : 'cells'}`})`).join('; ')}.`);
  return parts.join(' ');
}

/** Where named people and faces stand on a level now: seeded per person and two-hour block, on open cells. */
export function positions(sim: SimState, l: Level, ids: string[]): Map<string, Cell> {
  const out = new Map<string, Cell>();
  const open: Cell[] = [];
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) if (passCost(at(l, x, y), l.scale) != null) open.push({ x, y });
  if (!open.length) return out;
  const bucket = Math.floor(sim.clock / 120);
  for (const id of ids) {
    const r = rng(hash(sim.seed, 'pos', id, bucket));
    out.set(id, open[Math.floor(r() * open.length)]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layouts

export interface LayoutSpot { name: string; venue: Venue; x: number; y: number; note: string; danger: number; library: string }
export interface Layout {
  base: string;
  areas: { terrain: string; x: number; y: number; w: number; h: number }[];
  lines: { terrain: string; points: [number, number][] }[];
  spots: LayoutSpot[];
  features: Feature[];
  entry: Cell | null;
  note: string;
  /** "Around" layouts: the larger place being made. */
  name?: string;
  type?: string;
}

const VENUES: Venue[] = ['tavern', 'inn', 'market', 'shop', 'workshop', 'temple', 'clinic', 'dock', 'garrison', 'palace', 'office', 'square', 'street', 'hall', 'home', 'room', 'building', 'district', 'settlement', 'region', 'road', 'wild', 'ruin', 'vehicle', 'other'];

export function layoutPrompt(o: {
  mode: 'inside' | 'around';
  place: { name: string; venue: string; type: string; note: string };
  scale: Scale;
  chain: string[];
  /** Places that must be on this level, by exact name. */
  must: { name: string; venue: string; note: string }[];
  world: string;
}): ChatMessage[] {
  const sc = SCALES[o.scale];
  const what = o.mode === 'inside'
    ? `the inside of ${o.place.name} (${o.place.venue}${o.place.type ? `, ${o.place.type}` : ''})${o.chain.length ? `, which is in ${o.chain.join(' › ')}` : ''}`
    : `the larger area that contains ${o.place.name} (${o.place.venue}): name it, and put ${o.place.name} on it as one of the spots`;
  return [
    { role: 'system', content: [
      `You lay out one level of a game map for an interactive story: ${what}. The map is a grid of ${sc.w} columns by ${sc.h} rows; x runs 0 to ${sc.w - 1} left to right, y runs 0 to ${sc.h - 1} top to bottom; each cell is ${sc.cell}. Keep it abstract and readable: broad areas of terrain, a few lines (roads, corridors, rivers, walls), and the spots that matter. It must fit the world exactly and feel lived in.`,
      `Terrain: ${Object.keys(TERRAIN).join(', ')}. "base" fills everything; "areas" are rectangles painted in order over it; "lines" are paths through the given points (roads, corridors, rivers, walls). Interiors usually have floor inside a ring of wall with a door; towns are buildings cut by roads; country is grass, forest, fields, hills and water; space is void.`,
      `Spots are places a player can walk to and go into: ${sc.spots}. Spread them out, each on its own cell, reachable over walkable ground. Features are things in the open to deal with but not go into. Use these exact names for spots that must be there: ${o.must.length ? o.must.map((m) => m.name).join('; ') : '(none)'}; put "library" to that exact name for those.`,
      `Output only JSON: {${o.mode === 'around' ? '"name": string (the larger place), "type": "district" | "city" | "region" | "province" | "nation" | "continent" | "planet" | "system", ' : ''}"note": string (one line on what it is like), "base": terrain, "areas": [{"terrain": terrain, "x": n, "y": n, "w": n, "h": n}], "lines": [{"terrain": terrain, "points": [[x, y], ...]}], "spots": [{"name": string, "venue": ${VENUES.map((v) => `"${v}"`).join(' | ')}, "x": n, "y": n, "note": string (one line), "danger": 0 to 5, "library": string}], "features": [{"name": string, "x": n, "y": n, "note": string}], "entry": {"x": n, "y": n} (where someone arriving from outside comes in)}.`,
    ].join('\n\n') },
    { role: 'user', content: [o.world, `${o.place.name}: ${o.place.note || '(no description)'}`, o.must.length ? `Must be on the map:\n${o.must.map((m) => `- ${m.name} (${m.venue})${m.note ? `: ${m.note}` : ''}`).join('\n')}` : ''].filter(Boolean).join('\n\n') },
  ];
}

const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function parseLayout(text: string, scale: Scale): Layout | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const { w, h } = SCALES[scale];
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  const spots: LayoutSpot[] = list(j.spots).map((s) => ({ name: str(s.name), venue: (VENUES.includes(str(s.venue) as Venue) ? str(s.venue) : 'other') as Venue, x: num(s.x, 0, w - 1), y: num(s.y, 0, h - 1), note: str(s.note), danger: num(s.danger, 0, 5), library: str(s.library) })).filter((s) => s.name).slice(0, 14);
  if (!spots.length && !list(j.areas).length) return null;
  const e = j.entry && typeof j.entry === 'object' ? (j.entry as Record<string, unknown>) : null;
  return {
    base: str(j.base) || 'floor',
    areas: list(j.areas).map((a) => ({ terrain: str(a.terrain), x: num(a.x, 0, w - 1), y: num(a.y, 0, h - 1), w: num(a.w, 1, w), h: num(a.h, 1, h) })).slice(0, 30),
    lines: list(j.lines).map((l) => ({ terrain: str(l.terrain), points: (Array.isArray(l.points) ? l.points : []).filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2).map((p) => [num(p[0], 0, w - 1), num(p[1], 0, h - 1)] as [number, number]) })).filter((l) => l.points.length >= 2).slice(0, 20),
    spots,
    features: list(j.features).map((f) => ({ name: str(f.name), x: num(f.x, 0, w - 1), y: num(f.y, 0, h - 1), note: str(f.note) })).filter((f) => f.name).slice(0, 8),
    entry: e ? { x: num(e.x, 0, w - 1), y: num(e.y, 0, h - 1) } : null,
    note: str(j.note),
    ...(str(j.name) ? { name: str(j.name) } : {}),
    ...(str(j.type) ? { type: str(j.type).toLowerCase() } : {}),
  };
}

function line(a: [number, number], b: [number, number]): Cell[] {
  const out: Cell[] = [];
  let [x0, y0] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 400; i++) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/** A layout as a level: painted, every spot on open ground and reachable from the way in. */
export function rasterize(layout: Layout, scale: Scale): { level: Level; spots: LayoutSpot[] } {
  const { w, h } = SCALES[scale];
  const grid = new Array<string>(w * h).fill(charOf(layout.base) ?? (scale === 'system' ? ' ' : scale === 'interior' ? '.' : ','));
  const set = (x: number, y: number, ch: string) => { if (x >= 0 && y >= 0 && x < w && y < h) grid[y * w + x] = ch; };
  for (const a of layout.areas) { const ch = charOf(a.terrain); if (ch) for (let y = a.y; y < Math.min(h, a.y + a.h); y++) for (let x = a.x; x < Math.min(w, a.x + a.w); x++) set(x, y, ch); }
  for (const l of layout.lines) { const ch = charOf(l.terrain); if (ch) for (let i = 1; i < l.points.length; i++) for (const c of line(l.points[i - 1]!, l.points[i]!)) set(c.x, c.y, ch); }
  const open = scale === 'interior' ? '.' : scale === 'system' ? ' ' : scale === 'site' ? ':' : '=';
  const lvl: Level = { w, h, scale, cells: grid.join(''), entry: { x: 0, y: 0 }, features: [], note: layout.note };
  const walk = (x: number, y: number) => passCost(at(lvl, x, y), scale) != null;
  const free = (x: number, y: number) => { if (!walk(x, y)) { set(x, y, open); lvl.cells = grid.join(''); } };
  // Spots on their own cells, nudged off each other.
  const taken = new Set<string>();
  const spots: LayoutSpot[] = [];
  const nearestFree = (sx: number, sy: number): Cell | null => {
    for (let r = 0; r < Math.max(w, h); r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = sx + dx;
      const y = sy + dy;
      if (x >= 0 && y >= 0 && x < w && y < h && !taken.has(`${x},${y}`)) return { x, y };
    }
    return null;
  };
  for (const s of layout.spots) {
    const c = nearestFree(s.x, s.y);
    if (!c) continue;
    taken.add(`${c.x},${c.y}`);
    free(c.x, c.y);
    spots.push({ ...s, x: c.x, y: c.y });
  }
  const entry = layout.entry ?? { x: Math.floor(w / 2), y: h - 1 };
  free(entry.x, entry.y);
  lvl.entry = entry;
  lvl.features = layout.features.filter((f) => !taken.has(`${f.x},${f.y}`));
  // Everything reachable from the way in: carve a path to whatever is not.
  const reach = () => { const seen = new Set<string>([`${entry.x},${entry.y}`]); const q: Cell[] = [entry]; while (q.length) { const c = q.shift()!; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const nx = c.x + dx; const ny = c.y + dy; const k = `${nx},${ny}`; if (!seen.has(k) && inside(lvl, nx, ny) && walk(nx, ny)) { seen.add(k); q.push({ x: nx, y: ny }); } } } return seen; };
  for (const target of [...spots, ...lvl.features]) {
    const seen = reach();
    if (seen.has(`${target.x},${target.y}`)) continue;
    for (const c of line([target.x, target.y], [entry.x, entry.y])) { if (seen.has(`${c.x},${c.y}`)) break; free(c.x, c.y); }
  }
  lvl.cells = grid.join('');
  return { level: lvl, spots };
}

/** A layout by rules alone, for when the helper cannot be asked or answers badly. */
export function fallbackLayout(o: { scale: Scale; must: { name: string; venue: Venue }[]; seed: number; name: string; venue?: Venue }): Layout {
  const { w, h } = SCALES[o.scale];
  const r = rng(hash(o.seed, 'layout', o.name));
  const areas: Layout['areas'] = [];
  const lines: Layout['lines'] = [];
  let base = 'grass';
  let entry: Cell = { x: Math.floor(w / 2), y: h - 1 };
  switch (o.scale) {
    case 'interior':
      base = 'floor';
      lines.push({ terrain: 'wall', points: [[0, 0], [w - 1, 0]] }, { terrain: 'wall', points: [[w - 1, 0], [w - 1, h - 1]] }, { terrain: 'wall', points: [[w - 1, h - 1], [0, h - 1]] }, { terrain: 'wall', points: [[0, h - 1], [0, 0]] });
      areas.push({ terrain: 'door', x: Math.floor(w / 2), y: h - 1, w: 1, h: 1 });
      break;
    case 'site':
      base = 'plaza';
      for (let i = 0; i < 4; i++) areas.push({ terrain: 'buildings', x: Math.floor(r() * (w - 3)), y: Math.floor(r() * (h - 3)), w: 2 + Math.floor(r() * 2), h: 2 });
      lines.push({ terrain: 'road', points: [[0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]] });
      entry = { x: 0, y: Math.floor(h / 2) };
      break;
    case 'quarter': case 'city':
      base = 'buildings';
      for (let x = 2; x < w; x += 4) lines.push({ terrain: 'road', points: [[x, 0], [x, h - 1]] });
      for (let y = 2; y < h; y += 4) lines.push({ terrain: 'road', points: [[0, y], [w - 1, y]] });
      areas.push({ terrain: 'plaza', x: Math.floor(w / 2) - 1, y: Math.floor(h / 2) - 1, w: 3, h: 2 });
      if (o.scale === 'city' && r() < 0.5) lines.push({ terrain: 'water', points: [[0, h - 2], [w - 1, h - 3]] });
      entry = { x: 2, y: h - 1 };
      break;
    case 'region': case 'realm':
      base = 'grass';
      for (let i = 0; i < 4; i++) areas.push({ terrain: pickOf(r, ['forest', 'forest', 'farmland', 'mountain', 'swamp']), x: Math.floor(r() * (w - 4)), y: Math.floor(r() * (h - 3)), w: 2 + Math.floor(r() * 4), h: 2 + Math.floor(r() * 3) });
      lines.push({ terrain: 'water', points: [[Math.floor(r() * w), 0], [Math.floor(r() * w), h - 1]] });
      entry = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
      break;
    case 'world':
      base = 'deep';
      for (let i = 0; i < 5; i++) areas.push({ terrain: pickOf(r, ['grass', 'grass', 'sand', 'forest']), x: Math.floor(r() * (w - 5)), y: 1 + Math.floor(r() * (h - 5)), w: 3 + Math.floor(r() * 5), h: 2 + Math.floor(r() * 3) });
      areas.push({ terrain: 'snow', x: 0, y: 0, w, h: 1 }, { terrain: 'snow', x: 0, y: h - 1, w, h: 1 });
      entry = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
      break;
    case 'system':
      base = 'void';
      entry = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
      break;
  }
  const spots: LayoutSpot[] = o.must.map((m, i) => {
    const a = (i / Math.max(1, o.must.length)) * Math.PI * 2 + r();
    return { name: m.name, venue: m.venue, x: Math.max(1, Math.min(w - 2, Math.round(w / 2 + Math.cos(a) * (w / 3)))), y: Math.max(1, Math.min(h - 2, Math.round(h / 2 + Math.sin(a) * (h / 3)))), note: '', danger: 0, library: m.name };
  });
  if (o.scale === 'region' || o.scale === 'realm') for (let i = 1; i < spots.length; i++) lines.push({ terrain: 'road', points: [[spots[i - 1]!.x, spots[i - 1]!.y], [spots[i]!.x, spots[i]!.y]] });
  return { base, areas, lines, spots, features: [], entry, note: '' };
}

function pickOf<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length)]!;
}
