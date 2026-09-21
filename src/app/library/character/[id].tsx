import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Species, Universe } from '@/core/types';
import { deleteCharacter, getCharacters, listSpecies, listUniverses, saveCharacter } from '@/db/repo/library';
import { useEntity } from '@/ui/useEntity';
import { Button, Chip, Field, Row, Screen, Section, SwitchRow, T } from '@/ui/components';

export default function CharacterEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [c, update] = useEntity<Character>(() => getCharacters(db, [id!]).then((r) => r[0] ?? null), (v) => saveCharacter(db, v), [id]);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  useEffect(() => { void listUniverses(db).then(setUniverses); void listSpecies(db).then(setSpecies); }, [db]);
  if (!c) return null;
  const sp = species.filter((s) => s.universeId === c.universeId);
  const mySpecies = species.find((s) => s.id === c.speciesId);

  return (
    <Screen scroll>
      <Section title="Identity">
        <Field label="Name" value={c.name} onChangeText={(v) => update({ name: v })} />
        <Field label="Summary" hint="One or two lines the writer always sees." value={c.summary} onChangeText={(v) => update({ summary: v })} multiline />
      </Section>
      <Section title="World">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="None" selected={!c.universeId} onPress={() => update({ universeId: null, speciesId: null })} />
          {universes.map((u) => <Chip key={u.id} label={u.name} selected={c.universeId === u.id} onPress={() => update({ universeId: u.id, speciesId: null })} />)}
        </Row>
        {c.universeId ? (
          sp.length ? (
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="No species" selected={!c.speciesId} onPress={() => update({ speciesId: null })} />
              {sp.map((s) => <Chip key={s.id} label={s.name} selected={c.speciesId === s.id} onPress={() => update({ speciesId: s.id })} />)}
            </Row>
          ) : <T v="faint">This world has no species yet. Add them on the world page.</T>
        ) : null}
        <Field label="Life stage" hint={mySpecies?.adulthood ? `${mySpecies.name}: ${mySpecies.adulthood}` : 'Free text, in the world\'s own terms.'} value={c.lifeStage} onChangeText={(v) => update({ lifeStage: v })} />
        <SwitchRow label="Adult" hint="By this species' definition. Explicit sessions only take characters with this on." value={c.adult} onChange={(v) => update({ adult: v })} />
      </Section>
      <Section title="Voice">
        <Field label="Voice" hint="How they talk and think." value={c.voice} onChangeText={(v) => update({ voice: v })} multiline />
        <Field label="Tells" hint="Habits, gestures, verbal tics." value={c.tells} onChangeText={(v) => update({ tells: v })} multiline />
        <Field label="Relationships" value={c.relationships} onChangeText={(v) => update({ relationships: v })} multiline />
      </Section>
      <Section title="Boundaries">
        <Field label="Limits" hint="What this character will not do or have done to them." value={c.limits} onChangeText={(v) => update({ limits: v })} multiline />
        <Field label="Preferences" hint="What they lean into." value={c.preferences} onChangeText={(v) => update({ preferences: v })} multiline />
      </Section>
      <Button kind="danger" title="Delete character" onPress={() => Alert.alert('Delete character?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCharacter(db, c.id); router.back(); } }])} />
    </Screen>
  );
}
