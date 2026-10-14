import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Species, Universe } from '@/core/types';
import type { EventKind, WorldEntity, WorldEvent, WorldInstance } from '@/core/world/types';
import { formatShort, formatTime } from '@/core/world/calendar';
import { resolveRefs } from '@/core/world/scan';
import { getUniverse, listCharacters, listSpecies } from '@/db/repo/library';
import { canonEvents, deleteEvent, deleteInstance, forkInstance, getInstance, instanceClock, listEntities, newEvent, saveEvent, saveInstance, sessionsInInstance } from '@/db/repo/world';
import { useEntity } from '@/ui/useEntity';
import { Badge, Button, Card, Chip, Field, MenuItem, Row, Screen, Section, Sheet, T } from '@/ui/components';
import { TimeEditor } from '@/ui/components/World';
import { useTheme } from '@/ui/theme';

const KINDS: EventKind[] = ['event', 'state', 'death', 'travel', 'item', 'relation', 'discovery'];

/** One version of a world: its stories, its timeline, and where it can branch. */
export default function InstanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const [inst, update] = useEntity<WorldInstance>(() => getInstance(db, id!), (v) => saveInstance(db, v), [id]);
  const [world, setWorld] = useState<Universe | null>(null);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [stories, setStories] = useState<{ id: string; title: string; mode: string; clockStart: number }[]>([]);
  const [clock, setClock] = useState(0);
  const [pool, setPool] = useState<{ characters: Character[]; entities: WorldEntity[]; species: Species[] }>({ characters: [], entities: [], species: [] });
  const [filter, setFilter] = useState<'all' | 'major' | string>('all');
  const [edit, setEdit] = useState<(WorldEvent & { who: string }) | null>(null);
  const [fork, setFork] = useState<{ name: string; description: string; at: number } | null>(null);

  const universeId = inst?.universeId;
  const reload = useCallback(() => {
    if (!id || !universeId) return;
    void Promise.all([getUniverse(db, universeId), canonEvents(db, id), sessionsInInstance(db, id), instanceClock(db, id), listCharacters(db), listEntities(db, universeId), listSpecies(db, universeId)]).then(([u, ev, st, c, chars, ents, sp]) => {
      setWorld(u); setEvents(ev); setStories(st); setClock(c);
      setPool({ characters: chars.filter((x) => x.universeId === universeId || x.universeId == null), entities: ents, species: sp });
    });
  }, [db, id, universeId]);
  useFocusEffect(reload);
  if (!inst) return null;
  const cal = world?.data.calendar;
  const titleOf = (sid: string | null) => (sid ? stories.find((s) => s.id === sid)?.title ?? 'a story' : null);
  const shown = events.filter((e) => (filter === 'all' ? true : filter === 'major' ? e.importance === 3 : e.sessionId === filter)).slice().reverse();

  async function saveEdit() {
    if (!edit) return;
    const { who, ...ev } = edit;
    await saveEvent(db, { ...ev, title: ev.title.trim() || ev.text.slice(0, 60) || 'Event', entities: resolveRefs(who.split(',').map((x) => x.trim()).filter(Boolean), pool) });
    setEdit(null);
    reload();
  }
  async function doFork() {
    if (!fork?.name.trim()) return;
    const made = await forkInstance(db, inst!, fork.at, fork.name.trim(), fork.description);
    setFork(null);
    router.replace(`/world/instance/${made.id}`);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: inst.name }} />
      <Section title="Instance">
        <Field label="Name" value={inst.name} onChangeText={(v) => update({ name: v })} />
        <Field label="How it differs" hint="Sent with every story in this instance." value={inst.description} onChangeText={(v) => update({ description: v })} multiline placeholder={inst.isPrime ? 'The world as its template describes it.' : 'What is different here.'} />
        <T v="faint">{world?.name}{inst.isPrime ? ' · prime instance' : ''}{inst.forkAt != null ? ` · forked at ${formatShort(cal, inst.forkAt)}` : ''} · latest moment {formatTime(cal, clock)}</T>
        <Row style={{ flexWrap: 'wrap' }}>
          <Button small icon="add" title="New story here" onPress={() => router.push(`/start?world=${inst.universeId}&instance=${inst.id}`)} />
          <Button small kind="outline" icon="game-controller-outline" title="Play here" onPress={() => router.push(`/start?world=${inst.universeId}&instance=${inst.id}&mode=pov`)} />
          <Button small kind="outline" icon="git-branch-outline" title="Fork" onPress={() => setFork({ name: `${inst.name}, otherwise`, description: '', at: clock })} />
        </Row>
      </Section>

      <Section title={`Stories · ${stories.length}`}>
        {stories.length ? stories.map((s) => <MenuItem key={s.id} icon={s.mode === 'pov' ? 'game-controller-outline' : 'book-outline'} label={s.title} hint={`opens ${formatShort(cal, s.clockStart)}`} onPress={() => router.push(`/session/${s.id}`)} />) : <T v="faint">No stories in this instance yet.</T>}
      </Section>

      <Section title="Timeline" right={<Button small kind="outline" icon="add" title="Event" onPress={() => setEdit({ ...newEvent(inst.id, clock), who: '' })} />}>
        <T v="faint">What has happened in this version of the world. Stories add to it as they are written (with Chronicle on) and read it (with Continuity on). Only the branch each story is on counts.</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip small label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip small label="Major" selected={filter === 'major'} onPress={() => setFilter('major')} />
          {stories.map((s) => <Chip key={s.id} small label={s.title} selected={filter === s.id} onPress={() => setFilter(s.id)} />)}
        </ScrollView>
        {shown.length ? shown.map((e) => (
          <Card key={e.id} onPress={() => setEdit({ ...e, who: e.entities.map((r) => r.name).join(', ') })} style={{ gap: 4, paddingVertical: 10 }}>
            <Row between>
              <T v="small" style={{ color: t.accent }}>{formatShort(cal, e.at)}</T>
              <Row gap={4}>
                {e.importance === 3 ? <Badge label="major" tone="warn" /> : null}
                {e.kind !== 'event' ? <Badge label={e.kind} /> : null}
              </Row>
            </Row>
            <T v="h">{e.title}</T>
            {e.text && e.text !== e.title ? <T v="dim">{e.text}</T> : null}
            <T v="faint">{[e.entities.map((r) => r.name).join(', '), titleOf(e.sessionId) ? `from ${titleOf(e.sessionId)}` : 'entered by hand'].filter(Boolean).join(' · ')}</T>
          </Card>
        )) : <T v="faint">Nothing recorded yet.</T>}
      </Section>

      {!inst.isPrime ? <Button kind="danger" title="Delete instance" onPress={() => Alert.alert('Delete instance?', 'Its timeline goes with it. Its stories move to the prime instance.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteInstance(db, inst.id); router.back(); } }])} /> : null}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit && events.some((x) => x.id === edit.id) ? 'Event' : 'New event'} full>
        {edit ? (
          <>
            <Field label="What happened" value={edit.title} onChangeText={(v) => setEdit({ ...edit, title: v })} placeholder="In a few words" />
            <Field label="Detail" value={edit.text} onChangeText={(v) => setEdit({ ...edit, text: v })} multiline />
            <Field label="Who and what" hint="Names, comma separated. Matched to the world’s people, places, factions and things." value={edit.who} onChangeText={(v) => setEdit({ ...edit, who: v })} />
            <TimeEditor calendar={cal} value={edit.at} onChange={(at) => setEdit({ ...edit, at })} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {KINDS.map((k) => <Chip key={k} small label={k} selected={edit.kind === k} onPress={() => setEdit({ ...edit, kind: k })} />)}
            </ScrollView>
            <Row>
              {([1, 2, 3] as const).map((i) => <Chip key={i} label={i === 1 ? 'Minor' : i === 2 ? 'Notable' : 'Major'} selected={edit.importance === i} onPress={() => setEdit({ ...edit, importance: i })} />)}
            </Row>
            <T v="faint">Major events reach every story in the instance. Others reach the stories they touch.</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Save" onPress={saveEdit} style={{ flex: 1 }} />
              {events.some((x) => x.id === edit.id) ? <Button kind="danger" title="Delete" onPress={async () => { await deleteEvent(db, edit.id); setEdit(null); reload(); }} /> : null}
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!fork} onClose={() => setFork(null)} title="Fork this instance" full>
        {fork ? (
          <>
            <T v="dim">A new version of the world that shares everything up to the moment you pick, and nothing after. Its stories start from there.</T>
            <Field label="Name" value={fork.name} onChangeText={(v) => setFork({ ...fork, name: v })} />
            <Field label="How it differs" value={fork.description} onChangeText={(v) => setFork({ ...fork, description: v })} multiline placeholder="e.g. The duke survived the flood." />
            <TimeEditor calendar={cal} value={fork.at} onChange={(at) => setFork({ ...fork, at })} label="Fork at" />
            <Button title="Fork" icon="git-branch-outline" onPress={doFork} disabled={!fork.name.trim()} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
