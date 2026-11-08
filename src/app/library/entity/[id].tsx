import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { WorldEntity } from '@/core/world/types';
import { FIELDS_BY_KIND, KIND_LABEL } from '@/core/world/schema';
import { childrenOf, locationChain } from '@/core/world/scan';
import type { StoredLink } from '@/core/world/links';
import { deleteEntity, getEntity, newEntity, saveEntity } from '@/db/repo/world';
import { linksOf, syncLinks } from '@/db/repo/links';
import { entityDraft } from '@/core/world/drafts';
import { Button, Field, FieldLabel, Row, Screen, T } from '@/ui/components';
import { KeysField, RefChips } from '@/ui/components/World';
import { useEntryReforge } from '@/ui/components/Reforge';
import { Avatar, EntryImage } from '@/ui/components/EntryImage';
import { RetconSheet } from '@/ui/components/Retcon';
import { Block, ConnectionsView, EditActions, EditingBar, Lede, SectionsEditor, SectionsView, TiesEditor, useEditable, useLeaveGuard, useStartEditing, workshopRoute } from '@/ui/components/Entry';
import { withDescendants } from '@/ui/worldRefs';
import { useWorld } from '@/ui/useWorld';
import { PlaceMapBlock } from '@/ui/map/PlaceMap';

interface Editable { id: string; row: WorldEntity; links: StoredLink[] }

const WORKSHOP: Record<WorldEntity['kind'], { label: string; intent: string }[]> = {
  location: [{ label: 'Places inside', intent: 'places inside it' }, { label: 'People here', intent: 'people who live or work here' }, { label: 'Who holds it', intent: 'factions based here or fighting over it' }, { label: 'Things here', intent: 'things to be found here' }, { label: 'Its history', intent: 'lore: its history, customs, rumours' }],
  organization: [{ label: 'Members', intent: 'members, with distinct roles' }, { label: 'Branches', intent: 'branches, cells or chapters' }, { label: 'Places it holds', intent: 'places it holds or uses' }, { label: 'Rivals', intent: 'rivals and enemies, and allies' }, { label: 'Its history', intent: 'lore: its founding, its secrets' }],
  item: [{ label: 'Who wants it', intent: 'people who made it, hold it, want it or lost it' }, { label: 'Where it has been', intent: 'places tied to it' }, { label: 'Its story', intent: 'lore: its history and legend' }],
};

/** One place, faction or thing: read as a page, edited with save and discard. */
export default function EntityPage() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const db = useSQLiteContext();
  const ed = useEditable<Editable>(
    async () => { const row = await getEntity(db, id!); return row ? { id: row.id, row, links: await linksOf(db, row.id) } : null; },
    async (v) => { await saveEntity(db, v.row); await syncLinks(db, v.id, v.links); },
    [id],
  );
  const e = ed.value?.row ?? null;
  const w = useWorld(e?.universeId);
  const [retconOpen, setRetconOpen] = useState(false);
  const rowOf = useCallback(() => (ed.value ? { kind: ed.value.row.kind, row: ed.value.row } : null), [ed.value]);
  const takeSelf = useCallback((row: unknown) => ed.setBuffer((b) => (b ? { ...b, row: row as WorldEntity } : b)), [ed]);
  const rf = useEntryReforge({ db, universeId: e?.universeId, row: rowOf, onSelf: takeSelf });
  useLeaveGuard(ed.dirty, ed.commit);
  useStartEditing(edit, !!ed.saved, ed.begin);
  if (!e || !ed.value) return null;

  const set = (p: Partial<WorldEntity>) => ed.change({ row: { ...e, ...p } });
  const all = w.lib?.entities ?? [];
  const parentOptions = e.kind === 'item' ? [] : (w.refs[e.kind] ?? []).filter((o) => !withDescendants(e.id, all).includes(o.id));
  const chain = e.kind === 'location' ? locationChain(e.parentId, all) : [];
  const kids = childrenOf(e.id, all).filter((x) => x.kind === e.kind);
  const lib = w.lib ?? { universe: null, entities: all, characters: [], species: [], lore: [] };
  const kicker = [KIND_LABEL[e.kind], typeof e.data.type === 'string' ? e.data.type : ''].filter(Boolean).join(' · ');
  const within = chain.length ? `In ${chain.map((c) => c.name).join(' › ')}` : e.parentId && e.kind === 'organization' ? `Part of ${all.find((x) => x.id === e.parentId)?.name ?? ''}` : '';

  async function addChild() {
    const child = newEntity(e!.universeId, e!.kind, undefined, e!.id);
    await saveEntity(db, child);
    router.push(`/library/entity/${child.id}`);
  }

  const picture = <EntryImage kind={e.kind} name={e.name} data={e.data} world={w.lib?.universe} draft={() => entityDraft(e, lib)} onChange={(image) => void ed.persist({ row: { ...e, data: { ...e.data, image } } })} quiet={!ed.editing} />;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: KIND_LABEL[e.kind], headerTitle: () => <Row gap={8}><Avatar data={e.data} name={e.name} size={26} /><T v="h" numberOfLines={1} style={{ maxWidth: ed.editing ? 140 : 230 }}>{e.name}</T></Row>, headerRight: () => <EditActions editing={ed.editing} dirty={ed.dirty} saving={ed.saving} onEdit={ed.begin} onSave={() => void ed.commit()} onDiscard={ed.discard} /> }} />
      {ed.editing ? (
        <>
          <EditingBar dirty={ed.dirty} />
          {picture}
          <View style={{ gap: 14 }}>
            <Field label="Name" value={e.name} onChangeText={(v) => set({ name: v })} onForge={() => void rf.open('name')} />
            <Field label="In a line" hint="Always sent to the writer when this comes up." value={e.summary} onChangeText={(v) => set({ summary: v })} multiline style={{ minHeight: 60 }} onForge={() => void rf.open('summary')} />
            <KeysField label="Also called" hint="Comma separated. Any of these in the story brings this into the scene, like its name does." value={e.keys} onChange={(keys) => set({ keys })} onForge={() => void rf.open('keys')} />
            {e.kind !== 'item' ? (
              <View style={{ gap: 6 }}>
                <FieldLabel label={e.kind === 'location' ? 'Inside' : 'Part of'} onForge={() => void rf.open('within')} />
                <RefChips value={e.parentId} options={parentOptions} onChange={(pid) => set({ parentId: pid })} none={e.kind === 'location' ? 'Top level' : 'Independent'} />
              </View>
            ) : null}
          </View>
          <View style={{ height: 18 }} />
          <SectionsEditor defs={[...FIELDS_BY_KIND[e.kind]]} data={e.data} refs={w.refs} onChange={(p) => set({ data: { ...e.data, ...p } })} onForge={(d) => void rf.open(d.key)} />
          {e.universeId ? (
            <Block title="Ties">
              <TiesEditor id={e.id} kind={e.kind} universeId={e.universeId} links={ed.value.links} onChange={(links) => ed.change({ links })} index={w.index} graph={w.graph} />
            </Block>
          ) : null}
          <Block title="Danger zone">
            <Button kind="danger" title={`Delete ${KIND_LABEL[e.kind].toLowerCase()}`} onPress={() => Alert.alert(`Delete ${e.name}?`, kids.length ? 'What was inside moves up a level. Its ties go with it.' : 'Its ties go with it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEntity(db, e.id); ed.discard(); setTimeout(() => router.back(), 0); } }])} />
          </Block>
        </>
      ) : (
        <>
          <Lede kicker={kicker} title={e.name} lede={e.summary} picture={picture} badges={[within ? <T key="w" v="dim">{within}</T> : null, e.keys.length ? <T key="k" v="faint">Also called {e.keys.join(', ')}</T> : null]} />
          <SectionsView defs={[...FIELDS_BY_KIND[e.kind]]} data={e.data} />
          {e.kind === 'location' ? <Block title="Map"><PlaceMapBlock place={e} parent={e.parentId ? all.find((x) => x.id === e.parentId) : null} /></Block> : null}
          <Block title="Connections" right={e.kind !== 'item' ? <Button small kind="ghost" icon="add" title={e.kind === 'location' ? 'Place inside' : 'Branch'} onPress={() => void addChild()} /> : undefined}>
            <ConnectionsView id={e.id} graph={w.graph} byId={w.byId} empty={e.kind === 'location' ? 'Nothing is tied here yet: no one lives here, nothing sits inside it.' : e.kind === 'organization' ? 'No members, seat or ties yet.' : 'Nobody holds it and it is kept nowhere.'} />
          </Block>
          <Block title="Grow it">
            <T v="faint">The world’s agent picks up from here, with this {KIND_LABEL[e.kind].toLowerCase()} and everything tied to it in mind.</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {WORKSHOP[e.kind].map((x) => <Button key={x.label} small kind="outline" title={x.label} onPress={() => router.push(workshopRoute(e.universeId, { kind: e.kind, id: e.id }, x.intent) as never)} />)}
              <Button small kind="outline" icon="chatbubbles-outline" title="Talk it through" onPress={() => router.push(workshopRoute(e.universeId, { kind: e.kind, id: e.id }) as never)} />
            </Row>
          </Block>
          <Block title="Change what is true">
            <T v="faint">Retcon changes what is true about it and carries the change, or a new name, through every entry that mentions it.</T>
            <Button small kind="outline" icon="git-compare-outline" title="Retcon" onPress={() => setRetconOpen(true)} />
          </Block>
        </>
      )}
      {rf.sheet}
      <RetconSheet open={retconOpen} onClose={() => { setRetconOpen(false); void ed.reload(); void w.reload(); }} universeId={e.universeId} row={rowOf} onSelf={(row) => void ed.persist({ row: row as WorldEntity })} />
      <View style={{ height: 40 }} />
    </Screen>
  );
}
