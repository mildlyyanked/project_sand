import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Species } from '@/core/types';
import type { StoredLink } from '@/core/world/links';
import { SPECIES_FIELDS } from '@/core/world/schema';
import { speciesDraft } from '@/core/world/drafts';
import { deleteSpecies, getSpecies, saveSpecies } from '@/db/repo/library';
import { linksOf, syncLinks } from '@/db/repo/links';
import { Button, Field, Row, Screen, T } from '@/ui/components';
import { useEntryReforge } from '@/ui/components/Reforge';
import { Avatar, EntryImage } from '@/ui/components/EntryImage';
import { RetconSheet } from '@/ui/components/Retcon';
import { Block, ConnectionsView, EditActions, EditingBar, Lede, SectionsEditor, SectionsView, TiesEditor, useEditable, useLeaveGuard, useStartEditing, workshopRoute } from '@/ui/components/Entry';
import { useWorld } from '@/ui/useWorld';

interface Editable { id: string; row: Species; links: StoredLink[] }

const WORKSHOP = [
  { label: 'Members', intent: 'members of this people' },
  { label: 'Their places', intent: 'their homeland, sacred sites, settlements' },
  { label: 'Their ways', intent: 'lore: customs, beliefs, history' },
];

/** A people of the world: read as a page, edited with save and discard. */
export default function SpeciesPage() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const db = useSQLiteContext();
  const ed = useEditable<Editable>(
    async () => { const row = await getSpecies(db, id!); return row ? { id: row.id, row, links: await linksOf(db, row.id) } : null; },
    async (v) => { await saveSpecies(db, v.row); await syncLinks(db, v.id, v.links); },
    [id],
  );
  const s = ed.value?.row ?? null;
  const w = useWorld(s?.universeId);
  const [retconOpen, setRetconOpen] = useState(false);
  const rowOf = useCallback(() => (ed.value ? { kind: 'species' as const, row: ed.value.row } : null), [ed.value]);
  const takeSelf = useCallback((row: unknown) => ed.setBuffer((b) => (b ? { ...b, row: row as Species } : b)), [ed]);
  const rf = useEntryReforge({ db, universeId: s?.universeId, row: rowOf, onSelf: takeSelf });
  useLeaveGuard(ed.dirty, ed.commit);
  useStartEditing(edit, !!ed.saved, ed.begin);
  if (!s || !ed.value) return null;
  const set = (p: Partial<Species>) => ed.change({ row: { ...s, ...p } });
  const lib = w.lib ?? { universe: null, entities: [], characters: [], species: [s], lore: [] };
  const members = (w.lib?.characters ?? []).filter((c) => c.speciesId === s.id).length;
  const picture = <EntryImage kind="species" name={s.name} data={s.data} world={w.lib?.universe} draft={() => speciesDraft(s, lib)} onChange={(image) => void ed.persist({ row: { ...s, data: { ...s.data, image } } })} quiet={!ed.editing} />;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'People', headerTitle: () => <Row gap={8}><Avatar data={s.data} name={s.name} size={26} /><T v="h" numberOfLines={1} style={{ maxWidth: ed.editing ? 140 : 230 }}>{s.name}</T></Row>, headerRight: () => <EditActions editing={ed.editing} dirty={ed.dirty} saving={ed.saving} onEdit={ed.begin} onSave={() => void ed.commit()} onDiscard={ed.discard} /> }} />
      {ed.editing ? (
        <>
          <EditingBar dirty={ed.dirty} />
          {picture}
          <View style={{ gap: 14 }}>
            <Field label="Name" value={s.name} onChangeText={(v) => set({ name: v })} onForge={() => void rf.open('name')} />
            <Field label="Adulthood" hint="When a member counts as adult, in the world's terms. Character cards show it next to their adult flag." value={s.adulthood} onChangeText={(v) => set({ adulthood: v })} multiline onForge={() => void rf.open('adulthood')} />
          </View>
          <View style={{ height: 18 }} />
          <SectionsEditor defs={SPECIES_FIELDS} data={s.data} refs={w.refs} onChange={(p) => set({ data: { ...s.data, ...p } })} onForge={(d) => void rf.open(d.key)} />
          <Block title="Ties">
            <TiesEditor id={s.id} kind="species" universeId={s.universeId} links={ed.value.links} onChange={(links) => ed.change({ links })} index={w.index} graph={w.graph} />
          </Block>
          <Block title="Danger zone">
            <Button kind="danger" title="Delete this people" onPress={() => Alert.alert(`Delete ${s.name}?`, members ? `${members} ${members === 1 ? 'character keeps' : 'characters keep'} their cards, with no people.` : undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSpecies(db, s.id); ed.discard(); setTimeout(() => router.back(), 0); } }])} />
          </Block>
        </>
      ) : (
        <>
          <Lede kicker={`People${members ? ` · ${members} ${members === 1 ? 'member' : 'members'} in the library` : ''}`} title={s.name} lede={s.adulthood ? `Adult: ${s.adulthood}` : undefined} picture={picture} />
          <SectionsView defs={SPECIES_FIELDS} data={s.data} />
          <Block title="Connections"><ConnectionsView id={s.id} graph={w.graph} byId={w.byId} empty="No members, homeland or ties yet." /></Block>
          <Block title="Grow them">
            <Row style={{ flexWrap: 'wrap' }}>
              {WORKSHOP.map((x) => <Button key={x.label} small kind="outline" title={x.label} onPress={() => router.push(workshopRoute(s.universeId, { kind: 'species', id: s.id }, x.intent) as never)} />)}
              <Button small kind="outline" icon="chatbubbles-outline" title="Talk it through" onPress={() => router.push(workshopRoute(s.universeId, { kind: 'species', id: s.id }) as never)} />
            </Row>
          </Block>
          <Block title="Change what is true">
            <Button small kind="outline" icon="git-compare-outline" title="Retcon" onPress={() => setRetconOpen(true)} />
          </Block>
        </>
      )}
      {rf.sheet}
      <RetconSheet open={retconOpen} onClose={() => { setRetconOpen(false); void ed.reload(); void w.reload(); }} universeId={s.universeId} row={rowOf} onSelf={(row) => void ed.persist({ row: row as Species })} />
      <View style={{ height: 40 }} />
    </Screen>
  );
}
