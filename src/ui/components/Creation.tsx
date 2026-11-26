import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CreateInput, Job } from '@/core/jobs';
import { STAGES, approvedIn, creationStatus, type Creation, type CreationStage } from '@/core/world/creation';
import { DRAFT_FIELDS, KIND_NOUN, libraryDrafts, tiesText, type Draft } from '@/core/world/drafts';
import type { ForgeKind } from '@/core/world/forge';
import { levelOf, type ArtBible, type FieldDef } from '@/core/world/schema';
import type { WorldCalendar } from '@/core/world/types';
import { formatTime } from '@/core/world/calendar';
import { getCreation } from '@/db/repo/creation';
import { abandon, approve, conclude, drop, keepEdits, moveOn, rework, rewish, setCreationModel, startCreation, undoRework, writeNext } from '@/state/creation';
import { useJobs } from '@/state/jobs';
import { loadLibrary } from '@/state/library';
import { useSettings } from '@/state/settings';
import { Badge, Banner, Button, Card, Chip, Field, IconButton, Ionicons, MenuItem, Row, Screen, Sheet, T } from './index';
import { MiniAvatar, openEntry } from './Entry';
import { JobStatusLine } from './JobStatus';
import { ModelPicker } from './ModelPicker';
import { DraftEditor } from './Proposals';
import { ReforgeSheet, type ReforgeTarget } from './Reforge';
import { KeyboardShift, useHeaderOffset } from '../keyboard';
import { shortModel } from '../format';
import { radius, serif, space, useTheme } from '../theme';

type NextKind = 'any' | Exclude<ForgeKind, 'world' | 'mixed'>;
const NEXT_KINDS: { key: NextKind; label: string }[] = [{ key: 'any', label: 'Anything' }, { key: 'location', label: 'Place' }, { key: 'organization', label: 'Faction' }, { key: 'species', label: 'People' }, { key: 'character', label: 'Character' }, { key: 'item', label: 'Thing' }, { key: 'lore', label: 'Lore' }];

const WHAT: Record<Exclude<CreationStage, 'done'>, string> = { overview: 'the overview', lore: 'the next lore page', entries: 'the next entry' };

/** The three stages, with where the session stands. */
function Steps({ stage }: { stage: CreationStage }) {
  const t = useTheme();
  const at = stage === 'done' ? STAGES.length : STAGES.findIndex((s) => s.key === stage);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {STAGES.map((s, i) => (
        <React.Fragment key={s.key}>
          {i ? <View style={{ flex: 1, height: 1, backgroundColor: i <= at ? t.accent : t.border, marginHorizontal: 8 }} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: i <= at ? t.accent : t.surface2 }}>
              {i < at ? <Ionicons name="checkmark" size={14} color={t.accentText} /> : <T v="small" style={{ color: i === at ? t.accentText : t.dim, fontWeight: '700' }}>{i + 1}</T>}
            </View>
            <T v="small" style={{ color: i === at ? t.text : t.dim, fontWeight: i === at ? '700' : '400' }}>{s.label}</T>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function shown(def: FieldDef, v: unknown): string {
  if (v == null || v === '') return '';
  switch (def.type) {
    case 'ties': return tiesText(v);
    case 'bool': return def.key === 'alwaysOn' && v === true ? 'Sent with every scene' : '';
    case 'keys': return Array.isArray(v) ? v.join(', ') : String(v);
    case 'level': return levelOf(def.levels ?? [], v)?.label ?? '';
    case 'number': return Number(v) ? String(v) : '';
    default: return typeof v === 'object' ? '' : String(v).trim();
  }
}

/** The entry on the table as a page to read: every filled field, long ones as prose. */
function DraftRead({ draft, why }: { draft: Draft; why?: string }) {
  const t = useTheme();
  const rows = DRAFT_FIELDS[draft.kind].map((def) => ({ def, text: shown(def, draft.fields[def.key]) })).filter((x) => x.text);
  const facts = rows.filter((x) => x.def.type !== 'long' && x.text.length <= 90);
  const blocks = rows.filter((x) => !facts.includes(x));
  const art = draft.kind === 'world' ? (draft.fields.art as Partial<ArtBible> | undefined) : undefined;
  const cal = draft.kind === 'world' ? (draft.fields.calendar as WorldCalendar | undefined) : undefined;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Row gap={6}>
          <T v="label">{draft.kind === 'lore' ? 'Lore page' : draft.kind === 'world' ? 'World overview' : KIND_NOUN[draft.kind]}</T>
          {draft.kind === 'character' && draft.fields.adult === false ? <Badge label="not adult" tone="warn" /> : null}
        </Row>
        <T v="title">{draft.name || 'Unnamed'}</T>
        {why ? <T v="dim" style={{ fontStyle: 'italic' }}>{why}</T> : null}
      </View>
      {facts.length ? (
        <View style={{ gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: t.surface }}>
          {facts.map(({ def, text }) => <T key={def.key} v="dim"><T v="dim" style={{ fontWeight: '600', color: t.text }}>{def.label}: </T>{text}</T>)}
        </View>
      ) : null}
      {blocks.map(({ def, text }) => (
        <View key={def.key} style={{ gap: 6 }}>
          <T v="label">{def.label}</T>
          {text.split(/\n{2,}/).map((p, i) => <T key={i} style={{ fontFamily: serif, fontSize: 16, lineHeight: 25 }}>{p.trim()}</T>)}
        </View>
      ))}
      {art?.look ? <View style={{ gap: 6 }}><T v="label">How its pictures look</T><T v="dim">{art.look}</T></View> : null}
      {cal ? <View style={{ gap: 6 }}><T v="label">Calendar</T><T v="dim">{cal.kind === 'gregorian' ? 'Real dates' : 'Its own reckoning'} · it begins {formatTime(cal, 0)}</T></View> : null}
      {draft.kind === 'world' ? <T v="faint">Approving this creates the world. The style bible and the calendar come with it; change them on the world’s page once it exists.</T> : null}
    </View>
  );
}

/** Starting a new world: a wish, and the three stages it will go through. */
export function CreationBegin() {
  const db = useSQLiteContext();
  const t = useTheme();
  const { apiKey, defaults } = useSettings();
  const [wish, setWish] = useState('');
  const [model, setModel] = useState(defaults.models.writer);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function begin(w: string) {
    setBusy(true); setErr(null);
    try {
      const c = await startCreation(db, { wish: w, model });
      router.replace(`/world/create/${c.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'New world' }} />
      <View style={{ gap: space.md }}>
        <T v="title">A world, built in three stages</T>
        <T v="dim">One entry is on the table at a time. You approve it, workshop it or drop it, and the next is written from everything approved so far.</T>
        <View style={{ gap: 10 }}>
          {STAGES.map((s, i) => (
            <Row key={s.key} gap={10} style={{ alignItems: 'flex-start' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2, marginTop: 1 }}><T v="small" style={{ fontWeight: '700' }}>{i + 1}</T></View>
              <View style={{ flex: 1 }}><T style={{ fontWeight: '600' }}>{s.label}</T><T v="dim">{s.blurb}</T></View>
            </Row>
          ))}
        </View>
        {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
        <Field label="What world do you want?" value={wish} onChangeText={setWish} placeholder="e.g. A drowned city-state run by salvage guilds; tide law; something living in the deep cisterns" multiline style={{ minHeight: 110 }} />
        <Row between>
          <T v="faint">Written by {shortModel(model)}</T>
          <Button small kind="ghost" icon="hardware-chip-outline" title="Change" onPress={() => setPicker(true)} />
        </Row>
        <Row>
          <Button title="Write the overview" icon="sparkles-outline" loading={busy} disabled={!apiKey || !wish.trim()} onPress={() => void begin(wish)} style={{ flex: 1 }} />
          <Button kind="outline" icon="shuffle-outline" title="Surprise me" disabled={!apiKey || busy} onPress={() => void begin('')} />
        </Row>
        <T v="faint">{apiKey ? 'It is saved at every step and written in the background: leave at any point, close the app, and pick it up again from the Library.' : 'Add your OpenRouter key in Settings first.'}</T>
      </View>
      <ModelPicker open={picker} onClose={() => setPicker(false)} onSelect={setModel} current={model} title="Create with" />
    </Screen>
  );
}

/** A creation session: its stages, what is on the table, and what to do with it. */
export function CreationSession({ id }: { id: string }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const offset = useHeaderOffset();
  const [c, setC] = useState<Creation | null | undefined>(undefined);
  const [notes, setNotes] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [soFar, setSoFar] = useState(false);
  const [picker, setPicker] = useState(false);
  const jobId = c?.jobId ?? null;
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));

  const load = useCallback(() => getCreation(db, id).then(setC), [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // What was being written has landed, failed or stopped: read the session again.
  const stamp = job ? `${job.id}:${job.status}` : '';
  useEffect(() => { void load(); }, [stamp, load]);

  if (c === undefined) return <Screen><Stack.Screen options={{ title: '' }} /><View /></Screen>;
  if (c === null) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'New world' }} />
        <T v="h">This session is gone</T>
        <T v="dim" style={{ marginVertical: space.md }}>It was forgotten, or its world was deleted.</T>
        <Button title="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const lore = approvedIn(c, 'lore');
  const entries = approvedIn(c, 'entries');
  const stageInfo = STAGES.find((s) => s.key === c.stage);
  const approved = c.log.filter((x) => x.decision === 'approved' && x.stage !== 'overview');
  const dropped = c.log.filter((x) => x.decision === 'dropped');

  return (
    <KeyboardShift style={{ flex: 1, backgroundColor: t.bg }} offset={offset}>
      <Stack.Screen options={{ title: c.name || 'New world', headerRight: () => <IconButton name="ellipsis-horizontal" onPress={() => setMenu(true)} /> }} />
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <Steps stage={c.stage} />
        <Row between>
          <T v="faint" style={{ flex: 1 }} numberOfLines={2}>{c.stage === 'done' ? 'Concluded.' : stageInfo?.blurb}</T>
          {c.universeId ? (
            <Pressable onPress={() => setSoFar(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <T v="small" style={{ color: t.accent }}>{lore.length} lore · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}</T>
              <Ionicons name="chevron-forward" size={12} color={t.accent} />
            </Pressable>
          ) : null}
        </Row>
      </View>
      <Table key={`${c.stage}:${c.pending?.id ?? 'none'}:${c.versions.length}`} c={c} job={job} onChange={setC} notes={notes} onNotes={setNotes} />

      <Sheet open={menu} onClose={() => setMenu(false)} title={c.name || 'New world'}>
        <MenuItem icon="hardware-chip-outline" label={`Written by ${shortModel(c.model)}`} hint="Change the model for what comes next" onPress={() => { setMenu(false); setPicker(true); }} />
        {c.universeId ? <MenuItem icon="planet-outline" label="Open the world" hint="Everything approved so far is already in it" onPress={() => { setMenu(false); router.push(`/library/universe/${c.universeId}`); }} /> : null}
        <MenuItem icon="trash-outline" danger label="Forget this session" hint={c.universeId ? 'The world stays, with everything approved into it' : 'Nothing has been created yet'} onPress={async () => { setMenu(false); await abandon(db, c.id); router.back(); }} />
      </Sheet>
      <Sheet open={soFar} onClose={() => setSoFar(false)} title="Approved so far" full>
        {approved.length ? approved.map((x) => (
          <Pressable key={`${x.id}:${x.at}`} onPress={() => { setSoFar(false); openEntry(x.kind, x.id); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MiniAvatar e={{ kind: x.kind, name: x.name }} size={32} />
            <View style={{ flex: 1 }}>
              <T numberOfLines={1} style={{ fontWeight: '600' }}>{x.name}</T>
              <T v="small" numberOfLines={1}>{KIND_NOUN[x.kind]}{x.line ? ` · ${x.line}` : ''}</T>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.faint} />
          </Pressable>
        )) : <T v="faint">Nothing yet beyond the overview.</T>}
        {dropped.length ? (
          <>
            <T v="label" style={{ marginTop: space.sm }}>Dropped</T>
            {dropped.map((x) => <T key={`${x.id}:${x.at}`} v="faint" numberOfLines={1}>{KIND_NOUN[x.kind]}: {x.name}</T>)}
          </>
        ) : null}
        <T v="faint">Approved entries are in the world already: open one to read or change it.</T>
      </Sheet>
      <ModelPicker open={picker} onClose={() => setPicker(false)} onSelect={(m) => void setCreationModel(db, c.id, m).then(setC)} current={c.model} title="Create with" />
    </KeyboardShift>
  );
}

type Ask = null | 'rework' | 'move' | 'conclude' | 'restart';

/** What is on the table, and the choices about it. Mounted fresh for each entry, so its edits start from the entry. */
function Table({ c, job, onChange, notes, onNotes }: { c: Creation; job: Job | undefined; onChange: (c: Creation) => void; notes: string[]; onNotes: (n: string[]) => void }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const apiKey = useSettings((s) => s.apiKey);
  const live = useJobs((s) => (job ? s.live[job.id] : undefined));
  const [draft, setDraft] = useState<Draft | null>(c.pending);
  const [editing, setEditing] = useState(false);
  const [steer, setSteer] = useState('');
  const [kind, setKind] = useState<NextKind>('any');
  const [ask, setAsk] = useState<Ask>(null);
  const [instruction, setInstruction] = useState('');
  const [wish, setWish] = useState(c.wish);
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pool, setPool] = useState<Draft[]>([]);
  const [reforge, setReforge] = useState<ReforgeTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<Draft | null>(null);

  const stage = c.stage;
  const running = job?.status === 'queued' || job?.status === 'running';
  const failed = job?.status === 'failed';
  const mode = job ? (job.input as CreateInput).mode : null;
  const nextKind = stage === 'entries' && kind !== 'any' ? kind : undefined;

  // Hand edits are kept as they are made, a moment after the last keystroke, and when the screen is left.
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const d = unsaved.current;
    unsaved.current = null;
    if (d) await keepEdits(db, c.id, d);
  }, [db, c.id]);
  useEffect(() => () => { void flush(); }, [flush]);
  const change = (p: Partial<Draft>) => {
    if (!draft) return;
    const next = { ...draft, ...p };
    setDraft(next);
    unsaved.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  async function act(f: () => Promise<Creation | void>) {
    setActing(true); setErr(null); setAsk(null);
    try {
      await flush();
      const next = await f();
      if (next) onChange(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }
  const opts = { steer, kind: nextKind };
  const doApprove = (o: { andMoveOn?: boolean; andConclude?: boolean } = {}) => act(async () => {
    if (!draft) return;
    const r = await approve(db, c.id, draft, { ...opts, ...o });
    onNotes(r.plan.notes);
    if (o.andConclude && r.creation.universeId) router.replace(`/library/universe/${r.creation.universeId}`);
    return r.creation;
  });
  const doDrop = (o: { andMoveOn?: boolean; andConclude?: boolean } = {}) => act(async () => {
    const next = await drop(db, c.id, { ...opts, ...o });
    if (o.andConclude && next.universeId) router.replace(`/library/universe/${next.universeId}`);
    return next;
  });
  const doConclude = () => act(async () => {
    const next = await conclude(db, c.id);
    if (next.universeId) router.replace(`/library/universe/${next.universeId}`);
    return next;
  });

  async function startEditing() {
    setEditing(true);
    if (c.universeId && !pool.length) setPool(libraryDrafts(await loadLibrary(db, c.universeId)));
  }

  const coveredNow = stage === 'lore' && c.enough && !draft;
  const steerCard = stage !== 'done' && stage !== 'overview' && !running ? (
    <View style={{ gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }}>
      <T v="label">{draft ? 'After this one' : coveredNow ? 'For one more page' : 'What comes next'}</T>
      {c.then.length ? (
        <Row style={{ flexWrap: 'wrap' }}>{c.then.map((x) => <Chip key={x} small label={x} selected={steer === x} onPress={() => setSteer(steer === x ? '' : x)} />)}</Row>
      ) : null}
      {stage === 'entries' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {NEXT_KINDS.map((k) => <Chip key={k.key} small label={k.label} selected={kind === k.key} onPress={() => setKind(k.key)} />)}
        </ScrollView>
      ) : null}
      <Field value={steer} onChangeText={setSteer} placeholder={stage === 'lore' ? 'Optional: a page you want, e.g. how debts are inherited' : 'Optional: what you want, e.g. a rival to the Salt Guild'} multiline />
      <T v="faint">{draft ? 'Left empty, the model picks what the world needs most.' : stage === 'lore' ? 'Left empty, the model picks the page the world needs most.' : 'Left empty, the model picks, working from the large to the small.'}</T>
    </View>
  ) : null;

  const bar = draft && !running && stage !== 'done' ? (
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md), borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.bg }}>
      <Button title="Approve" icon="checkmark" loading={acting} onPress={() => void doApprove()} style={{ flex: 1 }} />
      <Button kind="outline" icon="construct-outline" title="Rework" disabled={acting} onPress={() => { setInstruction(''); setAsk('rework'); }} />
      {stage === 'overview'
        ? <Button kind="ghost" icon="refresh-outline" title="Start over" disabled={acting} onPress={() => { setWish(c.wish); setAsk('restart'); }} />
        : <Button kind="ghost" icon="close" title="Drop" disabled={acting} onPress={() => void doDrop()} />}
    </View>
  ) : null;

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
        {notes.length ? <Banner tone="info" text={`Linked as it was added: ${notes.join('; ')}`} onClose={() => onNotes([])} /> : null}

        {running && job ? (
          <Card style={{ gap: 8 }}>
            <T v="h">{mode === 'revise' && draft ? `Reworking ${draft.name}` : `Writing ${WHAT[stage === 'done' ? 'entries' : stage]}`}</T>
            <JobStatusLine job={job} live={live} compact />
            <T v="faint">You can leave: it keeps going, and it will be waiting here.</T>
          </Card>
        ) : null}
        {failed && job ? (
          <View style={{ gap: 8 }}>
            <Banner text={job.error ?? 'It failed.'} />
            <Button kind="outline" icon="refresh-outline" title="Try again" onPress={() => void useJobs.getState().retry(db, job.id)} />
          </View>
        ) : null}

        {stage === 'done' ? (
          <Card style={{ gap: 10 }}>
            <T v="h">Concluded</T>
            <T v="dim">{c.name || 'The world'} has its overview, {approvedIn(c, 'lore').length} lore {approvedIn(c, 'lore').length === 1 ? 'page' : 'pages'} and {approvedIn(c, 'entries').length} {approvedIn(c, 'entries').length === 1 ? 'entry' : 'entries'} from this session. It is a world like any other now: forge into it, talk to its agent, or set a story there.</T>
            {c.universeId ? <Button title="Open the world" icon="planet-outline" onPress={() => router.replace(`/library/universe/${c.universeId}`)} /> : null}
          </Card>
        ) : null}

        {draft ? (
          <View style={{ gap: space.md, opacity: running ? 0.45 : 1, pointerEvents: running ? 'none' : 'auto' }}>
            {editing ? (
              <DraftEditor draft={draft} pool={pool} onChange={change} onReforge={(key) => setReforge({ draft, key, pool, universeId: c.universeId, apply: (v) => change(key === 'name' ? { name: String(v) } : { fields: { ...draft.fields, [key]: v } }) })} />
            ) : (
              <DraftRead draft={draft} why={c.why} />
            )}
            <Row style={{ flexWrap: 'wrap' }}>
              <Button small kind="outline" icon={editing ? 'checkmark' : 'create-outline'} title={editing ? 'Done editing' : 'Edit by hand'} onPress={() => (editing ? setEditing(false) : void startEditing())} />
              {c.versions.length ? <Button small kind="ghost" icon="arrow-undo-outline" title="Undo the last rework" onPress={() => void act(() => undoRework(db, c.id))} /> : null}
            </Row>
          </View>
        ) : null}

        {!draft && !running && stage !== 'done' ? (
          coveredNow ? (
            <Card style={{ gap: 10 }}>
              <T v="h">The foundations look covered</T>
              <T v="dim">{c.why || 'The model judges that a writer could set a scene anywhere in this world without having to invent how it works.'}</T>
              <Button title="Move on to the world" icon="arrow-forward" loading={acting} onPress={() => void act(() => moveOn(db, c.id))} />
              <Button kind="outline" icon="add" title="One more lore page" disabled={acting || !apiKey} onPress={() => void act(() => writeNext(db, c.id, { steer, more: true }))} />
            </Card>
          ) : (
            <Card style={{ gap: 10 }}>
              <T v="h">{stage === 'overview' ? 'No overview yet' : stage === 'lore' ? (approvedIn(c, 'lore').length ? 'Ready for the next lore page' : 'Next: the core lore') : approvedIn(c, 'entries').length ? 'Ready for the next entry' : 'Next: what is in the world'}</T>
              <T v="dim">{stage === 'overview' ? 'Write it from your wish, or change the wish first.' : stage === 'lore' ? 'Its systems and basic concepts, one page at a time. Each page takes the overview and every approved page as true.' : 'Places, factions, peoples, characters and things, one at a time, from the large to the small. Each is written from everything approved so far.'}</T>
              {stage === 'overview' ? <Field value={wish} onChangeText={setWish} placeholder="What world do you want?" multiline style={{ minHeight: 80 }} /> : null}
              <Button title={`Write ${WHAT[stage]}`} icon="sparkles-outline" loading={acting} disabled={!apiKey} onPress={() => void act(() => (stage === 'overview' ? rewish(db, c.id, wish) : writeNext(db, c.id, { steer, kind: nextKind })))} />
              {!apiKey ? <T v="faint">Add your OpenRouter key in Settings first.</T> : null}
            </Card>
          )
        ) : null}

        {steerCard}

        {stage === 'lore' && !coveredNow ? <Button kind="ghost" icon="arrow-forward" title="Enough lore: move on to the world" disabled={acting} onPress={() => (draft ? setAsk('move') : void act(() => moveOn(db, c.id)))} /> : null}
        {stage === 'entries' ? <Button kind="ghost" icon="flag-outline" title="Conclude: the world is fleshed out" disabled={acting} onPress={() => (draft ? setAsk('conclude') : void doConclude())} /> : null}
      </ScrollView>
      {bar}

      <Sheet open={ask === 'rework'} onClose={() => setAsk(null)} title={draft ? `Rework ${draft.name}` : 'Rework'}>
        <T v="faint">Say what should change. The whole entry is written again with it, keeping what you did not ask to change; edits you made by hand are kept as its starting point.</T>
        <Field value={instruction} onChangeText={setInstruction} placeholder="e.g. Less medieval: make the guilds feel like shipping companies. Keep the tide law." multiline style={{ minHeight: 90 }} autoFocus />
        <Row style={{ flexWrap: 'wrap' }}>
          {['Stranger and more specific', 'Darker', 'Simpler', 'More at stake'].map((x) => <Chip key={x} small label={x} onPress={() => setInstruction(x)} />)}
        </Row>
        <Button title="Rework it" icon="construct-outline" disabled={!apiKey} onPress={() => void act(async () => (draft ? rework(db, c.id, draft, instruction) : undefined))} />
      </Sheet>
      <Sheet open={ask === 'restart'} onClose={() => setAsk(null)} title="Start the overview over">
        <T v="faint">This overview is thrown away and a new one is written from the wish.</T>
        <Field value={wish} onChangeText={setWish} placeholder="What world do you want?" multiline style={{ minHeight: 90 }} />
        <Button title="Write a new overview" icon="refresh-outline" disabled={!apiKey} onPress={() => void act(() => rewish(db, c.id, wish))} />
      </Sheet>
      <Sheet open={ask === 'move'} onClose={() => setAsk(null)} title="Move on to the world">
        <T v="faint">{draft?.name} is still on the table.</T>
        <MenuItem icon="checkmark" label="Approve it and move on" onPress={() => void doApprove({ andMoveOn: true })} />
        <MenuItem icon="close" label="Drop it and move on" onPress={() => void doDrop({ andMoveOn: true })} />
      </Sheet>
      <Sheet open={ask === 'conclude'} onClose={() => setAsk(null)} title="Conclude">
        <T v="faint">{draft?.name} is still on the table.</T>
        <MenuItem icon="checkmark" label="Approve it and conclude" onPress={() => void doApprove({ andConclude: true })} />
        <MenuItem icon="close" label="Drop it and conclude" onPress={() => void doDrop({ andConclude: true })} />
      </Sheet>
      <ReforgeSheet target={reforge} onClose={() => setReforge(null)} />
    </>
  );
}

/** Sessions still open, as cards: where each stands, a tap from going back in. */
export function CreationCards({ sessions, worldLink = true }: { sessions: Creation[]; worldLink?: boolean }) {
  const t = useTheme();
  const jobs = useJobs((s) => s.jobs);
  if (!sessions.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {sessions.map((c) => {
        const job = c.jobId ? jobs.find((j) => j.id === c.jobId) : null;
        return (
          <Card key={c.id} onPress={() => router.push(`/world/create/${c.id}`)} style={{ gap: 8, borderColor: t.accent }}>
            <Row between>
              <T v="h" numberOfLines={1} style={{ flex: 1 }}>{c.name || c.wish || 'A new world'}</T>
              <Badge label="being created" tone="accent" />
            </Row>
            <Steps stage={c.stage} />
            <Row between>
              <T v="small" numberOfLines={1} style={{ flex: 1 }}>{creationStatus(c, job)}</T>
              {worldLink && c.universeId ? <Button small kind="ghost" icon="planet-outline" title="World" onPress={() => router.push(`/library/universe/${c.universeId}`)} /> : null}
            </Row>
          </Card>
        );
      })}
    </View>
  );
}
