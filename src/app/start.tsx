import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Style, Universe } from '@/core/types';
import type { Difficulty, WorldEntity, WorldInstance } from '@/core/world/types';
import { listCharacters, listStyles, listUniverses } from '@/db/repo/library';
import { instanceClock, listEntities, listInstances, primeInstance } from '@/db/repo/world';
import { blankSession, upsertSession } from '@/db/repo/sessions';
import { useSettings } from '@/state/settings';
import { Badge, Banner, Button, Chip, Field, Row, Screen, Section, SwitchRow, T } from '@/ui/components';
import { RefChips, TimeEditor } from '@/ui/components/World';
import { refOptions } from '@/ui/worldRefs';
import { imageOf } from '@/core/world/portraits';
import { space } from '@/ui/theme';

const DIFFICULTY: { key: Difficulty; label: string; hint: string }[] = [
  { key: 'story', label: 'Story', hint: 'No hunger or thirst; health and money still count.' },
  { key: 'survival', label: 'Survival', hint: 'Food, water and rest run down with time. Running out hurts.' },
  { key: 'hardcore', label: 'Hardcore', hint: 'Faster needs, morale wears down, and falling can be the end.' },
];

/** A story in a world: which world, which version of it, when, and whether you write it or play it. */
export default function Start() {
  const params = useLocalSearchParams<{ world?: string; instance?: string; mode?: string }>();
  const db = useSQLiteContext();
  const { defaults } = useSettings();
  const [worlds, setWorlds] = useState<Universe[]>([]);
  const [worldId, setWorldId] = useState<string | null>(params.world ?? null);
  const [instances, setInstances] = useState<WorldInstance[]>([]);
  const [instanceId, setInstanceId] = useState<string | null>(params.instance ?? null);
  const [mode, setMode] = useState<'writer' | 'pov'>(params.mode === 'pov' ? 'pov' : 'writer');
  const [people, setPeople] = useState<Character[]>([]);
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [voices, setVoices] = useState<Style[]>([]);
  const [cast, setCast] = useState<string[]>([]);
  const [player, setPlayer] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('survival');
  const [checks, setChecks] = useState(true);
  const [startLoc, setStartLoc] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [continuity, setContinuity] = useState<boolean | null>(null);
  const [chronicle, setChronicle] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([listUniverses(db), listStyles(db)]).then(([w, v]) => {
      setWorlds(w);
      setVoices(v);
      setWorldId((cur) => cur ?? w.find((x) => !x.isDefault)?.id ?? w[0]?.id ?? null);
    });
  }, [db]);
  useEffect(() => {
    if (!worldId) return;
    void (async () => {
      const prime = await primeInstance(db, worldId);
      const [inst, chars, ents] = await Promise.all([listInstances(db, worldId), listCharacters(db), listEntities(db, worldId)]);
      setInstances(inst);
      setInstanceId((cur) => (cur && inst.some((i) => i.id === cur) ? cur : prime.id));
      setPeople(chars.filter((c) => c.universeId === worldId || c.universeId == null));
      setEntities(ents);
    })();
  }, [db, worldId]);
  useEffect(() => {
    if (instanceId) void instanceClock(db, instanceId).then(setClock);
  }, [db, instanceId]);

  const world = worlds.find((w) => w.id === worldId) ?? null;
  const cont = continuity ?? !world?.isDefault;
  const chron = mode === 'pov' ? true : chronicle ?? !world?.isDefault;
  const refs = useMemo(() => refOptions(entities, people), [entities, people]);
  const playerChar = people.find((c) => c.id === player);
  const interactive = voices.find((v) => /interactive/i.test(v.name));

  async function create() {
    if (!world || !instanceId) return;
    if (mode === 'pov' && !playerChar) return setErr('Pick the character you will play, or make one in the Library first.');
    setBusy(true);
    try {
      const chars = mode === 'pov' ? cast.filter((x) => x !== player) : cast;
      const everyone = [...chars, ...(mode === 'pov' && player ? [player] : [])].map((id) => people.find((p) => p.id === id)).filter((c): c is Character => !!c);
      const s = blankSession({
        title: title.trim() || (mode === 'pov' ? `${playerChar!.name} in ${world.name}` : world.isDefault ? 'Untitled' : `A story in ${world.name}`),
        models: defaults.models, zdr: defaults.zdr,
        styleId: mode === 'pov' ? interactive?.id ?? defaults.styleId : defaults.styleId,
        universeId: world.id, instanceId, mode,
        world: { continuity: cont, chronicle: chron },
        clockStart: clock,
        characterIds: chars,
        brief: brief.trim(),
        explicit: everyone.every((c) => c.adult),
        planFirst: mode !== 'pov',
        pov: mode === 'pov' ? { characterId: player, difficulty, checks, startLocationId: startLoc ?? playerChar?.data.homeLocationId ?? null } : null,
      });
      await upsertSession(db, s);
      router.replace(`/session/${s.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      {err ? <View style={{ marginBottom: space.md }}><Banner text={err} onClose={() => setErr(null)} /></View> : null}
      <Section title="World">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {worlds.map((w) => <Chip key={w.id} label={w.name} selected={worldId === w.id} onPress={() => { setWorldId(w.id); setInstanceId(null); setCast([]); setPlayer(null); setStartLoc(null); }} />)}
        </ScrollView>
        {instances.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {instances.map((i) => <Chip key={i.id} small label={i.name} selected={instanceId === i.id} onPress={() => setInstanceId(i.id)} />)}
          </ScrollView>
        ) : null}
        {world?.description ? <T v="faint" numberOfLines={3}>{world.description}</T> : null}
      </Section>

      <Section title="Mode">
        <Row>
          <Chip label="Write" selected={mode === 'writer'} onPress={() => setMode('writer')} />
          <Chip label="Play a character" selected={mode === 'pov'} onPress={() => setMode('pov')} />
        </Row>
        <T v="faint">{mode === 'writer' ? 'Free writing, as always: you direct, the writer writes.' : 'You are one character inside the world. You act; the world answers. Tests of skill, needs that run down with time, money, an inventory, aims and people who remember you.'}</T>
      </Section>

      {mode === 'pov' ? (
        <Section title="Who you play">
          {people.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {people.map((c) => <Chip key={c.id} image={imageOf(c.data as Record<string, unknown>)?.uri} label={c.name} selected={player === c.id} onPress={() => { setPlayer(c.id); setStartLoc(c.data.homeLocationId ?? null); }} />)}
            </ScrollView>
          ) : <T v="faint">No characters in this world yet. Add or forge one on the world page, then come back.</T>}
          {playerChar ? <T v="faint">{[playerChar.data.occupation, playerChar.summary].filter(Boolean).join(' · ')}</T> : null}
          {playerChar && !playerChar.data.attributes ? <Badge label="ordinary in every attribute; set them in the character’s In play section" tone="dim" /> : null}
          <T v="label">Difficulty</T>
          <Row>{DIFFICULTY.map((d) => <Chip key={d.key} label={d.label} selected={difficulty === d.key} onPress={() => setDifficulty(d.key)} />)}</Row>
          <T v="faint">{DIFFICULTY.find((d) => d.key === difficulty)!.hint}</T>
          <SwitchRow label="Tests of skill" hint="Risky actions are tested against your attributes with a d20; the outcome is decided before the narrator writes." value={checks} onChange={setChecks} />
          <T v="label">Start at</T>
          {refs.location?.length ? <RefChips value={startLoc} options={refs.location} onChange={setStartLoc} none="Let the story decide" /> : <T v="faint">No places in this world yet.</T>}
          {!interactive ? <T v="faint">Tip: a voice in second person, present tense, that stops after each response suits play. The seeded Interactive narrator does.</T> : null}
        </Section>
      ) : null}

      <Section title={mode === 'pov' ? 'Others in the story' : 'Characters'}>
        {people.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {people.filter((c) => c.id !== player).map((c) => <Chip key={c.id} small image={imageOf(c.data as Record<string, unknown>)?.uri} label={c.name} selected={cast.includes(c.id)} onPress={() => setCast((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} />)}
          </Row>
        ) : <T v="faint">None yet. Characters can be added later in session settings.</T>}
      </Section>

      <Section title="Story">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder={mode === 'pov' && playerChar ? `${playerChar.name} in ${world?.name ?? ''}` : 'Untitled'} />
        <Field label={mode === 'pov' ? 'Premise, optional' : 'Brief, optional'} value={brief} onChangeText={setBrief} multiline placeholder={mode === 'pov' ? 'What brings them here; what they want right now.' : 'Premise, ideas, people, limits.'} />
        <TimeEditor calendar={world?.data.calendar} value={clock} onChange={setClock} label="Opens at" />
        <T v="faint">Defaults to the latest moment anything in this instance has reached.</T>
      </Section>

      <Section title="Shared world">
        <SwitchRow label="Continuity" hint="The writer reads this instance’s timeline and the other stories in it. Free: no extra calls." value={cont} onChange={setContinuity} />
        <SwitchRow label="Chronicle" hint={mode === 'pov' ? 'Always on in play: it keeps the clock, the place and your sheet.' : 'After each passage a cheap helper call records elapsed time, the place, and events for the timeline.'} value={chron} onChange={setChronicle} disabled={mode === 'pov'} />
        {world?.isDefault && !cont && !chron && mode === 'writer' ? <T v="faint">The real world with both off is the plain, story-only experience.</T> : null}
      </Section>

      <Button title={mode === 'pov' ? 'Begin' : 'Start writing'} icon={mode === 'pov' ? 'game-controller-outline' : 'create-outline'} onPress={create} loading={busy} disabled={!world || !instanceId} />
    </Screen>
  );
}
