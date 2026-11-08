import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { BibleOutput, Job, MapOutput, ReforgeInput, ReforgeOutput } from '@/core/jobs';
import { MapPicture } from '../map/MapCanvas';
import { proposalCount } from '@/core/jobs';
import { changedFields, removing } from '@/core/world/agent';
import { DRAFT_FIELDS, KIND_NOUN, fieldDef, normName, tiesText, type Draft } from '@/core/world/drafts';
import { BIBLE_FIELDS } from '@/core/world/schema';
import { useJobs } from '@/state/jobs';
import { acceptBible, acceptDrafts, acceptMap, acceptReforge, dismissDrafts, draftsOf } from '@/state/proposals';
import { loadLibrary, namesByKind } from '@/state/library';
import { libraryDrafts } from '@/core/world/drafts';
import { Badge, Banner, Button, Card, Field, FieldLabel, IconButton, Ionicons, Row, Sheet, T } from './index';
import { FieldEditor, RefChips } from './World';
import { JobStatusLine } from './JobStatus';
import { ReforgeSheet, type ReforgeTarget } from './Reforge';
import { radius, useTheme } from '../theme';

const str = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

export const subtitleOf = (d: Draft) => {
  const f = d.fields;
  const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '');
  return [s('type'), s('lifeStage'), s('occupation'), s('summary') || s('description') || s('text') || s('adulthood')].filter(Boolean).join(' · ');
};

/** The links a draft will make, in one faint line. */
export function LinkLine({ d }: { d: Draft }) {
  const parts = DRAFT_FIELDS[d.kind].filter((f) => f.type === 'ref' && typeof d.fields[f.key] === 'string' && (d.fields[f.key] as string).trim()).map((f) => `${f.label.toLowerCase()} ${d.fields[f.key] as string}`);
  const ties = tiesText(d.fields.ties);
  const all = [...parts, ...(ties ? [ties] : [])];
  return all.length ? <T v="faint" numberOfLines={2}>{all.join(' · ')}</T> : null;
}

/** Every field of a draft, editable, each with a sparkle to reforge it alone. References are by name. */
export function DraftEditor({ draft, pool, onChange, onReforge }: { draft: Draft; pool: Draft[]; onChange: (p: Partial<Draft>) => void; onReforge: (key: string) => void }) {
  const names = namesByKind(pool.filter((d) => d.id !== draft.id));
  const only = draft.existing ? changedFields(draft) : [];
  const defs = DRAFT_FIELDS[draft.kind].filter((d) => !only.length || only.includes(d.key));
  return (
    <View style={{ gap: 14 }}>
      <T v="faint">{draft.existing ? `Change to ${KIND_NOUN[draft.kind].toLowerCase()}` : KIND_NOUN[draft.kind]}</T>
      {draft.existing ? <T v="h">{draft.name}</T> : <Field label="Name" value={draft.name} onChangeText={(v) => onChange({ name: v })} onForge={() => onReforge('name')} />}
      {defs.map((def) => {
        if (def.type === 'ties') {
          const ties = tiesText(draft.fields.ties);
          return ties ? <View key="ties" style={{ gap: 4 }}><FieldLabel label="Ties" /><T v="dim">{ties}</T></View> : null;
        }
        if (def.type === 'ref' && def.ref) {
          const v = typeof draft.fields[def.key] === 'string' ? (draft.fields[def.key] as string) : '';
          const opts = names[def.ref];
          const all = v && !opts.some((o) => normName(o) === normName(v)) ? [v, ...opts] : opts;
          const picked = all.find((n) => normName(n) === normName(v)) ?? null;
          return (
            <View key={def.key} style={{ gap: 6 }}>
              <FieldLabel label={def.label} onForge={() => onReforge(def.key)} />
              {all.length ? <RefChips value={picked} options={all.map((n) => ({ id: n, name: n }))} onChange={(n) => onChange({ fields: { ...draft.fields, [def.key]: n ?? '' } })} /> : <T v="faint">Nothing to pick yet.</T>}
            </View>
          );
        }
        return <FieldEditor key={def.key} defs={[def]} data={draft.fields} onChange={(p) => onChange({ fields: { ...draft.fields, ...p } })} onForge={(d) => onReforge(d.key)} />;
      })}
    </View>
  );
}

/** What a change to an existing entry changes, field by field. */
function ChangeLines({ d }: { d: Draft }) {
  if (removing(d)) return <T v="dim">Taken out of the world, with its ties.{d.fields._why ? ` Why: ${str(d.fields._why)}` : ''}</T>;
  return (
    <View style={{ gap: 4 }}>
      {typeof d.fields._why === 'string' && d.fields._why ? <T v="small">{d.fields._why}</T> : null}
      {changedFields(d).map((k) => k === 'name'
        ? <T key={k} v="dim"><T v="dim" style={{ fontWeight: '600' }}>Name: </T>{str(d.fields._was)} → {d.name}</T>
        : <T key={k} v="dim" numberOfLines={4}><T v="dim" style={{ fontWeight: '600' }}>{fieldDef(d.kind, k)?.label ?? k}: </T>{str(d.fields[k]) || '(cleared)'}</T>)}
    </View>
  );
}

/**
 * A finished job's proposals: entries to add, changes to make, a field, a
 * style bible. Each can be opened and edited, added on its own or with the
 * rest, or dismissed; what was decided stays decided.
 */
export function ProposalReview({ job, onDone, onAccepted }: { job: Job; onDone?: () => void; onAccepted?: (notes: string[]) => void }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const live = useJobs((s) => s.live[job.id]);
  const drafts = useMemo(() => draftsOf(job), [job]);
  const [edited, setEdited] = useState<Record<string, Draft>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pool, setPool] = useState<Draft[]>([]);
  const [reforge, setReforge] = useState<ReforgeTarget | null>(null);
  const isWorld = drafts.some((d) => d.kind === 'world');
  const undecided = drafts.filter((d) => !job.decisions[d.id]);
  const chosen = undecided.filter((d) => !skip.has(d.id));

  if (job.status !== 'done') {
    return (
      <View style={{ gap: 8 }}>
        <JobStatusLine job={job} live={live} />
        {job.status === 'failed' ? <Banner text={job.error ?? 'It failed.'} /> : null}
        {job.status === 'queued' || job.status === 'running' ? <T v="faint">This keeps going if you close it or leave the app; the results will wait here.</T> : null}
      </View>
    );
  }

  async function accept(ids: string[]) {
    setBusy(true); setErr(null);
    try {
      const plan = await acceptDrafts(db, job, ids, edited);
      const n = plan?.notes ?? [];
      onAccepted?.(n);
      if (n.length) setNotes(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(id: string) {
    if (!pool.length) setPool(libraryDrafts(await loadLibrary(db, job.universeId)));
    setOpen(id);
  }

  if (job.kind === 'reforge') {
    const input = job.input as ReforgeInput;
    const out = job.output as ReforgeOutput;
    const decided = job.decisions.all;
    const before = input.key === 'name' ? input.draft.name : input.draft.fields[input.key];
    return (
      <View style={{ gap: 10 }}>
        <T v="faint">{input.def.label} of {input.draft.name}</T>
        {str(before) ? <Card style={{ gap: 4 }}><T v="small">Before</T><T v="dim" numberOfLines={6}>{str(before)}</T></Card> : null}
        <Card style={{ gap: 4 }}><T v="small">Proposed</T><T>{str(out.value) || '(none)'}</T></Card>
        {decided ? <Badge label={decided === 'accepted' ? 'used' : 'dismissed'} tone={decided === 'accepted' ? 'ok' : 'dim'} /> : (
          <Row>
            <Button title="Use it" icon="checkmark" loading={busy} onPress={async () => { setBusy(true); try { await acceptReforge(db, job); onAccepted?.([]); onDone?.(); } finally { setBusy(false); } }} style={{ flex: 1 }} />
            <Button kind="outline" title="Dismiss" onPress={async () => { await useJobs.getState().decide(db, job.id, 'all', 'dismissed'); onDone?.(); }} />
          </Row>
        )}
      </View>
    );
  }

  if (job.kind === 'map') {
    const out = job.output as MapOutput;
    const decided = out.saved ? 'accepted' : job.decisions.all;
    return (
      <View style={{ gap: 10 }}>
        <View style={{ borderRadius: radius.md, overflow: 'hidden', alignSelf: 'center' }}><MapPicture doc={out.doc} width={340} /></View>
        <T v="faint">{out.doc.pins.length} places · {out.doc.areas.length + out.doc.lines.length} shapes</T>
        {decided ? <Badge label={decided === 'accepted' ? 'used' : 'dismissed'} tone={decided === 'accepted' ? 'ok' : 'dim'} /> : (
          <Row>
            <Button title="Use this map" icon="checkmark" loading={busy} onPress={async () => { setBusy(true); try { await acceptMap(db, job); onAccepted?.([]); onDone?.(); } finally { setBusy(false); } }} style={{ flex: 1 }} />
            <Button kind="outline" title="Keep mine" onPress={async () => { await useJobs.getState().decide(db, job.id, 'all', 'dismissed'); onDone?.(); }} />
          </Row>
        )}
        {!decided ? <T v="faint">Using it replaces the place’s map, hand edits included.</T> : null}
      </View>
    );
  }

  if (job.kind === 'bible') {
    const b = (job.output as BibleOutput).bible;
    const decided = job.decisions.all;
    return (
      <View style={{ gap: 10 }}>
        {BIBLE_FIELDS.filter((f) => b[f.key]).map((f) => <Card key={f.key} style={{ gap: 4 }}><T v="small">{f.label}</T><T>{b[f.key]}</T></Card>)}
        {decided ? <Badge label={decided === 'accepted' ? 'used' : 'dismissed'} tone={decided === 'accepted' ? 'ok' : 'dim'} /> : job.universeId ? (
          <Row>
            <Button title="Use it" icon="checkmark" loading={busy} onPress={async () => { setBusy(true); try { await acceptBible(db, job); onAccepted?.([]); onDone?.(); } finally { setBusy(false); } }} style={{ flex: 1 }} />
            <Button kind="outline" title="Dismiss" onPress={async () => { await useJobs.getState().decide(db, job.id, 'all', 'dismissed'); onDone?.(); }} />
          </Row>
        ) : null}
      </View>
    );
  }

  const openDraftObj = open ? edited[open] ?? drafts.find((d) => d.id === open) ?? null : null;
  if (openDraftObj) {
    const all = [...pool, ...drafts.map((d) => edited[d.id] ?? d)];
    return (
      <View style={{ gap: 12 }}>
        <DraftEditor draft={openDraftObj} pool={all} onChange={(p) => setEdited((e) => ({ ...e, [openDraftObj.id]: { ...openDraftObj, ...p } }))} onReforge={(key) => setReforge({ draft: openDraftObj, key, pool: all, universeId: job.universeId, apply: (v) => setEdited((e) => { const base = e[openDraftObj.id] ?? openDraftObj; return { ...e, [openDraftObj.id]: key === 'name' ? { ...base, name: String(v) } : { ...base, fields: { ...base.fields, [key]: v } } }; }) })} />
        <Button kind="outline" icon="arrow-back" title="Back to the list" onPress={() => setOpen(null)} />
        <ReforgeSheet target={reforge} onClose={() => setReforge(null)} />
      </View>
    );
  }

  if (notes) {
    return (
      <View style={{ gap: 8 }}>
        <T v="h">Added</T>
        <T v="dim">Older entries were linked to the new ones:</T>
        {notes.map((n, i) => <T key={i}>• {n}</T>)}
        <Button title={undecided.length ? 'Back to the rest' : 'Done'} onPress={() => (undecided.length ? setNotes(null) : onDone?.())} />
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {job.output && 'truncated' in job.output && (job.output as { truncated: boolean }).truncated ? <Banner tone="warn" text="The reply was cut short, so the last entries may be missing or incomplete." /> : null}
      {undecided.length ? <T v="faint">Tap one to read or edit it. Untick what you do not want, then add the rest.</T> : <T v="faint">All decided.</T>}
      {drafts.map((raw) => {
        const d = edited[raw.id] ?? raw;
        const decided = job.decisions[d.id];
        const off = skip.has(d.id);
        return (
          <Card key={d.id} onPress={decided || removing(d) ? undefined : () => void openDraft(d.id)} style={{ gap: 4, opacity: decided === 'dismissed' ? 0.4 : off ? 0.55 : 1 }}>
            <Row between>
              {decided ? <Ionicons name={decided === 'accepted' ? 'checkmark-circle' : 'close-circle-outline'} size={20} color={decided === 'accepted' ? t.ok : t.faint} /> : <IconButton name={off ? 'square-outline' : 'checkbox'} size={20} onPress={() => setSkip((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />}
              <T v="h" style={{ flex: 1 }} numberOfLines={1}>{d.name}</T>
              {removing(d) ? <Badge label="remove" tone="danger" /> : d.existing ? <Badge label={changedFields(d).includes('name') ? 'rename' : 'change'} tone="info" /> : <Badge label={KIND_NOUN[d.kind].toLowerCase()} tone="dim" />}
              {d.kind === 'character' && d.fields.adult === false ? <Badge label="not adult" tone="warn" /> : null}
              {edited[d.id] ? <Badge label="edited" tone="accent" /> : null}
            </Row>
            {d.existing ? <ChangeLines d={d} /> : <T v="dim" numberOfLines={4}>{subtitleOf(d)}</T>}
            {!d.existing ? <LinkLine d={d} /> : null}
            {!decided && !isWorld ? (
              <Row gap={4} style={{ justifyContent: 'flex-end' }}>
                <Button small kind="ghost" title="Dismiss" onPress={() => void dismissDrafts(db, job, [d.id])} />
                <Button small kind={removing(d) ? 'danger' : 'outline'} icon={removing(d) ? 'trash-outline' : 'add'} title={removing(d) ? 'Remove' : d.existing ? 'Apply' : 'Add'} loading={busy} onPress={() => void accept([d.id])} />
              </Row>
            ) : null}
            {decided ? <T v="small">{decided === 'accepted' ? (removing(d) ? 'Removed' : d.existing ? 'Applied' : 'Added to the world') : 'Dismissed'}</T> : null}
          </Card>
        );
      })}
      {undecided.length ? (
        <>
          <Button title={isWorld ? `Create the world with ${chosen.length - 1} entries` : chosen.every((d) => d.existing) ? `Apply ${chosen.length} ${chosen.length === 1 ? 'change' : 'changes'}` : `Add and apply ${chosen.length}`} icon="checkmark" loading={busy} disabled={!chosen.length || (isWorld && !chosen.some((d) => d.kind === 'world'))} onPress={() => void accept(chosen.map((d) => d.id))} />
          <Button kind="ghost" title={`Dismiss ${undecided.length === 1 ? 'it' : 'the rest'}`} onPress={() => void useJobs.getState().dismissAll(db, job.id)} />
        </>
      ) : onDone ? <Button title="Done" onPress={onDone} /> : null}
    </View>
  );
}

/** A job opened from the inbox. */
export function ProposalSheet({ jobId, onClose, onAccepted }: { jobId: string | null; onClose: () => void; onAccepted?: () => void }) {
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));
  return (
    <Sheet open={!!jobId && !!job} onClose={onClose} title={job?.title} full>
      {job ? <ProposalReview key={job.id} job={job} onDone={onClose} onAccepted={() => onAccepted?.()} /> : null}
    </Sheet>
  );
}

const KIND_LABEL: Record<Job['kind'], string> = { forge: 'Forge', reforge: 'Reforge', bible: 'Style bible', workshop: 'Workshop', question: 'Question', inspire: 'Inspiration', voice: 'Voice', hear: 'Voice test', map: 'Map' };

/** A world's inbox: what is being written, and what waits on a decision. */
export function InboxList({ jobs, onOpen, empty }: { jobs: Job[]; onOpen: (id: string) => void; empty?: string }) {
  const t = useTheme();
  const live = useJobs((s) => s.live);
  const shown = jobs.filter((j) => j.kind !== 'question' && (j.status !== 'done' || proposalCount(j) > 0) && j.status !== 'cancelled');
  if (!shown.length) return empty ? <T v="faint">{empty}</T> : null;
  return (
    <View style={{ gap: 8 }}>
      {shown.map((j) => (
        <Pressable key={j.id} onPress={() => onOpen(j.id)} style={({ pressed }) => ({ gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: proposalCount(j) ? t.accent : t.border, opacity: pressed ? 0.75 : 1 })}>
          <Row between><T numberOfLines={1} style={{ flex: 1 }}>{j.title}</T><Badge label={KIND_LABEL[j.kind]} /></Row>
          <JobStatusLine job={j} live={live[j.id]} />
        </Pressable>
      ))}
    </View>
  );
}
