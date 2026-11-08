import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import type { EntityKind, WorldCalendar, WorldInstance } from '@/core/world/types';
import type { WorkshopMessage } from '@/core/world/agent';
import { KIND_NOUN, KIND_NOUN_PLURAL, type LibKind } from '@/core/world/drafts';
import { WORLD_FIELDS, bibleOf } from '@/core/world/schema';
import { connectionsOf } from '@/core/world/links';
import { formatShort, formatTime } from '@/core/world/calendar';
import { deleteUniverse, getUniverse, newCharacter, newLore, newSpecies, saveCharacter, saveLore, saveSpecies, saveUniverse } from '@/db/repo/library';
import { instanceClock, listInstances, newEntity, newInstance, saveEntity, saveInstance, sessionsInInstance } from '@/db/repo/world';
import { getAgent, listWorkshop } from '@/db/repo/agent';
import { useJobs, inboxOf } from '@/state/jobs';
import { Badge, Button, Card, Chip, Field, MenuItem, Row, Screen, SearchBox, Section, Sheet, Stepper, T, matches } from '@/ui/components';
import { useEntryReforge } from '@/ui/components/Reforge';
import { ForgeSheet } from '@/ui/components/Forge';
import type { ForgeKind } from '@/core/world/forge';
import { EntityTree } from '@/ui/components/Tree';
import { StyleBible } from '@/ui/components/StyleBible';
import { StyleBoard } from '@/ui/components/StyleBoard';
import { QuestionCard } from '@/ui/components/Question';
import { InboxList, ProposalSheet } from '@/ui/components/Proposals';
import { Block, EditActions, EditingBar, Lede, MiniAvatar, SectionsEditor, SectionsView, openEntry, useEditable, useLeaveGuard, useStartEditing, workshopRoute } from '@/ui/components/Entry';
import { useWorld, type EntryRef } from '@/ui/useWorld';
import { WorldMaps } from '@/ui/map/WorldMaps';
import { InboxButton } from '@/ui/components/InboxButton';
import { radius, space, useTheme } from '@/ui/theme';

type Tab = 'world' | 'map' | 'style' | 'workshop' | 'entries' | 'instances';
type Filter = 'all' | LibKind;
type Sort = 'name' | 'recent' | 'tied';

/** Older links name the tabs that used to be here. */
const LEGACY: Record<string, { tab: Tab; kind?: Filter }> = {
  overview: { tab: 'world' }, places: { tab: 'entries', kind: 'location' }, people: { tab: 'entries', kind: 'character' }, factions: { tab: 'entries', kind: 'organization' },
  things: { tab: 'entries', kind: 'item' }, peoples: { tab: 'entries', kind: 'species' }, lore: { tab: 'entries', kind: 'lore' }, instances: { tab: 'instances' }, workshop: { tab: 'workshop' }, entries: { tab: 'entries' }, world: { tab: 'world' }, map: { tab: 'map' }, maps: { tab: 'map' }, style: { tab: 'style' },
};
const KINDS: LibKind[] = ['location', 'character', 'organization', 'item', 'species', 'lore'];
const FORGE_OF: Record<Filter, ForgeKind> = { all: 'mixed', world: 'mixed', location: 'location', character: 'character', organization: 'organization', item: 'item', species: 'species', lore: 'lore' };

/** A world: what it is, its agent and inbox, everything in it, and the versions of it stories happen in. */
export default function WorldHub() {
  const { id, tab: tabParam, kind: kindParam, edit } = useLocalSearchParams<{ id: string; tab?: string; kind?: Filter; edit?: string }>();
  const db = useSQLiteContext();
  const start = LEGACY[tabParam ?? ''] ?? { tab: 'world' as Tab };
  const [tab, setTab] = useState<Tab>(start.tab);
  const [filter, setFilter] = useState<Filter>(kindParam ?? start.kind ?? 'all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [tiedTo, setTiedTo] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [forge, setForge] = useState<ForgeKind | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [instances, setInstances] = useState<(WorldInstance & { clock: number; stories: number })[]>([]);
  const [newInst, setNewInst] = useState<{ name: string; description: string } | null>(null);
  const [preview, setPreview] = useState<{ brief: string; last: WorkshopMessage | null }>({ brief: '', last: null });
  const ed = useEditable<Universe>(() => getUniverse(db, id!), (v) => saveUniverse(db, v), [id]);
  const w = useWorld(id);
  const jobs = useJobs((s) => s.jobs);
  const inbox = useMemo(() => jobs.filter((j) => j.universeId === id && (inboxOf([j], id).length || j.status === 'queued' || j.status === 'running' || j.status === 'failed') && j.kind !== 'question'), [jobs, id]);
  const waiting = inboxOf(jobs, id).filter((j) => j.kind !== 'question').length;
  const u = ed.value;
  const rowOf = useCallback(() => (ed.value ? { kind: 'world' as const, row: ed.value } : null), [ed.value]);
  const takeSelf = useCallback((row: unknown) => ed.setBuffer((b) => (b ? { ...b, ...(row as Universe), data: { ...b.data, ...(row as Universe).data } } : b)), [ed]);
  const rf = useEntryReforge({ db, universeId: id, row: rowOf, onSelf: takeSelf });
  useLeaveGuard(ed.dirty, ed.commit);
  useStartEditing(edit, !!ed.saved, ed.begin);

  const reloadSide = useCallback(() => {
    if (!id) return;
    void useJobs.getState().refresh(db);
    void listInstances(db, id).then(async (inst) => setInstances(await Promise.all(inst.map(async (i) => ({ ...i, clock: await instanceClock(db, i.id), stories: (await sessionsInInstance(db, i.id)).length })))));
    void Promise.all([getAgent(db, id), listWorkshop(db, id, 4)]).then(([a, m]) => setPreview({ brief: a.brief, last: [...m].reverse().find((x) => x.role === 'agent' && x.text) ?? null }));
  }, [db, id]);
  useFocusEffect(reloadSide);
  const stamp = jobs.filter((j) => j.universeId === id).map((j) => j.status).join();
  useEffect(() => { reloadSide(); }, [stamp, reloadSide]);

  // Search text and tie counts for every entry.
  const hay = useMemo(() => new Map(w.pool.map((d) => [d.id, [d.name, ...Object.values(d.fields).map((v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : ''))].join(' ')])), [w.pool]);
  const ties = useMemo(() => { const m = new Map<string, number>(); for (const e of w.index) m.set(e.id, connectionsOf(e.id, w.graph).length); return m; }, [w.index, w.graph]);
  const near = useMemo(() => (tiedTo ? new Set(connectionsOf(tiedTo, w.graph).map((c) => c.other)) : null), [tiedTo, w.graph]);
  const updated = useMemo(() => { const m = new Map<string, number>(); for (const e of w.lib?.entities ?? []) m.set(e.id, e.updatedAt); for (const c of w.lib?.characters ?? []) m.set(c.id, c.updatedAt); return m; }, [w.lib]);

  if (!u) return null;
  const cal = u.data.calendar;
  const setCal = (p: Partial<WorldCalendar>) => ed.change({ data: { ...u.data, calendar: { ...cal, ...p } } });
  const counts = Object.fromEntries(KINDS.map((k) => [k, w.index.filter((e) => e.kind === k).length])) as Record<LibKind, number>;
  const results = w.index
    .filter((e) => (filter === 'all' || e.kind === filter) && (!near || near.has(e.id)) && (!q.trim() || matches(q, hay.get(e.id) ?? e.name)))
    .sort((a, b) => (sort === 'tied' ? (ties.get(b.id) ?? 0) - (ties.get(a.id) ?? 0) : sort === 'recent' ? (updated.get(b.id) ?? 0) - (updated.get(a.id) ?? 0) : 0) || a.name.localeCompare(b.name));
  const treeKind = (filter === 'location' || filter === 'organization') && !q.trim() && !near && sort === 'name' ? (filter as EntityKind) : null;

  async function add(kind: LibKind) {
    setAddOpen(false);
    if (kind === 'location' || kind === 'organization' || kind === 'item') { const e = newEntity(u!.id, kind); await saveEntity(db, e); router.push(`/library/entity/${e.id}?edit=1`); }
    else if (kind === 'character') { const c = { ...newCharacter(), universeId: u!.id }; await saveCharacter(db, c); router.push(`/library/character/${c.id}?edit=1`); }
    else if (kind === 'species') { const s = newSpecies(u!.id); await saveSpecies(db, s); router.push(`/library/species/${s.id}?edit=1`); }
    else if (kind === 'lore') { const l = newLore(u!.id); await saveLore(db, l); router.push(`/library/lore/${l.id}?edit=1`); }
  }
  async function createInstance() {
    if (!newInst?.name.trim()) return;
    const i = { ...newInstance(u!.id, newInst.name.trim()), description: newInst.description };
    await saveInstance(db, i);
    setNewInst(null);
    router.push(`/world/instance/${i.id}`);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'world', label: 'World' },
    { key: 'map', label: 'Map' },
    ...(u.isDefault ? [] : [{ key: 'style' as Tab, label: 'Style' }, { key: 'workshop' as Tab, label: waiting ? `Workshop · ${waiting}` : 'Workshop' }]),
    { key: 'entries', label: `Entries${w.index.length ? ` · ${w.index.length}` : ''}` },
    { key: 'instances', label: 'Instances' },
  ];
  const bible = bibleOf(u.data.art);
  const inboxIcon = <InboxButton world={u.id} />;
  const headerRight = () => (tab === 'world' || tab === 'style'
    ? <EditActions editing={ed.editing} dirty={ed.dirty} saving={ed.saving} onEdit={ed.begin} onSave={() => void ed.commit()} onDiscard={ed.discard} extra={ed.editing ? undefined : inboxIcon} />
    : inboxIcon);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: u.name, headerRight }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: space.md }}>
        {tabs.map((x) => <Chip key={x.key} label={x.label} selected={tab === x.key} onPress={() => setTab(x.key)} />)}
      </ScrollView>

      {tab === 'world' ? (ed.editing ? (
        <>
          <EditingBar dirty={ed.dirty} />
          <View style={{ gap: 14 }}>
            {u.isDefault ? <T v="faint">The real world sends nothing to the writer unless you write something here. Stories set in it stay exactly as plain as before.</T> : null}
            <Field label="Name" value={u.name} onChangeText={(v) => ed.change({ name: v })} onForge={() => void rf.open('name')} />
            <Field label="Description" hint="Always sent to the writer when a story is set here." value={u.description} onChangeText={(v) => ed.change({ description: v })} multiline style={{ minHeight: 140 }} onForge={() => void rf.open('description')} />
          </View>
          <View style={{ height: 18 }} />
          <SectionsEditor defs={WORLD_FIELDS} data={u.data as unknown as Record<string, unknown>} onChange={(p) => ed.change({ data: { ...u.data, ...p } })} onForge={(d) => void rf.open(d.key)} />
          <Block title="Calendar">
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
          </Block>
          {!u.isDefault ? (
            <Block title="Danger zone">
              <Button kind="danger" title="Delete world" onPress={() => Alert.alert('Delete world?', 'Places, factions, things, peoples, lore, ties, instances and their timelines go with it, and its workshop. Characters stay, detached. Stories move to the real world.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteUniverse(db, u.id); ed.discard(); setTimeout(() => router.back(), 0); } }])} />
            </Block>
          ) : null}
        </>
      ) : (
        <>
          {!u.isDefault ? <View style={{ marginBottom: space.lg }}><QuestionCard universe={u} /></View> : null}
          <Lede kicker={['World', u.data.genre.split('\n')[0]?.slice(0, 60)].filter(Boolean).join(' · ')} title={u.name} />
          {u.description ? u.description.split(/\n{2,}/).map((p, i) => <T key={i} v="serif" style={{ fontSize: 17, lineHeight: 26, marginBottom: 10 }}>{p.trim()}</T>) : <T v="faint">{u.isDefault ? 'The real world sends nothing to the writer unless you write something here.' : 'No description yet. Tap the pencil to write one, or ask the agent in the Workshop.'}</T>}
          <View style={{ height: 12 }} />
          <SectionsView defs={WORLD_FIELDS.map((d) => (d.key === 'genre' ? { ...d, section: 'look' as const, type: 'long' as const } : d))} data={u.data as unknown as Record<string, unknown>} />
          {!u.isDefault ? (
            <Block title="What is in it">
              <Row style={{ flexWrap: 'wrap' }}>
                {KINDS.map((k) => <Chip key={k} small label={`${counts[k]} ${KIND_NOUN_PLURAL[k].toLowerCase()}`} onPress={() => { setFilter(k); setTab('entries'); }} />)}
              </Row>
            </Block>
          ) : null}
          <Block title="Calendar"><T v="dim">{cal.kind === 'gregorian' ? 'Real dates' : 'Its own reckoning'} · minute zero is {formatTime(cal, 0)}</T></Block>
        </>
      )) : null}

      {tab === 'map' ? <WorldMaps lib={w.lib} /> : null}

      {tab === 'style' ? (ed.editing ? (
        <>
          <EditingBar dirty={ed.dirty} />
          <T v="faint">The style bible is how every picture of this world is made: portraits, places, things, emblems. It is never sent to the writer.</T>
          <View style={{ height: 8 }} />
          <StyleBible value={u.data.art ?? {}} onChange={(art) => ed.change({ data: { ...u.data, art } })} universe={u} people={w.lib?.characters ?? []} entities={w.lib?.entities ?? []} />
        </>
      ) : (
        <>
          <StyleBoard bible={bible} lib={w.lib} />
          <T v="faint" style={{ marginTop: space.md }}>Tap the pencil to change the bible, or have it written for you. Its maps take their look from the world too; each map can pick its own in the map editor.</T>
        </>
      )) : null}

      {tab === 'workshop' ? (
        <>
          <Section title={`Inbox${waiting ? ` · ${waiting}` : ''}`}>
            <InboxList jobs={inbox} onOpen={setReview} empty="Nothing waiting. What forge, reforge and the agent write lands here for you to accept or dismiss; it keeps going when you leave." />
          </Section>
          <Section title="The agent" right={<Button small kind="outline" icon="chatbubbles-outline" title="Open" onPress={() => router.push(workshopRoute(u.id) as never)} />}>
            <Card onPress={() => router.push(workshopRoute(u.id) as never)} style={{ gap: 8 }}>
              <T v="label">The brief</T>
              {preview.brief ? <T v="dim" numberOfLines={8}>{preview.brief}</T> : <T v="faint">Empty so far. The agent starts one as it learns what you want for this world.</T>}
              {preview.last ? <><T v="label">Last said</T><T v="dim" numberOfLines={3}>{preview.last.text}</T></> : null}
            </Card>
            <Row style={{ flexWrap: 'wrap' }}>
              <Button small kind="outline" icon="leaf-outline" title="Grow the world" onPress={() => setForge('mixed')} />
              <Button small kind="ghost" icon="help-circle-outline" title="What does it need?" onPress={() => router.push(`${workshopRoute(u.id)}?intent=${encodeURIComponent('whatever this world most needs next')}` as never)} />
            </Row>
            <T v="faint">The agent is a curious co-author: it knows everything in this world, keeps a brief of what you want, and proposes entries and changes. Grow the world forges a batch straight away.</T>
          </Section>
        </>
      ) : null}

      {tab === 'entries' ? (
        <>
          <SearchBox value={q} onChange={setQ} placeholder={`Search ${u.name}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: space.sm }}>
            <Chip small label={`All · ${w.index.length}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
            {KINDS.map((k) => <Chip key={k} small label={`${KIND_NOUN_PLURAL[k]}${counts[k] ? ` · ${counts[k]}` : ''}`} selected={filter === k} onPress={() => setFilter(k)} />)}
          </ScrollView>
          <Row between style={{ marginBottom: space.sm }}>
            <Row gap={4}>
              {(['name', 'recent', 'tied'] as Sort[]).map((s) => <Chip key={s} small label={s === 'name' ? 'A–Z' : s === 'recent' ? 'Recent' : 'Most tied'} selected={sort === s} onPress={() => setSort(s)} />)}
            </Row>
            <Row gap={4}>
              <Button small kind="ghost" icon="sparkles-outline" title="Forge" onPress={() => setForge(FORGE_OF[filter])} />
              <Button small kind="outline" icon="add" title="Add" onPress={() => (filter === 'all' || filter === 'world' ? setAddOpen(true) : void add(filter))} />
            </Row>
          </Row>
          {tiedTo ? (
            <Row gap={6} style={{ marginBottom: space.sm }}>
              <T v="small">Tied to</T>
              <Chip small label={`${w.byId.get(tiedTo)?.name ?? '…'}  ×`} selected onPress={() => setTiedTo(null)} />
            </Row>
          ) : null}
          {treeKind ? (
            <EntityTree items={(w.lib?.entities ?? []).filter((e) => e.kind === treeKind)} onOpen={(e) => openEntry(e.kind, e.id)} />
          ) : results.length ? (
            <View style={{ gap: 2 }}>
              {results.slice(0, 200).map((e) => <EntryRow key={e.id} e={e} ties={ties.get(e.id) ?? 0} onTied={() => setTiedTo(e.id)} />)}
            </View>
          ) : (
            <T v="faint" style={{ marginTop: space.md }}>{w.index.length ? 'Nothing matches.' : 'Nothing here yet. Add an entry, forge some, or ask the agent in the Workshop.'}</T>
          )}
          {results.length > 200 ? <T v="faint">Showing 200 of {results.length}: search to narrow it.</T> : null}
          {treeKind ? <T v="faint" style={{ marginTop: space.sm }}>Tap the arrow to open what sits inside. Search or sort to see them flat.</T> : null}
        </>
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

      <ForgeSheet open={!!forge} onClose={() => { setForge(null); void w.reload(); }} kind={forge ?? 'mixed'} universeId={u.id} onSaved={() => void w.reload()} />
      <ProposalSheet jobId={review} onClose={() => { setReview(null); void w.reload(); void ed.reload(); }} onAccepted={() => void w.reload()} />
      {rf.sheet}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add to the world">
        {KINDS.map((k) => <MenuItem key={k} icon={({ location: 'location-outline', character: 'person-outline', organization: 'flag-outline', item: 'cube-outline', species: 'body-outline', lore: 'book-outline' } as const)[k as 'location']} label={KIND_NOUN[k]} onPress={() => void add(k)} />)}
      </Sheet>
      <Sheet open={!!newInst} onClose={() => setNewInst(null)} title="New instance">
        <Field label="Name" value={newInst?.name ?? ''} onChangeText={(v) => setNewInst((x) => (x ? { ...x, name: v } : x))} placeholder="e.g. The Long Winter, What if the duke lived" autoFocus />
        <Field label="How it differs" value={newInst?.description ?? ''} onChangeText={(v) => setNewInst((x) => (x ? { ...x, description: v } : x))} multiline placeholder="Optional. Sent with every story in it." />
        <T v="faint">Starts with an empty timeline. To branch from an existing instance at a moment, use Fork on that instance instead.</T>
        <Button title="Create" onPress={createInstance} disabled={!newInst?.name.trim()} />
      </Sheet>
      <View style={{ height: 40 }} />
    </Screen>
  );
}

/** One entry in a list: picture, name, kind and type, a line about it, how tied it is. */
function EntryRow({ e, ties, onTied }: { e: EntryRef; ties: number; onTied: () => void }) {
  const t = useTheme();
  return (
    <Card onPress={() => openEntry(e.kind, e.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderRadius: radius.md }}>
      <MiniAvatar e={e} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1} style={{ fontWeight: '600' }}>{e.name}</T>
        <T v="small" numberOfLines={1}>{[KIND_NOUN[e.kind], e.type].filter(Boolean).join(' · ')}</T>
        {e.hint ? <T v="faint" numberOfLines={1}>{e.hint}</T> : null}
      </View>
      {ties ? <Chip small label={`${ties} ${ties === 1 ? 'tie' : 'ties'}`} onPress={onTied} color={t.dim} /> : null}
    </Card>
  );
}
