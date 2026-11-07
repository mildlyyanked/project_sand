import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Library, LibKind } from '@/core/world/drafts';
import { libraryDrafts } from '@/core/world/drafts';
import { edges, type Edge } from '@/core/world/links';
import { imageOf } from '@/core/world/portraits';
import { loadLibrary } from '@/state/library';
import { refOptions } from './worldRefs';

export interface EntryRef { id: string; kind: LibKind; name: string; image?: string; hint: string; type: string }

/** Every entry of a library in one flat index: what lists, search, pickers and connections all read. */
export function indexLibrary(lib: Library): EntryRef[] {
  const out: EntryRef[] = [];
  for (const e of lib.entities) out.push({ id: e.id, kind: e.kind, name: e.name, image: imageOf(e.data)?.uri, hint: e.summary, type: typeof e.data.type === 'string' ? e.data.type : '' });
  for (const c of lib.characters) out.push({ id: c.id, kind: 'character', name: c.name, image: imageOf(c.data as Record<string, unknown>)?.uri, hint: c.summary || c.data.occupation || '', type: c.data.occupation ?? '' });
  for (const s of lib.species) out.push({ id: s.id, kind: 'species', name: s.name, image: imageOf(s.data)?.uri, hint: s.adulthood, type: '' });
  for (const l of lib.lore) out.push({ id: l.id, kind: 'lore', name: l.title, hint: l.text.slice(0, 120), type: l.category === 'other' ? '' : l.category });
  return out;
}

/**
 * A world's library, kept fresh whenever the screen comes into focus, with
 * what screens derive from it: the link graph, the entry index, reference
 * options and drafts.
 */
export function useWorld(universeId: string | null | undefined) {
  const db = useSQLiteContext();
  const [lib, setLib] = useState<Library | null>(null);
  const reload = useCallback(async () => {
    const l = await loadLibrary(db, universeId ?? null);
    setLib(l);
    return l;
  }, [db, universeId]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  const derived = useMemo(() => {
    if (!lib) return null;
    const graph: Edge[] = edges(lib, lib.links ?? []);
    const index = indexLibrary(lib);
    const byId = new Map(index.map((x) => [x.id, x]));
    return { graph, index, byId, refs: refOptions(lib.entities, lib.characters, [], lib.species), pool: libraryDrafts(lib) };
  }, [lib]);
  return { lib, reload, ...(derived ?? { graph: [] as Edge[], index: [] as EntryRef[], byId: new Map<string, EntryRef>(), refs: {}, pool: [] }) };
}
