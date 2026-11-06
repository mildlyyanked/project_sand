import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Session, Species, Universe } from '@/core/types';
import type { EventKind, WorldEntity, WorldEvent, WorldInstance } from '@/core/world/types';
import { formatShort, formatTime } from '@/core/world/calendar';
import { resolveRefs } from '@/core/world/scan';
import { getUniverse, listCharacters, listSpecies } from '@/db/repo/library';
import { canonEvents, deleteEvent, deleteInstance, forkInstance, getInstance, instanceClock, listEntities, newEvent, saveEvent, saveInstance, sessionsInInstance } from '@/db/repo/world';
import { useEntity } from '@/ui/useEntity';
import { emptyMemory, type InstanceEntry, type InstanceMemory, type PersonMemory, type Recap } from '@/core/world/memory';
import { namedIn } from '@/core/world/portraits';
import { loadMemory, deletePerson, savePerson, saveRecap, saveEntry } from '@/db/repo/memory';
import { canonizeEvent, chaptersOf, dropEntry, keepChapter, newChapter } from '@/state/memory';
import { useSettings } from '@/state/settings';
import { ForgeSheet } from '@/ui/components/Forge';
import { Badge, Banner, Button, Card, Chip, Field, MenuItem, Row, Screen, Section, Sheet, T } from '@/ui/components';
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
  const apiKey = useSettings((x) => x.apiKey);
  const [chapters, setChapters] = useState<Session[]>([]);
  const [mem, setMem] = useState<InstanceMemory>(emptyMemory);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [person, setPerson] = useState<(PersonMemory & { knowsText: string; relText: string; changesText: string }) | null>(null);
  const [entry, setEntry] = useState<InstanceEntry | null>(null);
  const [canon, setCanon] = useState<InstanceEntry | null>(null);
  const [openRecap, setOpenRecap] = useState<string | null>(null);

  const universeId = inst?.universeId;
  const reload = useCallback(() => {
    if (!id || !universeId) return;
    void Promise.all([getUniverse(db, universeId), canonEvents(db, id), sessionsInInstance(db, id), instanceClock(db, id), listCharacters(db), listEntities(db, universeId), listSpecies(db, universeId)]).then(([u, ev, st, c, chars, ents, sp]) => {
      setWorld(u); setEvents(ev); setStories(st); setClock(c);
      setPool({ characters: chars.filter((x) => x.universeId === universeId || x.universeId == null), entities: ents, species: sp });
    });
    void Promise.all([chaptersOf(db, id), loadMemory(db, id)]).then(([c, m]) => { setChapters(c); setMem(m); });
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
  async function remember(c: Session) {
    setErr(null);
    setBusy(c.id);
    try {
      const r = await keepChapter(db, c, { apiKey });
      if (!r) setErr('Nothing to remember yet: the chapter has no passages.');
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function next() {
    setErr(null);
    setBusy('next');
    try {
      const made = await newChapter(db, inst!.id, { apiKey, onKeeping: (title) => setBusy(`next:${title}`) });
      router.push(`/session/${made.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function savePersonEdit() {
    if (!person || !inst) return;
    const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const { knowsText, relText, changesText, ...p } = person;
    await savePerson(db, inst.id, { ...p, knows: lines(knowsText), changes: lines(changesText), relations: lines(relText).map((l) => { const i = l.indexOf(':'); return i > 0 ? { with: l.slice(0, i).trim(), stance: l.slice(i + 1).trim() } : { with: l, stance: '' }; }).filter((r) => r.with && r.stance) });
    setPerson(null);
    reload();
  }
  const status = (c: Session) => { const r = mem.recaps.find((x) => x.sessionId === c.id); return !c.currentBeatId ? 'not started' : !r ? 'not remembered yet' : r.upTo === c.currentBeatId ? 'remembered' : 'more written since'; };
  const excerpts = (e: InstanceEntry) => [e.note, ...mem.people.filter((p) => p.name === e.name).flatMap((p) => [p.now, ...p.changes, ...p.knows]), ...mem.recaps.filter((r) => namedIn(r.summary, e.name)).map((r) => r.summary)].filter(Boolean).slice(0, 6);

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

      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      <Section title={`Chapters · ${chapters.length}`} right={<Button small icon="add" title={busy?.startsWith('next') ? (busy.length > 5 ? `Remembering ${busy.slice(5)}…` : 'Starting…') : `Chapter ${chapters.length + 1}`} loading={busy?.startsWith('next')} disabled={!!busy || world?.isDefault} onPress={() => void next()} />}>
        {chapters.length ? chapters.map((c, n) => (
          <Row key={c.id} gap={8}>
            <MenuItem icon={c.mode === 'pov' ? 'game-controller-outline' : 'book-outline'} label={`${n + 1}. ${c.title}`} hint={`opens ${formatShort(cal, c.clockStart)} · ${status(c)}`} onPress={() => router.push(`/session/${c.id}`)} />
            {status(c) === 'not remembered yet' || status(c) === 'more written since' ? <Button small kind="ghost" icon="library-outline" title="Remember" loading={busy === c.id} disabled={!!busy} onPress={() => void remember(c)} /> : null}
          </Row>
        )) : <T v="faint">No chapters in this instance yet.</T>}
        <T v="faint">Chapters run in the order they start in the world. Before a new chapter begins, earlier ones are written into this instance’s memory, so it knows what happened and who knows what.</T>
      </Section>

      <Section title={`Previously · ${mem.recaps.length}`}>
        {mem.recaps.length ? chapters.map((c) => mem.recaps.find((r) => r.sessionId === c.id)).filter((r): r is Recap => !!r).map((r) => (
          <Card key={r.sessionId} onPress={() => setOpenRecap(openRecap === r.sessionId ? null : r.sessionId)} onLongPress={() => setRecap(r)} style={{ gap: 4 }}>
            <T v="h">{r.title}</T>
            <T v="dim" numberOfLines={openRecap === r.sessionId ? undefined : 3}>{r.summary}</T>
            {r.ending ? <T v="small">Ended: {r.ending}</T> : null}
            {r.open.length ? <T v="small" style={{ color: t.accent }}>Open: {r.open.join(' · ')}</T> : null}
          </Card>
        )) : <T v="faint">No chapter has been remembered yet.</T>}
        {mem.recaps.length ? <T v="faint">Tap to read in full, hold to edit. The next chapter reads these.</T> : null}
      </Section>

      <Section title={`People remembered · ${mem.people.length}`}>
        {mem.people.length ? mem.people.map((p) => (
          <Card key={p.key} onPress={() => setPerson({ ...p, knowsText: p.knows.join('\n'), relText: p.relations.map((r) => `${r.with}: ${r.stance}`).join('\n'), changesText: p.changes.join('\n') })} style={{ gap: 3, paddingVertical: 10 }}>
            <Row between><T v="h">{p.name}</T>{!p.libId ? <Badge label="only here" tone="info" /> : null}</Row>
            {p.now ? <T v="dim">{p.now}</T> : null}
            {p.changes.length ? <T v="small">For good: {p.changes.join('; ')}</T> : null}
            {p.relations.length ? <T v="small">{p.relations.map((r) => `${r.with}: ${r.stance}`).join(' · ')}</T> : null}
            {p.knows.length ? <T v="faint">Knows {p.knows.length} {p.knows.length === 1 ? 'thing' : 'things'}</T> : null}
          </Card>
        )) : <T v="faint">Nobody yet. The memory keeper adds people as chapters are remembered.</T>}
      </Section>

      <Section title={`Only in this instance · ${mem.entries.length}`}>
        {mem.entries.length ? mem.entries.map((e) => (
          <Card key={e.key} onPress={() => setEntry(e)} style={{ gap: 4, paddingVertical: 10 }}>
            <Row between><T v="h">{e.name}</T><Badge label={e.kind} /></Row>
            {e.note ? <T v="dim">{e.note}</T> : null}
            <Row style={{ flexWrap: 'wrap' }}>
              <Button small kind="outline" icon="sparkles-outline" title="Canonize" onPress={() => setCanon(e)} />
              <Button small kind="ghost" title="Drop" onPress={async () => { await dropEntry(db, inst.id, e.key); reload(); }} />
            </Row>
          </Card>
        )) : <T v="faint">People, places, factions and things the chapters made real here. Canonize one to put it in the world’s lore, for every instance.</T>}
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
            {events.some((x) => x.id === edit.id) && world && !world.isDefault ? <Button kind="outline" icon="sparkles-outline" title="Make canon: add to the world’s lore" onPress={async () => { const { who, ...ev } = edit; void who; await canonizeEvent(db, inst.universeId, ev); setEdit(null); Alert.alert('In the lore', 'This is now part of the world’s history, true in every instance.'); }} /> : null}
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
      <Sheet open={!!recap} onClose={() => setRecap(null)} title={recap?.title} full>
        {recap ? (
          <>
            <Field label="What happened" value={recap.summary} onChangeText={(v) => setRecap({ ...recap, summary: v })} multiline />
            <Field label="Where it ended" value={recap.ending} onChangeText={(v) => setRecap({ ...recap, ending: v })} multiline />
            <Field label="Still open" hint="One per line." value={recap.open.join('\n')} onChangeText={(v) => setRecap({ ...recap, open: v.split('\n') })} multiline />
            <Button title="Save" onPress={async () => { await saveRecap(db, inst.id, { ...recap, open: recap.open.map((x) => x.trim()).filter(Boolean) }); setRecap(null); reload(); }} />
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!person} onClose={() => setPerson(null)} title={person?.name} full>
        {person ? (
          <>
            <Field label="Now" hint="Where they are and what they are about." value={person.now} onChangeText={(v) => setPerson({ ...person, now: v })} multiline />
            <Field label="Knows" hint="One thing per line." value={person.knowsText} onChangeText={(v) => setPerson({ ...person, knowsText: v })} multiline />
            <Field label="With others" hint="One per line: Name: how they stand." value={person.relText} onChangeText={(v) => setPerson({ ...person, relText: v })} multiline />
            <Field label="Changed for good" hint="One per line." value={person.changesText} onChangeText={(v) => setPerson({ ...person, changesText: v })} multiline />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Save" onPress={savePersonEdit} style={{ flex: 1 }} />
              <Button kind="danger" title="Forget" onPress={async () => { await deletePerson(db, inst.id, person.key); setPerson(null); reload(); }} />
            </View>
            {!person.libId ? <Button kind="outline" icon="sparkles-outline" title="Canonize as a character" onPress={() => { const p = person; setPerson(null); setCanon({ key: p.key, kind: 'character', name: p.name, note: [p.now, ...p.changes].filter(Boolean).join('. '), from: p.seen[0] ?? '' }); }} /> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!entry} onClose={() => setEntry(null)} title={entry?.name}>
        {entry ? (
          <>
            <Field label="Name" value={entry.name} onChangeText={(v) => setEntry({ ...entry, name: v })} />
            <Field label="What it is" value={entry.note} onChangeText={(v) => setEntry({ ...entry, note: v })} multiline />
            <Button title="Save" onPress={async () => { await saveEntry(db, inst.id, entry); setEntry(null); reload(); }} />
          </>
        ) : null}
      </Sheet>

      <ForgeSheet
        open={!!canon}
        onClose={() => setCanon(null)}
        kind={canon?.kind ?? 'character'}
        universeId={inst.universeId}
        canon={canon ? { name: canon.name, kind: canon.kind, excerpts: excerpts(canon) } : null}
        onSaved={async () => { const c = canon; setCanon(null); if (c) await dropEntry(db, inst.id, c.key); reload(); }}
      />
    </Screen>
  );
}
