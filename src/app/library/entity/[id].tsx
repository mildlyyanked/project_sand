import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character } from '@/core/types';
import type { WorldEntity } from '@/core/world/types';
import { FIELDS_BY_KIND, KIND_LABEL } from '@/core/world/schema';
import { childrenOf, locationChain } from '@/core/world/scan';
import { deleteEntity, getEntity, listEntities, newEntity, saveEntity } from '@/db/repo/world';
import { listCharacters } from '@/db/repo/library';
import { useEntity } from '@/ui/useEntity';
import { Button, Field, ListItem, Screen, Section, T } from '@/ui/components';
import { FieldEditor, RefChips } from '@/ui/components/World';
import { refOptions, withDescendants } from '@/ui/worldRefs';

/** One place, faction or thing: what it is, where it sits, and every property the writer may need. */
export default function EntityEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [e, update] = useEntity<WorldEntity>(() => getEntity(db, id!), (v) => saveEntity(db, v), [id]);
  const [all, setAll] = useState<WorldEntity[]>([]);
  const [people, setPeople] = useState<Character[]>([]);
  const universeId = e?.universeId;
  useFocusEffect(useCallback(() => {
    if (!universeId) return;
    void listEntities(db, universeId).then(setAll);
    void listCharacters(db).then((cs) => setPeople(cs.filter((c) => c.universeId === universeId)));
  }, [db, universeId]));
  if (!e) return null;

  const refs = refOptions(all, people);
  const parentOptions = e.kind === 'item' ? [] : (refs[e.kind] ?? []).filter((o) => !withDescendants(e.id, all).includes(o.id));
  const chain = e.kind === 'location' ? locationChain(e.parentId, all) : [];
  const kids = childrenOf(e.id, all).filter((x) => x.kind === e.kind);

  async function addChild() {
    const child = newEntity(e!.universeId, e!.kind, undefined, e!.id);
    await saveEntity(db, child);
    router.push(`/library/entity/${child.id}`);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: KIND_LABEL[e.kind] }} />
      <Section title={KIND_LABEL[e.kind]}>
        <Field label="Name" value={e.name} onChangeText={(v) => update({ name: v })} />
        {chain.length ? <T v="faint">Within {chain.map((c) => c.name).join(' › ')}</T> : null}
        <Field label="In a line" hint="Always sent to the writer when this comes up." value={e.summary} onChangeText={(v) => update({ summary: v })} multiline style={{ minHeight: 60 }} />
        <Field label="Also called" hint="Comma separated. Any of these in the story brings this element into the scene, like its name does." value={e.keys.join(', ')} onChangeText={(v) => update({ keys: v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} autoCapitalize="none" />
        {e.kind !== 'item' ? (
          <View style={{ gap: 6 }}>
            <T v="label">{e.kind === 'location' ? 'Inside' : 'Part of'}</T>
            <RefChips value={e.parentId} options={parentOptions} onChange={(pid) => update({ parentId: pid })} none={e.kind === 'location' ? 'Top level' : 'Independent'} />
          </View>
        ) : null}
      </Section>
      <Section title="Details">
        <FieldEditor defs={[...FIELDS_BY_KIND[e.kind]]} data={e.data} refs={refs} onChange={(p) => update({ data: { ...e.data, ...p } })} />
      </Section>
      {e.kind !== 'item' ? (
        <Section title={e.kind === 'location' ? 'Places inside' : 'Branches'} right={<Button small kind="outline" icon="add" title="Add" onPress={addChild} />}>
          {kids.length ? kids.map((k) => <ListItem key={k.id} title={k.name} subtitle={k.summary || (typeof k.data.type === 'string' ? k.data.type : '')} onPress={() => router.push(`/library/entity/${k.id}`)} />) : <T v="faint">{e.kind === 'location' ? 'Districts, buildings, rooms: anything nested here.' : 'Chapters, cells, departments of this faction.'}</T>}
        </Section>
      ) : null}
      <Button kind="danger" title={`Delete ${KIND_LABEL[e.kind].toLowerCase()}`} onPress={() => Alert.alert(`Delete ${e.name}?`, kids.length ? 'What was inside moves up a level.' : undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEntity(db, e.id); router.back(); } }])} />
    </Screen>
  );
}
