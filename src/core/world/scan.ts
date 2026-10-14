import type { Character, LoreEntry, Species } from '../types';
import type { EntityRef, WorldEntity } from './types';

/** True when `name` appears in `hay` as a whole word (case-insensitive). */
export function mentions(hay: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(hay);
}

/** Elements whose name or extra keys come up in the text. */
export function scanEntities<T extends { name: string; keys?: string[] }>(items: T[], hay: string): T[] {
  if (!hay.trim()) return [];
  return items.filter((e) => mentions(hay, e.name) || (e.keys ?? []).some((k) => mentions(hay, k)));
}

/** Root-first chain: "Vell › Drowned Quarter › Tide Market". */
export function locationChain(id: string | null | undefined, entities: WorldEntity[]): WorldEntity[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out: WorldEntity[] = [];
  const seen = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

export function childrenOf(id: string | null, entities: WorldEntity[]): WorldEntity[] {
  return entities.filter((e) => e.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve names the chronicler mentions to library elements. Unmatched names are kept as plain names. */
export function resolveRefs(names: string[], pool: { characters: Character[]; entities: WorldEntity[]; species: Species[] }): EntityRef[] {
  const out: EntityRef[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const lc = name.toLowerCase();
    const eq = (s: string) => s.toLowerCase() === lc || s.toLowerCase().split(/\s+/)[0] === lc;
    const c = pool.characters.find((x) => eq(x.name));
    if (c) { out.push({ kind: 'character', id: c.id, name: c.name }); continue; }
    const e = pool.entities.find((x) => eq(x.name) || x.keys.includes(lc));
    if (e) { out.push({ kind: e.kind, id: e.id, name: e.name }); continue; }
    const sp = pool.species.find((x) => eq(x.name));
    if (sp) { out.push({ kind: 'species', id: sp.id, name: sp.name }); continue; }
    out.push({ kind: 'unknown', id: null, name });
  }
  const seen = new Set<string>();
  return out.filter((r) => { const k = r.id ?? r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function loreScanText(lore: LoreEntry[]): string {
  return lore.map((l) => l.title).join(' ');
}
