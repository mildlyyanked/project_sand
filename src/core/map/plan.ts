import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import { normName } from '../world/drafts';
import { KIND_INFO, THEMES } from './style';
import type { AreaKind, LineKind, MapKind, Pt, ThemeKey } from './types';

/**
 * The plan a model writes for a map: not a picture, a sketch in numbers. It
 * says where the sea is, which places sit where, what the land around them
 * is like and how big it all is; the builder turns that into coastlines,
 * rivers, streets and rooms. Coordinates are on a 100 × 70 grid, north up.
 */
export interface PlanFeature {
  kind: AreaKind | LineKind;
  name?: string;
  /** An area as a box (centre and size)… */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** …or a line (or an area) as points. */
  points?: Pt[];
}
export interface PlanPlace { name: string; x: number; y: number }
export interface PlanLabel { text: string; x: number; y: number; size?: 's' | 'm' | 'l' }
export type SeaSide = 'none' | 'north' | 'south' | 'east' | 'west' | 'around';

export interface MapPlan {
  /** The kind of map the model judged right from the description, when it judged. */
  kind?: MapKind | null;
  /** How built up a town is, 1 to 5. */
  density?: 1 | 2 | 3 | 4 | 5 | null;
  title: string;
  theme: ThemeKey | null;
  /** How far the map reaches from west edge to east edge, in its unit. */
  across: number | null;
  unit: 'm' | 'km' | null;
  sea: SeaSide;
  features: PlanFeature[];
  places: PlanPlace[];
  labels: PlanLabel[];
}

export interface PlanPlaceInfo { name: string; type: string; summary: string }
export interface PlanInput {
  kind: MapKind;
  place: PlanPlaceInfo & { description: string };
  /** Places inside this one: each gets a pin. */
  children: PlanPlaceInfo[];
  /** Where this place sits, outermost first. */
  within: PlanPlaceInfo[];
  /** Places beside it in the same parent, for a sense of the neighbourhood. */
  siblings: string[];
  world: { name: string; genre: string; rules: string };
  theme: ThemeKey;
  /** What to change, when a map is redrawn on request. */
  wish?: string;
}

const KIND_BRIEF: Record<MapKind, string> = {
  globe: 'a whole world on a Mercator projection: continents and oceans, ice at the poles, great mountain ranges, deserts and forests, the largest rivers. Places are nations, cities and wonders on the continents',
  region: 'a regional map: coast or none, rivers, forests, hills and mountains, marsh and fields, the roads and tracks that join its places',
  city: 'a city plan: its districts (each a box), the river or harbour if any, walls if it has them, parks and squares, the main avenues. Places are districts, streets and landmarks',
  site: 'a site plan: the buildings (blocks) and yards, the streets or tracks to it, walls, water. Places are buildings and spots within the site',
  floor: 'a floor plan: rooms and halls as boxes that touch along their walls with no gaps and no overlaps, the corridors between them. Places are rooms',
};

const SIZE_HINT: Record<MapKind, string> = {
  globe: 'the planet\'s circumference in km (Earth is 40075)',
  region: 'in km (a valley 20, a province 150, a kingdom 600, a continent 4000)',
  city: 'in metres (a village 600, a town 1500, a city 5000 to 15000, a great metropolis 20000 to 50000)',
  site: 'in metres (a manor and its grounds 300, a fortress 600, a campus 1500)',
  floor: 'in metres (a house 15, a tavern 25, a temple 60, a palace wing 120)',
};

const line = (p: PlanPlaceInfo) => `${p.name}${p.type ? ` (${p.type})` : ''}${p.summary ? `: ${p.summary}` : ''}`;

/** The prompt for a map's plan. The entries are the truth; the map only places them. */
export function mapPlanPrompt(i: PlanInput): ChatMessage[] {
  const info = KIND_INFO[i.kind];
  const sys = [
    'You are a cartographer for a story world. You sketch the plan of one map as JSON numbers; a program draws it.',
    'First judge how big the place really is and what kind of map shows it best, from what its entry says, not from its type alone: a school described as the size of a city is a city plan many kilometres across; a "station" that is a whole orbital habitat is a city plan; a castle is a site plan; a single house is a floor plan. If the entry gives a size or a population, follow it.',
    'The world\'s entries are the truth. Never contradict what they say about a place: if a city is on a river, put the river through it; if a tower stands on a hill, the hill is there. Where the entries are silent, invent what makes the place plausible for its climate, history and technology, and keep it consistent with the places around it.',
    'Coordinates are on a grid 100 wide (x, west to east) and 70 high (y, north to south). North is up.',
    'Kinds of map: globe (a whole world), region (land and its settlements), city (districts and streets), site (a few buildings and their grounds), floor (rooms of one building).',
    ...(Object.keys(KIND_INFO) as MapKind[]).map((k) => `On a ${k} map, area kinds: ${KIND_INFO[k].areas.join(', ')}; line kinds: ${KIND_INFO[k].lines.join(', ')}.`),
    'Answer with JSON only, no commentary.',
  ].join('\n');
  const user = [
    `World: ${i.world.name}${i.world.genre ? ` — ${i.world.genre}` : ''}.${i.world.rules ? ` ${i.world.rules}` : ''}`,
    i.within.length ? `It lies within: ${i.within.map(line).join(' › ')}.` : '',
    `Map ${line(i.place)}. From its type it would be ${info.label.toLowerCase()} (${info.span}); choose another kind if what the entry says calls for it.`,
    i.place.description ? `What the entry says: ${i.place.description}` : '',
    i.siblings.length ? `Its neighbours in the same place: ${i.siblings.join(', ')}.` : '',
    i.children.length ? `Places inside it that must each be placed, with their names exactly as written:\n${i.children.map((c) => `- ${line(c)}`).join('\n')}` : 'Nothing inside it is recorded yet: invent two to five places that belong here, named to fit the world.',
    `As ${info.label.toLowerCase()} it is ${KIND_BRIEF[i.kind]}. The map is drawn in a ${THEMES[i.theme].label.toLowerCase()} style.`,
    i.wish ? `The person wants: ${i.wish}` : '',
    '',
    'Shape:',
    '{',
    '  "kind": "globe" | "region" | "city" | "site" | "floor",',
    '  "title": "the name on the map\'s cartouche",',
    '  "density": 1 | 2 | 3 | 4 | 5, // towns: how built up, from what the entry says. 1 farms and cottages with fields between, 2 a market town, 3 a city, 4 a crowded city packed street to street, 5 a megacity of towers with no gap anywhere',
    `  "across": number, // how far the map reaches west to east: a globe, ${SIZE_HINT.globe}; a region, ${SIZE_HINT.region}; a city, ${SIZE_HINT.city}; a site, ${SIZE_HINT.site}; a floor, ${SIZE_HINT.floor}. The place should fill most of the map.`,
    '  "sea": "none" | "north" | "south" | "east" | "west" | "around", // where open water is (globe, region and city maps); "around" for an island',
    '  "features": [',
    '    {"kind": "<area kind>", "name": "optional", "x": 30, "y": 20, "w": 25, "h": 15}, // an area: centre and size',
    '    {"kind": "<line kind>", "name": "optional", "points": [[0, 30], [40, 35], [100, 28]]} // a line: two to six points',
    '  ],',
    '  "places": [{"name": "…", "x": 42, "y": 31}],',
    '  "labels": [{"text": "…", "x": 70, "y": 12, "size": "s" | "m" | "l"}] // at most four: names worth writing that have no area or line of their own (a sea, a quarter, a pass). Never the name of this place or of the places it lies within; areas and lines carry their own names',
    '}',
    'For a floor plan, give every room as an area with x, y as its centre and w, h as its size; together they fill the building; a place that is a room sits at that room\'s centre and the room has the place\'s name.',
    'For a city plan, give each district as an area; neighbouring districts touch and together they fill most of the map. Put places where the entries say; spread the rest sensibly.',
    'Elsewhere, spread the places plausibly: settlements near water and along roads, strongholds on high ground, nothing on top of another.',
    'Six to sixteen features is plenty. Keep everything inside the grid.',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const pt = (v: unknown): Pt | null => {
  if (Array.isArray(v) && v.length >= 2) { const x = num(v[0]); const y = num(v[1]); return x === null || y === null ? null : [x, y]; }
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; const x = num(o.x); const y = num(o.y); return x === null || y === null ? null : [x, y]; }
  return null;
};
const inGrid = (p: Pt): Pt => [Math.max(0, Math.min(100, p[0])), Math.max(0, Math.min(70, p[1]))];

const ALL_KINDS = new Set<string>(['land', 'water', 'forest', 'mountains', 'hills', 'desert', 'swamp', 'ice', 'farmland', 'district', 'park', 'plaza', 'block', 'room', 'hall', 'yard', 'river', 'road', 'track', 'rail', 'wall', 'street', 'lane', 'avenue', 'canal', 'corridor', 'border', 'door']);
const ALIASES: Record<string, string> = { lake: 'water', sea: 'water', ocean: 'water', bay: 'water', harbour: 'water', harbor: 'water', mountain: 'mountains', range: 'mountains', woods: 'forest', jungle: 'forest', marsh: 'swamp', bog: 'swamp', fields: 'farmland', field: 'farmland', square: 'plaza', building: 'block', buildings: 'block', courtyard: 'yard', garden: 'park', path: 'track', railway: 'rail', stream: 'river', street: 'street', hallway: 'corridor', glacier: 'ice', dunes: 'desert', island: 'land', continent: 'land' };

/** A plan from a model's reply, as far as it can be read. Null when nothing usable came back. */
export function parseMapPlan(text: string): MapPlan | null {
  const raw = lenientJson<Record<string, unknown>>(text);
  if (!raw || typeof raw !== 'object') return null;
  const features: PlanFeature[] = [];
  for (const f of Array.isArray(raw.features) ? raw.features : []) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const k0 = String(o.kind ?? '').toLowerCase().trim();
    const kind = (ALL_KINDS.has(k0) ? k0 : ALIASES[k0]) as PlanFeature['kind'] | undefined;
    if (!kind) continue;
    const points = Array.isArray(o.points) ? o.points.map(pt).filter((p): p is Pt => !!p).map(inGrid) : [];
    const x = num(o.x); const y = num(o.y); const w = num(o.w); const h = num(o.h);
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : undefined;
    if (points.length >= 2) features.push({ kind, name, points });
    else if (x !== null && y !== null) features.push({ kind, name, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(70, y)), w: Math.max(1, Math.min(100, w ?? 12)), h: Math.max(1, Math.min(70, h ?? 9)) });
  }
  const places: PlanPlace[] = [];
  for (const p of Array.isArray(raw.places) ? raw.places : []) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const at = pt(o);
    if (typeof o.name === 'string' && o.name.trim() && at) { const [x, y] = inGrid(at); places.push({ name: o.name.trim(), x, y }); }
  }
  const labels: PlanLabel[] = [];
  for (const l of Array.isArray(raw.labels) ? raw.labels : []) {
    if (!l || typeof l !== 'object') continue;
    const o = l as Record<string, unknown>;
    const at = pt(o);
    const size = o.size === 's' || o.size === 'm' || o.size === 'l' ? o.size : 'm';
    if (typeof o.text === 'string' && o.text.trim() && at) { const [x, y] = inGrid(at); labels.push({ text: o.text.trim(), x, y, size }); }
  }
  if (!features.length && !places.length) return null;
  const sea = typeof raw.sea === 'string' && ['none', 'north', 'south', 'east', 'west', 'around'].includes(raw.sea) ? (raw.sea as SeaSide) : 'none';
  const theme = typeof raw.theme === 'string' && raw.theme in THEMES ? (raw.theme as ThemeKey) : null;
  const dn = num(raw.density);
  const density = dn === null ? null : (Math.max(1, Math.min(5, Math.round(dn))) as 1 | 2 | 3 | 4 | 5);
  const kind = typeof raw.kind === 'string' && raw.kind.toLowerCase() in KIND_INFO ? (raw.kind.toLowerCase() as MapKind) : null;
  return { kind, density, title: typeof raw.title === 'string' ? raw.title.trim() : '', theme, across: num(raw.across), unit: null, sea, features, places, labels };
}

/** Is a planned place the same as a recorded one? */
export const samePlace = (a: string, b: string) => normName(a) === normName(b);
