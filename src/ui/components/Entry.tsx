import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { FieldDef, Section } from '@/core/world/schema';
import { SECTION_LABEL, SECTION_ORDER, levelOf } from '@/core/world/schema';
import type { LibKind } from '@/core/world/drafts';
import { KIND_NOUN } from '@/core/world/drafts';
import { STORED, STORED_TYPES, connectionsOf, groupConnections, type Edge, type StoredLink, type StoredType } from '@/core/world/links';
import { newId, now } from '@/core/ids';
import type { EntryRef } from '@/ui/useWorld';
import { Badge, Button, Chip, Field, FieldLabel, IconButton, Ionicons, Row, SearchBox, T, matches } from './index';
import { FieldEditor, type RefOptions } from './World';
import { radius, space, useTheme } from '../theme';

/** Where an entry of each kind opens. */
export function entryRoute(kind: LibKind, id: string): string {
  switch (kind) {
    case 'character': return `/library/character/${id}`;
    case 'species': return `/library/species/${id}`;
    case 'lore': return `/library/lore/${id}`;
    case 'world': return `/library/universe/${id}`;
    default: return `/library/entity/${id}`;
  }
}
export const openEntry = (kind: LibKind, id: string) => router.push(entryRoute(kind, id) as never);

/** The world's workshop, about an entry when there is one, with what the writer wants from it. */
export function workshopRoute(universeId: string, focus?: { kind: LibKind; id: string } | null, intent?: string): string {
  const q = [focus ? `focus=${encodeURIComponent(focus.id)}&kind=${focus.kind}` : '', intent ? `intent=${encodeURIComponent(intent)}` : ''].filter(Boolean).join('&');
  return `/world/workshop/${universeId}${q ? `?${q}` : ''}`;
}

// ---------------------------------------------------------------------------
// View and edit

/**
 * An entry that is read in a view and changed in an edit: edits go to a
 * buffer, Save writes it, Discard drops it, and leaving with unsaved edits
 * asks first. Outside edit mode, `persist` writes a small change (a new
 * picture) straight through.
 */
export function useEditable<T extends { id: string }>(load: () => Promise<T | null>, save: (v: T) => Promise<void>, deps: unknown[]) {
  const [saved, setSaved] = useState<T | null>(null);
  const [buffer, setBuffer] = useState<T | null>(null);
  const [saving, setSaving] = useState(false);
  // The latest loader, for reloads; it loads again when what it loads (deps) changes.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const reload = useCallback(async () => {
    const v = await loadRef.current();
    setSaved(v);
    return v;
  }, []);
  const key = JSON.stringify(deps);
  useEffect(() => { void reload(); }, [key, reload]);
  const editing = buffer !== null;
  const dirty = editing && JSON.stringify(buffer) !== JSON.stringify(saved);
  const begin = useCallback(() => setBuffer((b) => b ?? saved), [saved]);
  const change = useCallback((p: Partial<T>) => setBuffer((b) => (b ? { ...b, ...p } : b)), []);
  const discard = useCallback(() => setBuffer(null), []);
  const commit = useCallback(async () => {
    if (!buffer) return;
    setSaving(true);
    try {
      await save(buffer);
      setSaved(buffer);
      setBuffer(null);
    } finally {
      setSaving(false);
    }
  }, [buffer, save]);
  const persist = useCallback(async (p: Partial<T>) => {
    if (buffer) { setBuffer({ ...buffer, ...p }); return; }
    if (!saved) return;
    const next = { ...saved, ...p };
    await save(next);
    setSaved(next);
  }, [buffer, saved, save]);
  const value = buffer ?? saved;
  return { saved, value, editing, dirty, saving, begin, change, setBuffer, discard, commit, persist, reload };
}

/** A new entry opens straight into editing. */
export function useStartEditing(flag: string | undefined, ready: boolean, begin: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (flag && ready && !done.current) { done.current = true; begin(); }
  }, [flag, ready, begin]);
}

/** Leaving with unsaved edits asks: save, discard, or stay. */
export function useLeaveGuard(dirty: boolean, save: () => Promise<void>) {
  const navigation = useNavigation();
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert('Unsaved changes', 'Save them before you go?', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
      { text: 'Save', onPress: async () => { await save(); navigation.dispatch(data.action); } },
    ]);
  });
}

/** The header's actions: Edit in a view; Discard and Save while editing. */
export function EditActions({ editing, dirty, saving, onEdit, onSave, onDiscard, extra }: { editing: boolean; dirty: boolean; saving?: boolean; onEdit: () => void; onSave: () => void; onDiscard: () => void; extra?: React.ReactNode }) {
  if (!editing) return <Row gap={2}>{extra}<IconButton name="create-outline" onPress={onEdit} /></Row>;
  return (
    <Row gap={6}>
      <Button small kind="ghost" title="Discard" onPress={() => (dirty ? Alert.alert('Discard your changes?', undefined, [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onDiscard }]) : onDiscard())} />
      <Button small title={dirty ? 'Save' : 'Done'} icon="checkmark" loading={saving} onPress={dirty ? onSave : onDiscard} />
    </Row>
  );
}

/** A strip under the header while editing: what is unsaved, with the same two actions. */
export function EditingBar({ dirty }: { dirty: boolean }) {
  const t = useTheme();
  return (
    <Row gap={6} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: t.surface2, marginBottom: space.sm }}>
      <Ionicons name={dirty ? 'ellipse' : 'create-outline'} size={10} color={dirty ? t.warn : t.dim} />
      <T v="small" style={{ flex: 1 }}>{dirty ? 'Unsaved changes. Save keeps them; Discard goes back.' : 'Editing. Nothing changed yet.'}</T>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Reading an entry

/** The head of an entry: kind and type over the name, a one-line lede, the picture beside or above. */
export function Lede({ kicker, title, lede, picture, badges }: { kicker: string; title: string; lede?: string; picture?: React.ReactNode; badges?: React.ReactNode }) {
  return (
    <View style={{ gap: 10, marginBottom: space.md }}>
      {picture}
      <View style={{ gap: 4 }}>
        <T v="label">{kicker}</T>
        <T v="title">{title}</T>
        {badges ? <Row gap={6} style={{ flexWrap: 'wrap' }}>{badges}</Row> : null}
        {lede ? <T v="serif" style={{ fontSize: 18, lineHeight: 27, marginTop: 4 }}>{lede}</T> : null}
      </View>
    </View>
  );
}

const shown = (def: FieldDef, v: unknown): string => {
  if (v == null || v === '' || def.type === 'ref' || def.type === 'ties' || def.type === 'bool') return '';
  if (def.type === 'level') { const l = def.levels ? levelOf(def.levels, v) : null; return l ? `${l.label}. ${l.hint}` : ''; }
  if (def.type === 'number') return Number(v) ? String(v) : '';
  if (def.type === 'keys') return Array.isArray(v) ? v.join(', ') : '';
  if (def.type === 'effects' && typeof v === 'object') return Object.entries(v as Record<string, number>).map(([k, n]) => `${k} ${n > 0 ? '+' : ''}${n}`).join(', ');
  return typeof v === 'string' ? v.trim() : String(v);
};

/** Short facts (rarity, value, occupation) as one row of quiet labels. */
function Facts({ items }: { items: { label: string; value: string }[] }) {
  const t = useTheme();
  if (!items.length) return null;
  return (
    <Row gap={8} style={{ flexWrap: 'wrap' }}>
      {items.map((x) => (
        <View key={x.label} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, backgroundColor: t.surface2, gap: 1 }}>
          <T v="small">{x.label}</T>
          <T>{x.value}</T>
        </View>
      ))}
    </Row>
  );
}

function Prose({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ gap: 4 }}>
      <T v="small" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</T>
      {text.split(/\n{2,}/).map((p, i) => <T key={i} v="serif" style={{ lineHeight: 25 }}>{p.trim()}</T>)}
    </View>
  );
}

/**
 * An entry's fields as a page: short facts in a row, then each section with
 * its paragraphs. Hidden things (secrets) stay folded until asked for, so the
 * page can be read over someone's shoulder.
 */
export function SectionsView({ defs, data, play = true, extra }: { defs: FieldDef[]; data: Record<string, unknown>; play?: boolean; extra?: Partial<Record<Section, { label: string; text: string }[]>> }) {
  const t = useTheme();
  const [reveal, setReveal] = useState(false);
  const facts = defs.filter((d) => d.section === 'basics' && d.key !== 'type' && (d.type === 'select' || d.type === 'number' || d.type === 'text')).map((d) => ({ label: d.label, value: shown(d, data[d.key]) })).filter((x) => x.value);
  const blocks: React.ReactNode[] = [];
  for (const sec of SECTION_ORDER) {
    const items = [...defs.filter((d) => d.section === sec && !(sec === 'basics' && (d.type === 'select' || d.type === 'number' || d.type === 'text')) && (play || !d.play)).map((d) => ({ label: d.label, text: shown(d, data[d.key]) })), ...(extra?.[sec] ?? [])].filter((x) => x.text);
    if (!items.length) continue;
    if (sec === 'hidden' && !reveal) {
      blocks.push(
        <Pressable key={sec} onPress={() => setReveal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: t.border }}>
          <Ionicons name="eye-off-outline" size={16} color={t.dim} />
          <T v="dim" style={{ flex: 1 }}>{items.length === 1 ? items[0]!.label : `${items.length} hidden things`}: tap to read</T>
        </Pressable>,
      );
      continue;
    }
    blocks.push(
      <View key={sec} style={{ gap: 12 }}>
        <T v="h">{SECTION_LABEL[sec]}</T>
        {items.map((x) => <Prose key={x.label} label={x.label} text={x.text} />)}
      </View>,
    );
  }
  return (
    <View style={{ gap: 22 }}>
      <Facts items={facts} />
      {blocks}
    </View>
  );
}

/** The same fields, editable, under the same section headings. References are not here: they are connections. */
export function SectionsEditor({ defs, data, refs, onChange, onForge, play = true, refsInline = true }: { defs: FieldDef[]; data: Record<string, unknown>; refs?: RefOptions; onChange: (p: Record<string, unknown>) => void; onForge?: (d: FieldDef) => void; play?: boolean; refsInline?: boolean }) {
  const refDefs = defs.filter((d) => d.type === 'ref');
  return (
    <View style={{ gap: 22 }}>
      {SECTION_ORDER.map((sec) => {
        const ds = defs.filter((d) => d.section === sec && d.type !== 'ref' && (play || !d.play));
        if (!ds.length) return null;
        return (
          <View key={sec} style={{ gap: 10 }}>
            <T v="h">{SECTION_LABEL[sec]}</T>
            <FieldEditor defs={ds} data={data} onChange={onChange} onForge={onForge} />
          </View>
        );
      })}
      {refsInline && refDefs.length ? (
        <View style={{ gap: 10 }}>
          <T v="h">Where it stands</T>
          <FieldEditor defs={refDefs} data={data} refs={refs} onChange={onChange} onForge={onForge} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Connections

function EntryChip({ e, note, onPress }: { e: EntryRef | undefined; note?: string; onPress?: () => void }) {
  const t = useTheme();
  if (!e) return null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.7 : 1, maxWidth: 280 })}>
      <MiniAvatar e={e} />
      <View style={{ flexShrink: 1 }}>
        <T numberOfLines={1}>{e.name}</T>
        {note ? <T v="small" numberOfLines={2}>{note}</T> : <T v="small" numberOfLines={1}>{[KIND_NOUN[e.kind], e.type].filter(Boolean).join(' · ')}</T>}
      </View>
    </Pressable>
  );
}

export function MiniAvatar({ e, size = 30 }: { e: Pick<EntryRef, 'kind' | 'name' | 'image'>; size?: number }) {
  const t = useTheme();
  const icon = ({ location: 'location-outline', organization: 'flag-outline', item: 'cube-outline', character: 'person-outline', species: 'body-outline', lore: 'book-outline', world: 'planet-outline' } as const)[e.kind];
  if (e.image) return <Image source={{ uri: e.image }} style={{ width: size, height: size, borderRadius: e.kind === 'character' ? size / 2 : radius.sm, backgroundColor: t.surface2 }} />;
  return <View style={{ width: size, height: size, borderRadius: e.kind === 'character' ? size / 2 : radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={size * 0.5} color={t.dim} /></View>;
}

/** Everything an entry is linked to, grouped by how, each a tap away. */
export function ConnectionsView({ id, graph, byId, empty }: { id: string; graph: Edge[]; byId: Map<string, EntryRef>; empty?: string }) {
  const groups = groupConnections(connectionsOf(id, graph).filter((c) => byId.has(c.other)));
  if (!groups.length) return empty ? <T v="faint">{empty}</T> : null;
  return (
    <View style={{ gap: 14 }}>
      {groups.map((g) => (
        <View key={g.label} style={{ gap: 6 }}>
          <T v="small" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{g.label} · {g.items.length}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {g.items.map((c, i) => { const e = byId.get(c.other); return <EntryChip key={`${c.other}:${i}`} e={e} note={c.note} onPress={() => e && openEntry(e.kind, e.id)} />; })}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

/** The tie types that make sense from one kind of entry to another, most likely first. */
function typesFor(a: LibKind, b: LibKind): StoredType[] {
  const fits = (t: StoredType) => !STORED[t].between || (STORED[t].between!.includes(a) && STORED[t].between!.includes(b));
  return STORED_TYPES.filter(fits);
}

/**
 * The stored ties of an entry, editable: each with its type and a line of
 * note, a way to add one to anything in the world, and the ties that come
 * from fields listed beneath, read only, with where to change them.
 */
export function TiesEditor({ id, kind, universeId, links, onChange, index, graph }: { id: string; kind: LibKind; universeId: string; links: StoredLink[]; onChange: (links: StoredLink[]) => void; index: EntryRef[]; graph: Edge[] }) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const byId = new Map(index.map((x) => [x.id, x]));
  const mine = links.filter((l) => l.from === id || l.to === id);
  const set = (lid: string, p: Partial<StoredLink>) => onChange(links.map((l) => (l.id === lid ? { ...l, ...p } : l)));
  const derived = connectionsOf(id, graph).filter((c) => c.edge.derived && byId.has(c.other));
  const candidates = index.filter((x) => x.id !== id && matches(q, x.name, x.hint, x.type)).slice(0, 30);
  return (
    <View style={{ gap: 12 }}>
      {mine.map((l) => {
        const other = byId.get(l.from === id ? l.to : l.from);
        if (!other) return null;
        const out = l.from === id;
        const opts = typesFor(kind, other.kind);
        return (
          <View key={l.id} style={{ gap: 8, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }}>
            <Row between>
              <Row gap={8} style={{ flex: 1 }}><MiniAvatar e={other} size={26} /><T numberOfLines={1} style={{ flexShrink: 1 }}>{other.name}</T></Row>
              <IconButton name="trash-outline" size={18} onPress={() => onChange(links.filter((x) => x.id !== l.id))} />
            </Row>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {(opts.includes(l.type) ? opts : [l.type, ...opts]).map((ty) => <Chip key={ty} small label={out ? STORED[ty].label : STORED[ty].inverse} selected={l.type === ty} onPress={() => set(l.id, { type: ty })} />)}
            </ScrollView>
            <Field value={l.note} onChangeText={(note) => set(l.id, { note })} placeholder={`How: e.g. ${kind === 'character' && other.kind === 'character' ? 'her older brother; owes him a ship' : 'since the flood; over the salt rights'}`} />
          </View>
        );
      })}
      {adding ? (
        <View style={{ gap: 8 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Tie to…" />
          {candidates.map((x) => (
            <Pressable key={x.id} onPress={() => { const ty = typesFor(kind, x.kind)[0] ?? 'tied'; onChange([...links, { id: newId(), universeId, from: id, to: x.id, type: kind === 'character' && x.kind === 'character' ? 'knows' : ty, note: '', createdAt: now() }]); setAdding(false); setQ(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <MiniAvatar e={x} size={26} />
              <T style={{ flex: 1 }} numberOfLines={1}>{x.name}</T>
              <Badge label={KIND_NOUN[x.kind].toLowerCase()} />
            </Pressable>
          ))}
          {!candidates.length ? <T v="faint">Nothing in the world matches.</T> : null}
          <Button small kind="ghost" title="Cancel" onPress={() => { setAdding(false); setQ(''); }} />
        </View>
      ) : (
        <Button small kind="outline" icon="link-outline" title="Add a tie" onPress={() => setAdding(true)} />
      )}
      {derived.length ? (
        <View style={{ gap: 4 }}>
          <FieldLabel label="From its fields" />
          {derived.map((c, i) => <T key={i} v="faint">{c.label} {byId.get(c.other)?.name}{c.note ? ` (${c.note})` : ''}</T>)}
          <T v="faint">Change these where they are set: where it sits, its home, leader, owner.</T>
        </View>
      ) : null}
    </View>
  );
}

/** A heading for a block of an entry page, with an optional action. */
export function Block({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10, paddingTop: space.lg, marginTop: space.md, borderTopWidth: 1, borderTopColor: t.border }}>
      <Row between><T v="h">{title}</T>{right}</Row>
      {children}
    </View>
  );
}
