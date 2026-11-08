/**
 * A world map: one per place, drawn in the place's own idiom (a globe, a
 * regional map, a city plan, a site plan, a floor plan) and the world's own
 * style. Geometry lives in map units on a fixed canvas; the scale says what a
 * unit is worth, so distances between pins mean something in the story.
 */
export type MapKind = 'globe' | 'region' | 'city' | 'site' | 'floor';
export type ThemeKey = 'fantasy' | 'ancient' | 'modern' | 'scifi' | 'cyberpunk' | 'steampunk' | 'postapoc' | 'gothic';
export type Pt = [number, number];

export type AreaKind =
  | 'land' | 'water' | 'forest' | 'mountains' | 'hills' | 'desert' | 'swamp' | 'ice' | 'farmland'
  | 'district' | 'park' | 'plaza' | 'block'
  | 'room' | 'hall' | 'yard';
export type LineKind = 'river' | 'road' | 'track' | 'rail' | 'wall' | 'street' | 'avenue' | 'canal' | 'corridor' | 'border' | 'door';

export interface MapArea { id: string; kind: AreaKind; name?: string; points: Pt[]; /** Where decoration (trees, peaks) is drawn; derived, not edited. */ marks?: Pt[] }
export interface MapLine { id: string; kind: LineKind; name?: string; points: Pt[] }
export interface MapLabel { id: string; text: string; x: number; y: number; size: 's' | 'm' | 'l'; angle?: number; /** Names of water are set in italic, in the water's ink. */ water?: boolean }
export interface MapPin { id: string; /** The library place it stands for, when it is one. */ entityId: string | null; name: string; x: number; y: number }

export interface MapScale { unit: 'm' | 'km'; /** How many units one map unit is worth. */ per: number }

export interface MapDoc {
  locationId: string;
  universeId: string;
  kind: MapKind;
  theme: ThemeKey;
  title: string;
  /** Canvas size in map units. */
  w: number;
  h: number;
  scale: MapScale;
  /** What the canvas is before anything is drawn on it: land with seas cut in, or sea with land raised. */
  ground: 'land' | 'water';
  areas: MapArea[];
  lines: MapLine[];
  labels: MapLabel[];
  pins: MapPin[];
  seed: number;
  updatedAt: number;
}

export const MAP_W = 1000;
export const MAP_H = 700;
