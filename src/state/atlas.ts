import type { SQLiteDatabase } from 'expo-sqlite';
import { now } from '@/core/ids';
import { buildMap, emptyPlan, seaFor, type BuildChild } from '@/core/map/build';
import { hashOf } from '@/core/map/geom';
import { mapPlanPrompt, type PlanInput } from '@/core/map/plan';
import { mapKindOf, themeFor } from '@/core/map/style';
import type { MapDoc, MapKind, MapPin, ThemeKey } from '@/core/map/types';
import type { Library } from '@/core/world/drafts';
import type { WorldEntity } from '@/core/world/types';
import { getMap, listMaps, saveMap } from '@/db/repo/atlas';
import { getEntity } from '@/db/repo/world';
import { useJobs } from './jobs';
import { loadLibrary } from './library';
import { useSettings } from './settings';

/**
 * Drawing a place's map. The model sketches a plan from the entries (what
 * is inside the place, where it sits, what the world is like); the builder
 * gives it shape. With no model, the builder sketches it alone.
 */

const str = (v: unknown) => (typeof v === 'string' ? v : '');
export const placeType = (e: WorldEntity) => str(e.data.type);

/** A place and the places it sits within, innermost first. */
export function chainOf(lib: Library, id: string): WorldEntity[] {
  const byId = new Map(lib.entities.map((e) => [e.id, e]));
  const out: WorldEntity[] = [];
  let at = byId.get(id);
  const seen = new Set<string>();
  while (at && !seen.has(at.id)) { out.push(at); seen.add(at.id); at = at.parentId ? byId.get(at.parentId) : undefined; }
  return out;
}

export const childrenOf = (lib: Library, id: string) => lib.entities.filter((e) => e.kind === 'location' && e.parentId === id);

/** The map style a world's maps start in: its parent's map style if it has one, else read from the world. */
export async function themeOf(db: SQLiteDatabase, lib: Library, place: WorldEntity): Promise<ThemeKey> {
  for (const p of chainOf(lib, place.id).slice(1)) {
    const m = await getMap(db, p.id);
    if (m) return m.theme;
  }
  const u = lib.universe;
  if (!u) return 'fantasy';
  if (u.isDefault) return 'modern';
  return themeFor([u.data.genre, u.data.rules, u.data.themes, u.description, u.data.art?.look ?? ''].filter(Boolean).join(' '));
}

export const kindOfPlace = (e: WorldEntity): MapKind => mapKindOf(placeType(e));

function planInput(lib: Library, place: WorldEntity, kind: MapKind, theme: ThemeKey, wish?: string): PlanInput {
  const info = (e: WorldEntity) => ({ name: e.name, type: placeType(e), summary: e.summary || str(e.data.description).slice(0, 160) });
  const chain = chainOf(lib, place.id);
  const siblings = place.parentId ? lib.entities.filter((e) => e.kind === 'location' && e.parentId === place.parentId && e.id !== place.id).map((e) => e.name).slice(0, 12) : [];
  const u = lib.universe;
  return {
    kind,
    place: { ...info(place), description: [str(place.data.description), str(place.data.life)].filter(Boolean).join(' ') },
    children: childrenOf(lib, place.id).map(info).slice(0, 30),
    within: chain.slice(1).reverse().map(info),
    siblings,
    world: { name: u?.name ?? 'The world', genre: u?.data.genre ?? '', rules: (u?.data.rules ?? '').slice(0, 400) },
    theme,
    wish,
  };
}

const buildChildren = (lib: Library, id: string): BuildChild[] => childrenOf(lib, id).map((c) => ({ id: c.id, name: c.name, type: placeType(c) }));

export interface DrawOptions { kind?: MapKind; theme?: ThemeKey; wish?: string; keepPins?: MapPin[] }

/** Ask the model for a map, in the background. A first map goes straight onto the place; a redraw waits in the inbox. */
export async function drawMap(db: SQLiteDatabase, locationId: string, o: DrawOptions = {}): Promise<string | null> {
  const ent = await getEntity(db, locationId);
  if (!ent) return null;
  const lib = await loadLibrary(db, ent.universeId);
  const place = lib.entities.find((e) => e.id === locationId);
  if (!place) return null;
  const kind = o.kind ?? kindOfPlace(place);
  const theme = o.theme ?? (await themeOf(db, lib, place));
  const messages = mapPlanPrompt(planInput(lib, place, kind, theme, o.wish));
  const j = await useJobs.getState().enqueue(db, 'map', {
    universeId: place.universeId,
    title: `Map of ${place.name}`,
    input: { model: useSettings.getState().defaults.models.helper, messages, maxTokens: 5000, kindFixed: !!o.kind, locationId, mapKind: kind, theme, title: place.name, children: buildChildren(lib, place.id), seed: hashOf(locationId, now()), keepPins: o.keepPins },
  });
  return j.id;
}

/** A map drawn on the spot with no model: the builder invents the land around the place's recorded children. */
export async function sketchMap(db: SQLiteDatabase, locationId: string, o: DrawOptions & { seed?: number } = {}): Promise<MapDoc | null> {
  const ent = await getEntity(db, locationId);
  if (!ent) return null;
  const lib = await loadLibrary(db, ent.universeId);
  const place = lib.entities.find((e) => e.id === locationId);
  if (!place) return null;
  const kind = o.kind ?? kindOfPlace(place);
  const theme = o.theme ?? (await themeOf(db, lib, place));
  const seed = o.seed ?? hashOf(locationId, now());
  return buildMap(emptyPlan(place.name, seaFor(kind, seed)), { locationId, universeId: place.universeId, kind, theme, title: place.name, children: buildChildren(lib, place.id), seed, now: now(), keepPins: o.keepPins });
}

/** Is a map being drawn for this place right now? */
export const drawing = (locationId: string) => useJobs.getState().jobs.find((j) => j.kind === 'map' && (j.status === 'queued' || j.status === 'running') && (j.input as { locationId: string }).locationId === locationId);

export { getMap, listMaps, saveMap };
