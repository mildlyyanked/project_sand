import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { CanonEvent, LoreEntry, Species, Universe } from '@/core/types';
import { deleteCanon, deleteLore, deleteSpecies, deleteUniverse, getUniverse, listCanon, listLore, listSpecies, newLore, newSpecies, saveCanon, saveLore, saveSpecies, saveUniverse } from '@/db/repo/library';
import { newId, now } from '@/core/ids';
import { useEntity } from '@/ui/useEntity';
import { Badge, Button, Field, ListItem, Row, Screen, Section, Sheet, Stepper, SwitchRow, T } from '@/ui/components';

export default function UniverseEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [u, update] = useEntity<Universe>(() => getUniverse(db, id!), (v) => saveUniverse(db, v), [id]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [lore, setLore] = useState<LoreEntry[]>([]);
  const [canon, setCanon] = useState<CanonEvent[]>([]);
  const [edit, setEdit] = useState<{ kind: 'species'; v: Species } | { kind: 'lore'; v: LoreEntry } | { kind: 'canon'; v: CanonEvent } | null>(null);
  const reload = useCallback(() => {
    void Promise.all([listSpecies(db, id!), listLore(db, id!), listCanon(db, id!)]).then(([s, l, c]) => { setSpecies(s); setLore(l); setCanon(c); });
  }, [db, id]);
  useEffect(reload, [reload]);
  if (!u) return null;

  async function saveEdit() {
    if (!edit) return;
    if (edit.kind === 'species') await saveSpecies(db, edit.v);
    if (edit.kind === 'lore') await saveLore(db, edit.v);
    if (edit.kind === 'canon') await saveCanon(db, edit.v);
    setEdit(null);
    reload();
  }
  async function removeEdit() {
    if (!edit) return;
    if (edit.kind === 'species') await deleteSpecies(db, edit.v.id);
    if (edit.kind === 'lore') await deleteLore(db, edit.v.id);
    if (edit.kind === 'canon') await deleteCanon(db, edit.v.id);
    setEdit(null);
    reload();
  }

  return (
    <Screen scroll>
      <Section title="World">
        <Field label="Name" value={u.name} onChangeText={(v) => update({ name: v })} />
        <Field label="Description" hint="Always sent to the writer when a story is set here." value={u.description} onChangeText={(v) => update({ description: v })} multiline style={{ minHeight: 120 }} />
      </Section>
      <Section title="Species" right={<Button small kind="outline" icon="add" title="Add" onPress={() => setEdit({ kind: 'species', v: newSpecies(u.id) })} />}>
        <T v="faint">Each species defines adulthood in its own terms. Character cards show that definition next to their adult flag.</T>
        {species.map((s) => <ListItem key={s.id} title={s.name} subtitle={s.adulthood} onPress={() => setEdit({ kind: 'species', v: s })} />)}
      </Section>
      <Section title="Lore" right={<Button small kind="outline" icon="add" title="Add" onPress={() => setEdit({ kind: 'lore', v: newLore(u.id) })} />}>
        <T v="faint">Entries are sent when one of their keywords appears in the recent beats. Always-on entries ride with the description.</T>
        {lore.map((l) => <ListItem key={l.id} title={l.title} subtitle={l.alwaysOn ? 'always on' : l.keys.join(', ') || 'no keywords'} right={l.priority ? <Badge label={`p${l.priority}`} /> : undefined} onPress={() => setEdit({ kind: 'lore', v: l })} />)}
      </Section>
      <Section title="Canon" right={<Button small kind="outline" icon="add" title="Add" onPress={() => setEdit({ kind: 'canon', v: { id: newId(), universeId: u.id, sessionId: null, title: '', text: '', order: canon.length, createdAt: now() } })} />}>
        <T v="faint">Events that happened in this world, across stories. Canon is sent as always-on lore.</T>
        {canon.map((c) => <ListItem key={c.id} title={c.title || '(untitled)'} subtitle={c.text} onPress={() => setEdit({ kind: 'canon', v: c })} />)}
      </Section>
      <Button kind="danger" title="Delete world" onPress={() => Alert.alert('Delete world?', 'Species, lore and canon go with it. Characters and stories stay, detached.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteUniverse(db, u.id); router.back(); } }])} />

      <Sheet open={!!edit} onClose={saveEdit} title={edit?.kind === 'species' ? 'Species' : edit?.kind === 'lore' ? 'Lore entry' : 'Canon event'} full>
        {edit?.kind === 'species' ? (
          <>
            <Field label="Name" value={edit.v.name} onChangeText={(v) => setEdit({ kind: 'species', v: { ...edit.v, name: v } })} />
            <Field label="Adulthood" hint="When a member of this species counts as adult, in the world's terms." value={edit.v.adulthood} onChangeText={(v) => setEdit({ kind: 'species', v: { ...edit.v, adulthood: v } })} multiline />
            <Field label="Notes" value={edit.v.notes} onChangeText={(v) => setEdit({ kind: 'species', v: { ...edit.v, notes: v } })} multiline />
          </>
        ) : edit?.kind === 'lore' ? (
          <>
            <Field label="Title" value={edit.v.title} onChangeText={(v) => setEdit({ kind: 'lore', v: { ...edit.v, title: v } })} />
            <Field label="Keywords" hint="Comma separated" value={edit.v.keys.join(', ')} onChangeText={(v) => setEdit({ kind: 'lore', v: { ...edit.v, keys: v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) } })} autoCapitalize="none" />
            <Field label="Text" value={edit.v.text} onChangeText={(v) => setEdit({ kind: 'lore', v: { ...edit.v, text: v } })} multiline style={{ minHeight: 120 }} />
            <SwitchRow label="Always on" value={edit.v.alwaysOn} onChange={(v) => setEdit({ kind: 'lore', v: { ...edit.v, alwaysOn: v } })} />
            <Row between><T>Priority</T><Stepper value={edit.v.priority} min={0} max={10} onChange={(v) => setEdit({ kind: 'lore', v: { ...edit.v, priority: v } })} /></Row>
          </>
        ) : edit?.kind === 'canon' ? (
          <>
            <Field label="Title" value={edit.v.title} onChangeText={(v) => setEdit({ kind: 'canon', v: { ...edit.v, title: v } })} />
            <Field label="What happened" value={edit.v.text} onChangeText={(v) => setEdit({ kind: 'canon', v: { ...edit.v, text: v } })} multiline style={{ minHeight: 120 }} />
          </>
        ) : null}
        <Row>
          <Button title="Done" onPress={saveEdit} style={{ flex: 1 }} />
          <Button kind="danger" title="Delete" onPress={removeEdit} />
        </Row>
      </Sheet>
    </Screen>
  );
}
