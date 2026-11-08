import type { AreaKind, LineKind, MapKind, MapScale, ThemeKey } from './types';

/** What kind of map a place gets, from its type: a planet is a globe, a city a street plan, a building a floor plan. */
export function mapKindOf(type: string | undefined | null): MapKind {
  switch ((type ?? '').toLowerCase()) {
    case 'planet': case 'realm': return 'globe';
    case 'continent': case 'region': case 'nation': case 'province': case 'wilderness': case 'route': return 'region';
    case 'city': case 'town': case 'village': case 'district': return 'city';
    case 'street': case 'landmark': case 'ruin': return 'site';
    case 'building': case 'room': case 'dungeon': case 'station': case 'ship': return 'floor';
    default: return 'region';
  }
}

export const KIND_INFO: Record<MapKind, { label: string; scale: MapScale; areas: AreaKind[]; lines: LineKind[]; span: string }> = {
  globe: { label: 'Globe', scale: { unit: 'km', per: 40 }, areas: ['land', 'water', 'mountains', 'forest', 'desert', 'ice', 'swamp'], lines: ['river', 'border', 'road'], span: 'a whole world' },
  region: { label: 'Regional map', scale: { unit: 'km', per: 0.5 }, areas: ['land', 'water', 'forest', 'mountains', 'hills', 'desert', 'swamp', 'farmland', 'ice'], lines: ['river', 'road', 'track', 'rail', 'border', 'canal', 'wall'], span: 'tens to hundreds of kilometres' },
  city: { label: 'City plan', scale: { unit: 'm', per: 5 }, areas: ['district', 'water', 'park', 'plaza', 'block', 'land', 'forest'], lines: ['avenue', 'street', 'lane', 'river', 'canal', 'wall', 'rail'], span: 'a few kilometres' },
  site: { label: 'Site plan', scale: { unit: 'm', per: 0.5 }, areas: ['yard', 'block', 'plaza', 'park', 'forest', 'water', 'land'], lines: ['street', 'track', 'wall', 'canal'], span: 'a few hundred metres' },
  floor: { label: 'Floor plan', scale: { unit: 'm', per: 0.05 }, areas: ['room', 'hall', 'yard'], lines: ['corridor', 'wall', 'door'], span: 'tens of metres' },
};

export const AREA_LABEL: Record<AreaKind, string> = { land: 'Land', water: 'Water', forest: 'Forest', mountains: 'Mountains', hills: 'Hills', desert: 'Desert', swamp: 'Marsh', ice: 'Ice', farmland: 'Fields', district: 'District', park: 'Park', plaza: 'Square', block: 'Buildings', room: 'Room', hall: 'Hall', yard: 'Yard' };
export const LINE_LABEL: Record<LineKind, string> = { river: 'River', road: 'Road', track: 'Track', rail: 'Rail', wall: 'Wall', street: 'Street', lane: 'Lane', avenue: 'Avenue', canal: 'Canal', corridor: 'Corridor', border: 'Border', door: 'Door' };

export interface MapTheme {
  key: ThemeKey;
  label: string;
  font: 'serif' | 'sans' | 'mono';
  /** Background (the sea, on maps with sea; the ground otherwise). */
  bg: string;
  paper: string;
  land: string;
  coast: string;
  water: string;
  waterLine: string;
  forest: string;
  mountain: string;
  hills: string;
  desert: string;
  swamp: string;
  ice: string;
  farmland: string;
  district: string;
  block: string;
  blockLine: string;
  park: string;
  plaza: string;
  room: string;
  hall: string;
  wall: string;
  road: string;
  roadCase: string;
  river: string;
  rail: string;
  border: string;
  ink: string;
  labelInk: string;
  halo: string;
  pin: string;
  pinRing: string;
  grid: string;
  /** Glowing lines and markers (screens, neon). */
  glow: boolean;
  /** Hand-drawn hachures and a frame (old maps). */
  drawn: boolean;
}

const base = (key: ThemeKey, label: string, p: Omit<MapTheme, 'key' | 'label'>): MapTheme => ({ key, label, ...p });

export const THEMES: Record<ThemeKey, MapTheme> = {
  fantasy: base('fantasy', 'Old parchment', { font: 'serif', bg: '#c9d6cf', paper: '#efe2c4', land: '#e9d9b4', coast: '#5a4630', water: '#b9cbc4', waterLine: '#8fa69d', forest: '#a8b78a', mountain: '#c9b48e', hills: '#dccaa0', desert: '#efd9a2', swamp: '#b6bf98', ice: '#f4f1ea', farmland: '#e3d39e', district: '#e2cfa4', block: '#b99d74', blockLine: '#6d5539', park: '#b9c393', plaza: '#efe0bd', room: '#ecdcb8', hall: '#e2cfa6', wall: '#4a3a28', road: '#8a6a43', roadCase: '#efe2c4', river: '#6f93a0', rail: '#4a3a28', border: '#8b3a2a', ink: '#3d2f20', labelInk: '#3d2f20', halo: '#efe2c4', pin: '#8b3a2a', pinRing: '#efe2c4', grid: '#a8916b', glow: false, drawn: true }),
  ancient: base('ancient', 'Bronze age', { font: 'serif', bg: '#d9c39c', paper: '#e8d3a8', land: '#e3c999', coast: '#6b4a24', water: '#9fb3a6', waterLine: '#7c9284', forest: '#a3a46e', mountain: '#b98f5c', hills: '#cfae7b', desert: '#ecd19a', swamp: '#a9a67a', ice: '#efe6d4', farmland: '#d8bf82', district: '#dcbf8c', block: '#a87d4b', blockLine: '#5e3f1e', park: '#b0aa72', plaza: '#ead5aa', room: '#e6cc9c', hall: '#d9bb86', wall: '#4d3218', road: '#8b5e2f', roadCase: '#e8d3a8', river: '#5f8a8b', rail: '#4d3218', border: '#7a2e1c', ink: '#3b2510', labelInk: '#3b2510', halo: '#e8d3a8', pin: '#7a2e1c', pinRing: '#e8d3a8', grid: '#a9844f', glow: false, drawn: true }),
  modern: base('modern', 'Street map', { font: 'sans', bg: '#aad3df', paper: '#f2efe9', land: '#f2efe9', coast: '#9fb8c2', water: '#aad3df', waterLine: '#93c0cf', forest: '#c8e1b5', mountain: '#e3dccd', hills: '#ebe6d8', desert: '#f2e6c4', swamp: '#cfe0c8', ice: '#ffffff', farmland: '#eef0d5', district: '#ece7df', block: '#d9d0c9', blockLine: '#c4b8ad', park: '#c8facc', plaza: '#ffffff', room: '#ffffff', hall: '#f5f5f2', wall: '#5b5b5b', road: '#ffffff', roadCase: '#c9c1b5', river: '#8fc3d6', rail: '#9a9a9a', border: '#b07ab0', ink: '#4a4a4a', labelInk: '#3a3a3a', halo: '#ffffff', pin: '#d6453c', pinRing: '#ffffff', grid: '#dcd6cc', glow: false, drawn: false }),
  scifi: base('scifi', 'Survey scan', { font: 'mono', bg: '#06121f', paper: '#081a2b', land: '#0d2a40', coast: '#3fb6d9', water: '#06121f', waterLine: '#123a55', forest: '#10394a', mountain: '#18405a', hills: '#123850', desert: '#1b3a4d', swamp: '#0f3445', ice: '#2a5d78', farmland: '#13384c', district: '#0f3049', block: '#164565', blockLine: '#3fb6d9', park: '#0f3d45', plaza: '#123a55', room: '#0d2a40', hall: '#103550', wall: '#62d2f2', road: '#3fb6d9', roadCase: '#081a2b', river: '#2a8fbf', rail: '#8fe3ff', border: '#f2c14e', ink: '#8fe3ff', labelInk: '#c9f2ff', halo: '#06121f', pin: '#f2c14e', pinRing: '#06121f', grid: '#14354d', glow: true, drawn: false }),
  cyberpunk: base('cyberpunk', 'Neon grid', { font: 'mono', bg: '#07060c', paper: '#0d0b16', land: '#141127', coast: '#ff2bd6', water: '#07060c', waterLine: '#1d1a3a', forest: '#15232a', mountain: '#211a3a', hills: '#1a1630', desert: '#241a2e', swamp: '#13242a', ice: '#2b2a4a', farmland: '#18162b', district: '#171433', block: '#221d44', blockLine: '#00e5ff', park: '#0f2a2a', plaza: '#1e1a3c', room: '#141127', hall: '#1a1636', wall: '#ff2bd6', road: '#00e5ff', roadCase: '#0d0b16', river: '#3a5bff', rail: '#ffe14d', border: '#ffe14d', ink: '#00e5ff', labelInk: '#f4e9ff', halo: '#07060c', pin: '#ff2bd6', pinRing: '#07060c', grid: '#1b1830', glow: true, drawn: false }),
  steampunk: base('steampunk', 'Brass and soot', { font: 'serif', bg: '#7f8c86', paper: '#d8c7a3', land: '#cdb98f', coast: '#3b2e22', water: '#8e9c95', waterLine: '#6e7c75', forest: '#8f9a6f', mountain: '#a8916a', hills: '#bba57c', desert: '#d6c08a', swamp: '#8f9677', ice: '#e3ddd0', farmland: '#c4b07e', district: '#c2ab80', block: '#8a6d4a', blockLine: '#3b2e22', park: '#9aa27a', plaza: '#d8c7a3', room: '#d2be95', hall: '#c4ad82', wall: '#2c2219', road: '#6b5236', roadCase: '#d8c7a3', river: '#55706b', rail: '#2c2219', border: '#8a3b22', ink: '#2c2219', labelInk: '#2c2219', halo: '#d8c7a3', pin: '#a3572a', pinRing: '#e6d3a8', grid: '#9c8662', glow: false, drawn: true }),
  postapoc: base('postapoc', 'Salvage chart', { font: 'mono', bg: '#5d625a', paper: '#b9b2a0', land: '#aaa28c', coast: '#3f3a31', water: '#6e7468', waterLine: '#585e53', forest: '#7c8466', mountain: '#968a70', hills: '#a19780', desert: '#c3b38c', swamp: '#7a7f68', ice: '#cfcbc0', farmland: '#a39a7a', district: '#a29a85', block: '#7b725f', blockLine: '#3f3a31', park: '#868c6c', plaza: '#b9b2a0', room: '#b1aa97', hall: '#a39c88', wall: '#2e2a24', road: '#5a5345', roadCase: '#b9b2a0', river: '#55615c', rail: '#2e2a24', border: '#9c3a24', ink: '#2e2a24', labelInk: '#2e2a24', halo: '#b9b2a0', pin: '#c4501f', pinRing: '#2e2a24', grid: '#8c856f', glow: false, drawn: false }),
  gothic: base('gothic', 'Ink and ash', { font: 'serif', bg: '#2b2e33', paper: '#d4d0c6', land: '#c4bfb2', coast: '#1d1c1f', water: '#5b6168', waterLine: '#454a50', forest: '#7d8273', mountain: '#9a958a', hills: '#aea99c', desert: '#cbc2aa', swamp: '#7c8070', ice: '#e6e3dc', farmland: '#b8b29e', district: '#bdb7a8', block: '#7a756b', blockLine: '#1d1c1f', park: '#8f9481', plaza: '#d4d0c6', room: '#ccc7bb', hall: '#bdb7a9', wall: '#1d1c1f', road: '#4d4a47', roadCase: '#d4d0c6', river: '#4f5862', rail: '#1d1c1f', border: '#6b1f24', ink: '#1d1c1f', labelInk: '#1d1c1f', halo: '#d4d0c6', pin: '#6b1f24', pinRing: '#d4d0c6', grid: '#9a958a', glow: false, drawn: true }),
};

const THEME_WORDS: [ThemeKey, RegExp][] = [
  ['cyberpunk', /cyber|neon|megacorp|hacker|chrome|netrunner|synthwave/i],
  ['scifi', /sci-?fi|science fiction|space|star|orbital|galac|planet|colony|android|interstellar|futur|mars|asteroid/i],
  ['steampunk', /steam|clockwork|brass|airship|victorian|gaslight|industrial/i],
  ['postapoc', /post-?apoc|apocalyp|wasteland|ruins of|collapse|fallout|salvage|dystop/i],
  ['gothic', /gothic|horror|vampire|grimdark|eldritch|lovecraft|occult|haunted|noir/i],
  ['ancient', /bronze|ancient|antiquit|roman|greek|egypt|myth|classical|iron age/i],
  ['modern', /modern|contemporary|present day|urban|thriller|crime|realist|our world|real world/i],
  ['fantasy', /fantasy|magic|kingdom|dragon|elf|wizard|medieval|sword/i],
];

/** A world's map theme, read from what kind of world it is. */
export function themeFor(text: string): ThemeKey {
  for (const [k, re] of THEME_WORDS) if (re.test(text)) return k;
  return 'fantasy';
}

/** A distance in map units as words: "800 m", "3.2 km". */
export function formatDistance(units: number, scale: MapScale): string {
  const metres = units * scale.per * (scale.unit === 'km' ? 1000 : 1);
  if (metres < 1000) return `${Math.max(1, Math.round(metres / (metres < 50 ? 1 : 10)) * (metres < 50 ? 1 : 10))} m`;
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1).replace(/\.0$/, '') : Math.round(km).toLocaleString()} km`;
}

/** A tidy scale-bar length near a target, in map units, with its label. */
export function scaleBar(scale: MapScale, targetUnits: number): { units: number; label: string } {
  const metresPer = scale.per * (scale.unit === 'km' ? 1000 : 1);
  const want = targetUnits * metresPer;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
  const pickM = nice.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), nice[0]!);
  return { units: pickM / metresPer, label: pickM >= 1000 ? `${pickM / 1000} km` : `${pickM} m` };
}

const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
/** The compass direction from one point to another on a map (north is up). */
export function compass(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const a = Math.atan2(from.y - to.y, to.x - from.x);
  const i = Math.round(((a + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8;
  return DIRS[i]!;
}
