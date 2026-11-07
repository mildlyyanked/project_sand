import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { LoreEntry } from '@/core/types';
import type { StoredLink } from '@/core/world/links';
import { LORE_CATEGORIES } from '@/core/world/schema';
import { deleteLore, getLore, saveLore } from '@/db/repo/library';
import { linksOf, syncLinks } from '@/db/repo/links';
import { Badge, Button, Chip, Field, Row, Screen, Stepper, SwitchRow, T } from '@/ui/components';
import { KeysField } from '@/ui/components/World';
import { useEntryReforge } from '@/ui/components/Reforge';
import { RetconSheet } from '@/ui/components/Retcon';
import { Block, ConnectionsView, EditActions, EditingBar, Lede, TiesEditor, useEditable, useLeaveGuard, useStartEditing, workshopRoute } from '@/ui/components/Entry';
import { useWorld } from '@/ui/useWorld';

interface Editable { id: string; row: LoreEntry; links: StoredLink[] }

/** A lore entry: read as a page, edited with save and discard. */
export default function LorePage() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const db = useSQLiteContext();
  const ed = useEditable<Editable>(
    async () => { const row = await getLore(db, id!); return row ? { id: row.id, row, links: await linksOf(db, row.id) } : null; },
    async (v) => { await saveLore(db, v.row); await syncLinks(db, v.id, v.links); },
    [id],
  );
  const l = ed.value?.row ?? null;
  const w = useWorld(l?.universeId);
  const [retconOpen, setRetconOpen] = useState(false);
  const rowOf = useCallback(() => (ed.value ? { kind: 'lore' as const, row: ed.value.row } : null), [ed.value]);
  const takeSelf = useCallback((row: unknown) => ed.setBuffer((b) => (b ? { ...b, row: row as LoreEntry } : b)), [ed]);
  const rf = useEntryReforge({ db, universeId: l?.universeId, row: rowOf, onSelf: takeSelf });
  useLeaveGuard(ed.dirty, ed.commit);
  useStartEditing(edit, !!ed.saved, ed.begin);
  if (!l || !ed.value) return null;
  const set = (p: Partial<LoreEntry>) => ed.change({ row: { ...l, ...p } });

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Lore', headerRight: () => <EditActions editing={ed.editing} dirty={ed.dirty} saving={ed.saving} onEdit={ed.begin} onSave={() => void ed.commit()} onDiscard={ed.discard} /> }} />
      {ed.editing ? (
        <>
          <EditingBar dirty={ed.dirty} />
          <View style={{ gap: 14 }}>
            <Field label="Title" value={l.title} onChangeText={(v) => set({ title: v })} onForge={() => void rf.open('name')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {LORE_CATEGORIES.map((c) => <Chip key={c} small label={c} selected={l.category === c} onPress={() => set({ category: c })} />)}
            </ScrollView>
            <KeysField label="Keywords" hint="Comma separated. Any of these in the recent passages brings this entry in." value={l.keys} onChange={(keys) => set({ keys })} onForge={() => void rf.open('keys')} />
            <Field label="Text" value={l.text} onChangeText={(v) => set({ text: v })} multiline style={{ minHeight: 160 }} onForge={() => void rf.open('text')} />
            <SwitchRow label="Always on" hint="Rides with the world description in every scene." value={l.alwaysOn} onChange={(v) => set({ alwaysOn: v })} />
            <Row between><T>Priority</T><Stepper value={l.priority} min={0} max={10} onChange={(v) => set({ priority: v })} /></Row>
          </View>
          <Block title="Ties">
            <TiesEditor id={l.id} kind="lore" universeId={l.universeId} links={ed.value.links} onChange={(links) => ed.change({ links })} index={w.index} graph={w.graph} />
          </Block>
          <Block title="Danger zone">
            <Button kind="danger" title="Delete entry" onPress={() => Alert.alert(`Delete ${l.title}?`, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteLore(db, l.id); ed.discard(); setTimeout(() => router.back(), 0); } }])} />
          </Block>
        </>
      ) : (
        <>
          <Lede kicker={['Lore', l.category !== 'other' ? l.category : ''].filter(Boolean).join(' · ')} title={l.title} badges={[
            l.alwaysOn ? <Badge key="a" label="always on" tone="accent" /> : null,
            l.priority ? <Badge key="p" label={`priority ${l.priority}`} /> : null,
            l.keys.length ? <T key="k" v="faint">Comes in on {l.keys.join(', ')}</T> : <T key="k" v="faint">No keywords: only comes in when always on.</T>,
          ]} />
          {l.text.split(/\n{2,}/).map((p, i) => <T key={i} v="serif" style={{ lineHeight: 26, marginBottom: 10 }}>{p.trim()}</T>)}
          <Block title="Connections"><ConnectionsView id={l.id} graph={w.graph} byId={w.byId} empty="Not tied to any entry yet." /></Block>
          <Block title="Grow it">
            <Row style={{ flexWrap: 'wrap' }}>
              <Button small kind="outline" title="Take it further" onPress={() => router.push(workshopRoute(l.universeId, { kind: 'lore', id: l.id }, 'related lore: what it leads to, contradicts or hides') as never)} />
              <Button small kind="outline" icon="chatbubbles-outline" title="Talk it through" onPress={() => router.push(workshopRoute(l.universeId, { kind: 'lore', id: l.id }) as never)} />
              <Button small kind="outline" icon="git-compare-outline" title="Retcon" onPress={() => setRetconOpen(true)} />
            </Row>
          </Block>
        </>
      )}
      {rf.sheet}
      <RetconSheet open={retconOpen} onClose={() => { setRetconOpen(false); void ed.reload(); }} universeId={l.universeId} row={rowOf} onSelf={(row) => void ed.persist({ row: row as LoreEntry })} />
      <View style={{ height: 40 }} />
    </Screen>
  );
}
