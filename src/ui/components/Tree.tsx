import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { WorldEntity } from '@/core/world/types';
import { imageOf } from '@/core/world/portraits';
import { Ionicons, T, matches } from './index';
import { radius, useTheme } from '../theme';

const ICON = { location: 'location-outline', organization: 'flag-outline', item: 'cube-outline' } as const;

/**
 * Places, factions or things as a tree: children fold under their parent
 * (closed until opened), with each entry's picture beside it. A search query
 * flattens the tree to the matches, each with the path it sits in.
 */
export function EntityTree({ items, onOpen, query = '' }: { items: WorldEntity[]; onOpen: (e: WorldEntity) => void; query?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { kids, roots, byId } = useMemo(() => {
    const byId = new Map(items.map((e) => [e.id, e]));
    const kids = new Map<string, WorldEntity[]>();
    const roots: WorldEntity[] = [];
    for (const e of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.parentId && byId.has(e.parentId)) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e]);
      else roots.push(e);
    }
    return { kids, roots, byId };
  }, [items]);

  const pathOf = (e: WorldEntity) => {
    const out: string[] = [];
    let p = e.parentId ? byId.get(e.parentId) : undefined;
    while (p && out.length < 6) { out.unshift(p.name); p = p.parentId ? byId.get(p.parentId) : undefined; }
    return out.join(' › ');
  };
  const descendants = (id: string): number => (kids.get(id) ?? []).reduce((n, k) => n + 1 + descendants(k.id), 0);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (query.trim()) {
    const hits = items.filter((e) => matches(query, e.name, e.summary, e.keys.join(' '), typeof e.data.type === 'string' ? e.data.type : '', typeof e.data.description === 'string' ? e.data.description : ''));
    if (!hits.length) return <T v="faint">Nothing matches “{query.trim()}”.</T>;
    return <>{hits.sort((a, b) => a.name.localeCompare(b.name)).map((e) => <TreeRow key={e.id} e={e} depth={0} path={pathOf(e)} onOpen={onOpen} />)}</>;
  }

  const render = (e: WorldEntity, depth: number): React.ReactNode => {
    const children = kids.get(e.id) ?? [];
    const isOpen = open.has(e.id);
    return (
      <React.Fragment key={e.id}>
        <TreeRow e={e} depth={depth} onOpen={onOpen} count={children.length ? descendants(e.id) : 0} open={isOpen} onToggle={children.length ? () => toggle(e.id) : undefined} />
        {isOpen ? children.map((c) => render(c, depth + 1)) : null}
      </React.Fragment>
    );
  };
  return <>{roots.map((e) => render(e, 0))}</>;
}

function TreeRow({ e, depth, onOpen, path, count = 0, open, onToggle }: { e: WorldEntity; depth: number; onOpen: (e: WorldEntity) => void; path?: string; count?: number; open?: boolean; onToggle?: () => void }) {
  const t = useTheme();
  const img = imageOf(e.data);
  const type = typeof e.data.type === 'string' ? e.data.type : '';
  return (
    <Pressable onPress={() => onOpen(e)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: depth * 18, opacity: pressed ? 0.7 : 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border })}>
      {onToggle ? (
        <Pressable onPress={onToggle} hitSlop={10} style={{ width: 20, alignItems: 'center' }}>
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={t.dim} />
        </Pressable>
      ) : <View style={{ width: 20 }} />}
      {img ? (
        <Image source={{ uri: img.uri }} style={{ width: 40, height: 40, borderRadius: e.kind === 'organization' ? 20 : radius.sm, backgroundColor: t.surface2 }} />
      ) : (
        <View style={{ width: 40, height: 40, borderRadius: e.kind === 'organization' ? 20 : radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={ICON[e.kind]} size={18} color={t.faint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1}>{e.name}</T>
        <T v="faint" numberOfLines={2}>{[path ? `in ${path}` : '', type, e.summary].filter(Boolean).join(' · ')}</T>
      </View>
      {count && !open ? <T v="small" style={{ color: t.dim }}>{count}</T> : null}
    </Pressable>
  );
}
