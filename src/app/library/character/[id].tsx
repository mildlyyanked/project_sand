import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Species, Universe } from '@/core/types';
import type { Attribute, WorldEntity } from '@/core/world/types';
import { CHARACTER_FIELDS } from '@/core/world/schema';
import { ATTRIBUTES, ATTRIBUTE_INFO } from '@/core/world/dice';
import { deleteCharacter, getCharacters, listCharacters, listSpecies, listUniverses, saveCharacter } from '@/db/repo/library';
import { listEntities } from '@/db/repo/world';
import { useEntity } from '@/ui/useEntity';
import { Button, Chip, Field, IconButton, Row, Screen, Section, Stepper, SwitchRow, T } from '@/ui/components';
import { FieldEditor, RefChips } from '@/ui/components/World';
import { useEntryReforge } from '@/ui/components/Reforge';
import { EntryImage } from '@/ui/components/EntryImage';
import { ForgeSheet } from '@/ui/components/Forge';
import { characterDraft } from '@/core/world/drafts';
import { refOptions } from '@/ui/worldRefs';

export default function CharacterEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [c, update] = useEntity<Character>(() => getCharacters(db, [id!]).then((r) => r[0] ?? null), (v) => saveCharacter(db, v), [id]);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [people, setPeople] = useState<Character[]>([]);
  const [forgeOpen, setForgeOpen] = useState(false);
  const rf = useEntryReforge({ db, universeId: c?.universeId, row: useCallback(() => (c ? { kind: 'character' as const, row: c } : null), [c]), onSelf: useCallback((row: unknown) => update(row as Character), [update]) });
  useEffect(() => { void listUniverses(db).then(setUniverses); void listSpecies(db).then(setSpecies); }, [db]);
  const universeId = c?.universeId;
  useFocusEffect(useCallback(() => {
    if (!universeId) return;
    void listEntities(db, universeId).then(setEntities);
    void listCharacters(db).then((cs) => setPeople(cs.filter((x) => x.universeId === universeId)));
  }, [db, universeId]));
  if (!c) return null;
  const sp = species.filter((s) => s.universeId === c.universeId);
  const mySpecies = species.find((s) => s.id === c.speciesId);
  const refs = refOptions(c.universeId ? entities : [], people);
  const setData = (p: Record<string, unknown>) => update({ data: { ...c.data, ...p } });
  const memberships = c.data.memberships ?? [];
  const attrs = c.data.attributes ?? {};
  const spent = ATTRIBUTES.reduce((n, a) => n + (attrs[a] ?? 2), 0);

  return (
    <Screen scroll>
      <Section title="Identity">
        <Field label="Name" value={c.name} onChangeText={(v) => update({ name: v })} onForge={() => rf.open('name')} />
        <Field label="Summary" hint="One or two lines the writer always sees." value={c.summary} onChangeText={(v) => update({ summary: v })} multiline onForge={() => rf.open('summary')} />
      </Section>
      <Section title="Portrait">
        <EntryImage kind="character" name={c.name} data={c.data as Record<string, unknown>} world={universes.find((u) => u.id === c.universeId)} draft={() => characterDraft(c, { universe: null, entities, characters: people, species, lore: [] })} onChange={(image) => setData({ image })} />
      </Section>
      <Section title="World">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="Any world" selected={!c.universeId} onPress={() => update({ universeId: null, speciesId: null, data: { ...c.data, homeLocationId: null, memberships: [] } })} />
          {universes.map((u) => <Chip key={u.id} label={u.name} selected={c.universeId === u.id} onPress={() => update({ universeId: u.id, speciesId: null, data: { ...c.data, homeLocationId: null, memberships: [] } })} />)}
        </Row>
        {c.universeId ? (
          sp.length ? (
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="No people" selected={!c.speciesId} onPress={() => update({ speciesId: null })} />
              {sp.map((s) => <Chip key={s.id} label={s.name} selected={c.speciesId === s.id} onPress={() => update({ speciesId: s.id })} />)}
            </Row>
          ) : <T v="faint">This world has no peoples yet. Add them on the world page.</T>
        ) : <T v="faint">A character in no world can be cast in any story. One in a world stays consistent across every story set there.</T>}
        <Field label="Life stage" hint={mySpecies?.adulthood ? `${mySpecies.name}: ${mySpecies.adulthood}` : 'Free text, in the world\'s own terms.'} value={c.lifeStage} onChangeText={(v) => update({ lifeStage: v })} onForge={() => rf.open('lifeStage')} />
        <SwitchRow label="Adult" hint="By this species' definition. Explicit sessions only take characters with this on." value={c.adult} onChange={(v) => update({ adult: v })} />
      </Section>
      <Section title="Who they are">
        <FieldEditor defs={CHARACTER_FIELDS.filter((d) => !d.play)} data={c.data as Record<string, unknown>} refs={refs} onChange={setData} onForge={(d) => rf.open(d.key === 'homeLocationId' ? 'home' : d.key)} />
      </Section>
      {c.universeId ? (
        <Section title="Belongs to" right={<Button small kind="outline" icon="add" title="Faction" onPress={() => setData({ memberships: [...memberships, { orgId: '', role: '' }] })} />}>
          {memberships.length ? memberships.map((m, i) => (
            <View key={i} style={{ gap: 6 }}>
              <Row between><T v="label">Membership {i + 1}</T><IconButton name="trash-outline" size={18} onPress={() => setData({ memberships: memberships.filter((_, j) => j !== i) })} /></Row>
              <RefChips value={m.orgId || null} options={refs.organization ?? []} onChange={(orgId) => setData({ memberships: memberships.map((x, j) => (j === i ? { ...x, orgId: orgId ?? '' } : x)) })} none="Pick a faction" />
              <Field value={m.role} onChangeText={(role) => setData({ memberships: memberships.map((x, j) => (j === i ? { ...x, role } : x)) })} placeholder="Role or rank" />
            </View>
          )) : <T v="faint">Factions they serve, lead or have fled.</T>}
        </Section>
      ) : null}
      <Section title="Voice">
        <Field label="Voice" hint="How they talk and think." value={c.voice} onChangeText={(v) => update({ voice: v })} multiline onForge={() => rf.open('voice')} />
        <Field label="Tells" hint="Habits, gestures, verbal tics." value={c.tells} onChangeText={(v) => update({ tells: v })} multiline onForge={() => rf.open('tells')} />
        <Field label="Relationships" value={c.relationships} onChangeText={(v) => update({ relationships: v })} multiline onForge={() => rf.open('relationships')} />
      </Section>
      <Section title="Boundaries">
        <Field label="Limits" hint="What this character will not do or have done to them." value={c.limits} onChangeText={(v) => update({ limits: v })} multiline onForge={() => rf.open('limits')} />
        <Field label="Preferences" hint="What they lean into." value={c.preferences} onChangeText={(v) => update({ preferences: v })} multiline onForge={() => rf.open('preferences')} />
      </Section>
      <Section title="In play">
        <T v="faint">Used when someone plays this character in POV mode. 2 is ordinary, 5 exceptional; each point above 2 adds +2 to tests. Total now {spent}.</T>
        {ATTRIBUTES.map((a: Attribute) => (
          <Row key={a} between>
            <View style={{ flex: 1 }}><T>{ATTRIBUTE_INFO[a].label}</T><T v="faint">{ATTRIBUTE_INFO[a].hint}</T></View>
            <Stepper value={attrs[a] ?? 2} min={1} max={5} onChange={(v) => setData({ attributes: { ...attrs, [a]: v } })} />
          </Row>
        ))}
        <FieldEditor defs={CHARACTER_FIELDS.filter((d) => d.play)} data={c.data as Record<string, unknown>} onChange={setData} onForge={(d) => rf.open(d.key)} />
      </Section>
      <Button kind="outline" icon="git-branch-outline" title="Forge under this" onPress={() => setForgeOpen(true)} />
      <T v="faint" style={{ marginBottom: 16 }}>People in their life, belongings, places, groups tied to them, their lore. Each new entry is linked to {c.name}.</T>
      <ForgeSheet open={forgeOpen} onClose={() => setForgeOpen(false)} kind="character" universeId={c.universeId} anchor={{ kind: 'character', id: c.id }} onSaved={() => { void listCharacters(db).then((cs) => setPeople(cs.filter((x) => x.universeId === c.universeId))); }} />
      {rf.sheet}
      <Button kind="danger" title="Delete character" onPress={() => Alert.alert('Delete character?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCharacter(db, c.id); router.back(); } }])} />
    </Screen>
  );
}
