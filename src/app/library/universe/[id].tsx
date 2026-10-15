import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, LoreEntry, Species, Universe } from '@/core/types';
import type { EntityKind, WorldCalendar, WorldEntity, WorldInstance } from '@/core/world/types';
import { LORE_CATEGORIES, SPECIES_FIELDS, WORLD_FIELDS } from '@/core/world/schema';
import { formatShort, formatTime } from '@/core/world/calendar';
import { deleteLore, deleteSpecies, deleteUniverse, getUniverse, listCharacters, listLore, listSpecies, newCharacter, newLore, newSpecies, saveCharacter, saveLore, saveSpecies, saveUniverse } from '@/db/repo/library';
import { instanceClock, listEntities, listInstances, newEntity, newInstance, saveEntity, saveInstance, sessionsInInstance } from '@/db/repo/world';
import { useEntity } from '@/ui/useEntity';
import { Badge, Button, Card, Chip, Field, ListItem, Row, Screen, SearchBox, Section, Sheet, Stepper, SwitchRow, T, matches } from '@/ui/components';
import { FieldEditor, KeysField } from '@/ui/components/World';
import { useEntryReforge } from '@/ui/components/Reforge';
import type { LibKind, Library } from '@/core/world/drafts';
import { rowDraft, type LibraryRow } from '@/state/library';
import { RetconSheet } from '@/ui/components/Retcon';
import { Avatar, EntryImage } from '@/ui/components/EntryImage';
import { ForgeSheet } from '@/ui/components/Forge';
import type { ForgeKind } from '@/core/world/forge';
import { refOptions } from '@/ui/worldRefs';
import { EntityTree } from '@/ui/components/Tree';
import { space } from '@/ui/theme';

type Tab = 'overview' | 'places' | 'factions' | 'things' | 'people' | 'peoples' | 'lore' | 'instances';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'World' }, { key: 'places', label: 'Places' }, { key: 'people', label: 'Characters' }, { key: 'factions', label: 'Factions' },
  { key: 'things', label: 'Things' }, { key: 'peoples', label: 'Peoples' }, { key: 'lore', label: 'Lore' }, { key: 'instances', label: 'Instances' },
];

/** A world template: what it is, everything in it, and the versions of it stories happen in. */
export default function WorldHub() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const db = useSQLiteContext();
  const [u, update] = useEntity<Universe>(() => getUniverse(db, id!), (v) => saveUniverse(db, v), [id]);
  const [tab, setTabRaw] = useState<Tab>(initialTab ?? 'overview');
  const [q, setQ] = useState('');
  const setTab = (t: Tab) => { setTabRaw(t); setQ(''); };
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [people, setPeople] = useState<Character[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [lore, setLore] = useState<LoreEntry[]>([]);
  const [instances, setInstances] = useState<(WorldInstance & { clock: number; stories: number })[]>([]);
  const [edit, setEdit] = useState<{ kind: 'species'; v: Species } | { kind: 'lore'; v: LoreEntry } | null>(null);
  const [forge, setForge] = useState<{ kind: ForgeKind; anchor?: { kind: LibKind; id: string } } | null>(null);
  const [retcon, setRetcon] = useState<LibraryRow | null>(null);
  const [newInst, setNewInst] = useState<{ name: string; description: string } | null>(null);

  const worldRf = useEntryReforge({ db, universeId: id, row: useCallback(() => (u ? { kind: 'world' as const, row: u } : null), [u]), onSelf: useCallback((row: unknown) => update(row as Universe), [update]) });
  const editRf = useEntryReforge({ db, universeId: id, row: useCallback(() => (edit ? (edit.kind === 'species' ? { kind: 'species' as const, row: edit.v } : { kind: 'lore' as const, row: edit.v }) : null), [edit]), onSelf: useCallback((row: unknown) => setEdit((e) => (e ? ({ kind: e.kind, v: row } as typeof e) : e)), []) });

  const retconRow = useCallback(() => retcon, [retcon]);
  const retconSelf = useCallback(async (row: unknown) => {
    if (retcon?.kind === 'species') await saveSpecies(db, row as Species);
    else if (retcon?.kind === 'lore') await saveLore(db, row as LoreEntry);
  }, [db, retcon]);

  const reload = useCallback(() => {
    if (!id) return;
    void Promise.all([listEntities(db, id), listCharacters(db), listSpecies(db, id), listLore(db, id), listInstances(db, id)]).then(async ([e, c, s, l, inst]) => {
      setEntities(e); setPeople(c.filter((x) => x.universeId === id)); setSpecies(s); setLore(l);
      setInstances(await Promise.all(inst.map(async (i) => ({ ...i, clock: await instanceClock(db, i.id), stories: (await sessionsInInstance(db, i.id)).length }))));
    });
  }, [db, id]);
  useFocusEffect(reload);
  if (!u) return null;

  const refs = refOptions(entities, people);
  const libNow = (): Library => ({ universe: u, entities, characters: people, species, lore });
  const speciesDraftOf = (v: Species) => rowDraft({ kind: 'species', row: v }, libNow());
  const cal = u.data.calendar;
  const setCal = (p: Partial<WorldCalendar>) => update({ data: { ...u.data, calendar: { ...cal, ...p } } });

  async function addEntity(kind: EntityKind) {
    const e = newEntity(u!.id, kind);
    await saveEntity(db, e);
    router.push(`/library/entity/${e.id}`);
  }
  async function addPerson() {
    const c = { ...newCharacter(), universeId: u!.id };
    await saveCharacter(db, c);
    router.push(`/library/character/${c.id}`);
  }
  async function saveEdit() {
    if (!edit) return;
    if (edit.kind === 'species') await saveSpecies(db, edit.v);
    else await saveLore(db, edit.v);
    setEdit(null);
    reload();
  }
  async function removeEdit() {
    if (!edit) return;
    if (edit.kind === 'species') await deleteSpecies(db, edit.v.id);
    else await deleteLore(db, edit.v.id);
    setEdit(null);
    reload();
  }
  async function createInstance() {
    if (!newInst?.name.trim()) return;
    const i = { ...newInstance(u!.id, newInst.name.trim()), description: newInst.description };
    await saveInstance(db, i);
    setNewInst(null);
    router.push(`/world/instance/${i.id}`);
  }

  const forgeButton = (k: ForgeKind) => <Button small kind="ghost" icon="sparkles-outline" title="Forge" onPress={() => setForge({ kind: k })} />;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: u.name }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: space.md }}>
        {TABS.map((x) => <Chip key={x.key} label={x.label} selected={tab === x.key} onPress={() => setTab(x.key)} />)}
      </ScrollView>

      {tab === 'overview' ? (
        <>
          <Section title="The world">
            {u.isDefault ? <T v="faint">The real world sends nothing to the writer unless you write something here. Stories set in it stay exactly as plain as before.</T> : null}
            <Field label="Name" value={u.name} onChangeText={(v) => update({ name: v })} onForge={() => worldRf.open('name')} />
            <Field label="Description" hint="Always sent to the writer when a story is set here." value={u.description} onChangeText={(v) => update({ description: v })} multiline style={{ minHeight: 120 }} onForge={() => worldRf.open('description')} />
            <FieldEditor defs={WORLD_FIELDS} data={u.data as unknown as Record<string, unknown>} onChange={(p) => update({ data: { ...u.data, ...p } })} onForge={(d) => worldRf.open(d.key)} />
          </Section>
          <Section title="Grow the world">
            <T v="faint">Forge any mix of places, factions, characters, things, peoples and lore that the world most needs, read against everything already in it. Surprise me pulls on its loose threads: factions without leaders, cities nobody lives in, names mentioned but never written.</T>
            <Button kind="outline" icon="leaf-outline" title="Grow the world" onPress={() => setForge({ kind: 'mixed' })} />
          </Section>
          <Section title="Calendar">
            <Row>
              <Chip label="Real dates" selected={cal.kind === 'gregorian'} onPress={() => setCal({ kind: 'gregorian' })} />
              <Chip label="Its own reckoning" selected={cal.kind === 'custom'} onPress={() => setCal({ kind: 'custom' })} />
            </Row>
            {cal.kind === 'gregorian' ? (
              <Field label="Minute zero" hint="The date and time the world's clock starts from, YYYY-MM-DDTHH:MM." value={cal.start} onChangeText={(v) => setCal({ start: v })} autoCapitalize="none" />
            ) : (
              <>
                <Row between><T>Hours in a day</T><Stepper value={cal.hoursPerDay || 24} min={6} max={60} onChange={(v) => setCal({ hoursPerDay: v })} /></Row>
                <Row between><T>Days in a year</T><Stepper value={cal.daysPerYear} min={0} max={2000} step={5} format={(v) => (v ? String(v) : 'no years')} onChange={(v) => setCal({ daysPerYear: v })} /></Row>
                {cal.daysPerYear ? (
                  <>
                    <Row between><T>Starting year</T><Stepper value={cal.startYear} min={-100000} max={100000} onChange={(v) => setCal({ startYear: v })} /></Row>
                    <Field label="Years are called" value={cal.yearLabel} onChangeText={(v) => setCal({ yearLabel: v })} placeholder="e.g. AF, of the Long Night" />
                    <Field label="Months" hint="Comma separated, optional. The year is split evenly." value={cal.monthNames.join(', ')} onChangeText={(v) => setCal({ monthNames: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
                  </>
                ) : null}
              </>
            )}
            <T v="faint">Minute zero reads as {formatTime(cal, 0)}. Stories keep their own clocks on this calendar; the writer always knows the time.</T>
          </Section>
          {!u.isDefault ? <Button kind="danger" title="Delete world" onPress={() => Alert.alert('Delete world?', 'Places, factions, things, peoples, lore, instances and their timelines go with it. Characters stay, detached. Stories move to the real world.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteUniverse(db, u.id); router.back(); } }])} /> : null}
        </>
      ) : null}

      {tab === 'places' || tab === 'factions' || tab === 'things' ? (() => {
        const kind: EntityKind = tab === 'places' ? 'location' : tab === 'factions' ? 'organization' : 'item';
        const empty = { location: 'Realms, cities, districts, rooms. Nest them: a market inside a quarter inside a city. The writer gets where the scene is and what is nearby.', organization: 'Governments, guilds, churches, gangs, families. Goals, methods, leaders, enemies.', item: 'Weapons, relics, documents, food. In play, things with effects can be used from the inventory.' }[kind];
        const items = entities.filter((e) => e.kind === kind);
        return (
          <Section title={`${tab === 'places' ? 'Places' : tab === 'factions' ? 'Factions' : 'Things'}${items.length ? ` · ${items.length}` : ''}`} right={<Row gap={4}>{forgeButton(kind)}<Button small kind="outline" icon="add" title="Add" onPress={() => addEntity(kind)} /></Row>}>
            {items.length > 5 ? <SearchBox value={q} onChange={setQ} placeholder={`Search ${tab}`} /> : null}
            {items.length ? <EntityTree items={items} query={q} onOpen={(e) => router.push(`/library/entity/${e.id}`)} /> : <T v="faint">{empty}</T>}
            {items.length && !q ? <T v="faint">{kind === 'item' ? '' : 'Tap the arrow to open what sits inside.'}</T> : null}
          </Section>
        );
      })() : null}

      {tab === 'people' ? (
        <Section title={`Characters${people.length ? ` · ${people.length}` : ''}`} right={<Row gap={4}>{forgeButton('character')}<Button small kind="outline" icon="add" title="Add" onPress={addPerson} /></Row>}>
          {people.length > 5 ? <SearchBox value={q} onChange={setQ} placeholder="Search characters" /> : null}
          {people.length ? people.filter((c) => matches(q, c.name, c.summary, c.data.occupation, c.lifeStage)).map((c) => <ListItem key={c.id} left={<Avatar data={c.data as Record<string, unknown>} name={c.name} />} title={c.name} subtitle={[c.data.occupation, c.summary].filter(Boolean).join(' · ')} right={!c.adult ? <Badge label="not adult" tone="warn" /> : undefined} onPress={() => router.push(`/library/character/${c.id}`)} />) : <T v="faint">Characters who belong to this world. The same people appear in every story set here, kept consistent by each instance’s timeline.</T>}
        </Section>
      ) : null}

      {tab === 'peoples' ? (
        <Section title="Peoples" right={<Row gap={4}>{forgeButton('species')}<Button small kind="outline" icon="add" title="Add" onPress={() => setEdit({ kind: 'species', v: newSpecies(u.id) })} /></Row>}>
          <T v="faint">Races and species. Each defines adulthood in its own terms; character cards show it next to their adult flag.</T>
          {species.length > 5 ? <SearchBox value={q} onChange={setQ} placeholder="Search peoples" /> : null}
          {species.filter((x) => matches(q, x.name, x.notes, String(x.data.traits ?? ''))).map((x) => <ListItem key={x.id} left={<Avatar data={x.data} name={x.name} />} title={x.name} subtitle={x.adulthood} onPress={() => setEdit({ kind: 'species', v: x })} />)}
        </Section>
      ) : null}

      {tab === 'lore' ? (
        <Section title="Lore" right={<Row gap={4}>{forgeButton('lore')}<Button small kind="outline" icon="add" title="Add" onPress={() => setEdit({ kind: 'lore', v: newLore(u.id) })} /></Row>}>
          <T v="faint">Sent when one of its keywords appears in the recent passages. Always-on entries ride with the world description.</T>
          {lore.length > 5 ? <SearchBox value={q} onChange={setQ} placeholder="Search lore" /> : null}
          {lore.filter((l) => matches(q, l.title, l.text, l.keys.join(' '), l.category)).map((l) => <ListItem key={l.id} title={l.title} subtitle={[l.category !== 'other' ? l.category : '', l.alwaysOn ? 'always on' : l.keys.join(', ') || 'no keywords'].filter(Boolean).join(' · ')} right={l.priority ? <Badge label={`p${l.priority}`} /> : undefined} onPress={() => setEdit({ kind: 'lore', v: l })} />)}
        </Section>
      ) : null}

      {tab === 'instances' ? (
        <Section title="Instances" right={<Button small kind="outline" icon="add" title="New" onPress={() => setNewInst({ name: '', description: '' })} />}>
          <T v="faint">An instance is one version of this world: the same people and places, its own timeline. Stories in the same instance share what happened; another instance can let it all go differently.</T>
          {instances.map((i) => (
            <Card key={i.id} onPress={() => router.push(`/world/instance/${i.id}`)} style={{ gap: 4 }}>
              <Row between><T v="h">{i.name}</T>{i.isPrime ? <Badge label="prime" tone="accent" /> : i.forkedFrom ? <Badge label="fork" tone="info" /> : null}</Row>
              {i.description ? <T v="dim" numberOfLines={2}>{i.description}</T> : null}
              <T v="faint">{i.stories} stor{i.stories === 1 ? 'y' : 'ies'} · up to {formatShort(cal, i.clock)}</T>
            </Card>
          ))}
        </Section>
      ) : null}

      <ForgeSheet open={!!forge} onClose={() => setForge(null)} kind={forge?.kind ?? 'species'} anchor={forge?.anchor} universeId={u.id} onSaved={reload} />
      {worldRf.sheet}
      <RetconSheet open={!!retcon} onClose={() => { setRetcon(null); reload(); }} universeId={u.id} row={retconRow} onSelf={retconSelf} />
      {editRf.sheet}
      <Sheet open={!!newInst} onClose={() => setNewInst(null)} title="New instance">
        <Field label="Name" value={newInst?.name ?? ''} onChangeText={(v) => setNewInst((x) => (x ? { ...x, name: v } : x))} placeholder="e.g. The Long Winter, What if the duke lived" autoFocus />
        <Field label="How it differs" value={newInst?.description ?? ''} onChangeText={(v) => setNewInst((x) => (x ? { ...x, description: v } : x))} multiline placeholder="Optional. Sent with every story in it." />
        <T v="faint">Starts with an empty timeline. To branch from an existing instance at a moment, use Fork on that instance instead.</T>
        <Button title="Create" onPress={createInstance} disabled={!newInst?.name.trim()} />
      </Sheet>
      <Sheet open={!!edit} onClose={saveEdit} title={edit?.kind === 'species' ? 'People' : 'Lore entry'} full>
        {edit?.kind === 'species' ? (
          <>
            <Field label="Name" value={edit.v.name} onChangeText={(v) => setEdit({ kind: 'species', v: { ...edit.v, name: v } })} onForge={() => editRf.open('name')} />
            <Field label="Adulthood" hint="When a member counts as adult, in the world's terms." value={edit.v.adulthood} onChangeText={(v) => setEdit({ kind: 'species', v: { ...edit.v, adulthood: v } })} multiline onForge={() => editRf.open('adulthood')} />
            <EntryImage kind="species" name={edit.v.name} data={edit.v.data} draft={() => speciesDraftOf(edit.v)} world={u} onChange={(image) => setEdit({ kind: 'species', v: { ...edit.v, data: { ...edit.v.data, image } } })} />
            <FieldEditor defs={SPECIES_FIELDS} data={edit.v.data} refs={refs} onChange={(p) => setEdit({ kind: 'species', v: { ...edit.v, data: { ...edit.v.data, ...p } } })} onForge={(d) => editRf.open(d.key)} />
            <Field label="Notes" value={edit.v.notes} onChangeText={(v) => setEdit({ kind: 'species', v: { ...edit.v, notes: v } })} multiline onForge={() => editRf.open('notes')} />
          </>
        ) : edit?.kind === 'lore' ? (
          <>
            <Field label="Title" value={edit.v.title} onChangeText={(v) => setEdit({ kind: 'lore', v: { ...edit.v, title: v } })} onForge={() => editRf.open('name')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {LORE_CATEGORIES.map((c) => <Chip key={c} small label={c} selected={edit.v.category === c} onPress={() => setEdit({ kind: 'lore', v: { ...edit.v, category: c } })} />)}
            </ScrollView>
            <KeysField label="Keywords" hint="Comma separated" value={edit.v.keys} onChange={(keys) => setEdit({ kind: 'lore', v: { ...edit.v, keys } })} onForge={() => editRf.open('keys')} />
            <Field label="Text" value={edit.v.text} onChangeText={(v) => setEdit({ kind: 'lore', v: { ...edit.v, text: v } })} multiline style={{ minHeight: 120 }} onForge={() => editRf.open('text')} />
            <SwitchRow label="Always on" value={edit.v.alwaysOn} onChange={(v) => setEdit({ kind: 'lore', v: { ...edit.v, alwaysOn: v } })} />
            <Row between><T>Priority</T><Stepper value={edit.v.priority} min={0} max={10} onChange={(v) => setEdit({ kind: 'lore', v: { ...edit.v, priority: v } })} /></Row>
          </>
        ) : null}
        {edit ? (
          <Row>
            <Button kind="outline" icon="git-branch-outline" title="Forge under this" onPress={async () => { const e = edit; await saveEdit(); setForge({ kind: e.kind === 'species' ? 'character' : 'lore', anchor: { kind: e.kind, id: e.v.id } }); }} style={{ flex: 1 }} />
            <Button kind="outline" icon="git-compare-outline" title="Retcon" onPress={async () => { const e = edit; await saveEdit(); setRetcon(e.kind === 'species' ? { kind: 'species', row: e.v } : { kind: 'lore', row: e.v }); }} style={{ flex: 1 }} />
          </Row>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Done" onPress={saveEdit} style={{ flex: 1 }} />
          <Button kind="danger" title="Delete" onPress={removeEdit} />
        </View>
      </Sheet>
    </Screen>
  );
}
