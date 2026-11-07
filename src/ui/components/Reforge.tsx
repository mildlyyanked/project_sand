import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { fieldDef, knowledge, libraryDrafts, planDrafts, type Draft, type Library } from '@/core/world/drafts';
import { fieldForgePrompt } from '@/core/world/forge';
import type { ReforgeOutput } from '@/core/jobs';
import { useSettings } from '@/state/settings';
import { useJobs } from '@/state/jobs';
import { loadLibrary, namesByKind, rowDraft, type LibraryRow } from '@/state/library';
import { Banner, Button, Card, Field, Row, Sheet, T } from './index';
import { ModelPicker } from './ModelPicker';
import { JobStatusLine } from './JobStatus';
import { shortModel } from '../format';

export interface ReforgeTarget {
  draft: Draft;
  key: string;
  /** The rest of the world, as drafts: read for context and for names to pick from. */
  pool: Draft[];
  universeId: string | null;
  apply: (value: unknown) => void | Promise<void>;
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v == null || v === '' ? '' : String(v));

/**
 * Rewrite one field of an entry with the writer model, given the entry and
 * what in the world bears on it. It runs as a background job: close the
 * sheet and the new value waits in the world's inbox.
 */
export function ReforgeSheet({ target, onClose }: { target: ReforgeTarget | null; onClose: () => void }) {
  const def = target ? fieldDef(target.draft.kind, target.key) : undefined;
  return (
    <Sheet open={!!target} onClose={onClose} title={def ? `Reforge ${def.label.toLowerCase()}` : 'Reforge'} full>
      {target && def ? <ReforgeBody key={`${target.draft.id}:${target.key}`} target={target} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ReforgeBody({ target, onClose }: { target: ReforgeTarget; onClose: () => void }) {
  const db = useSQLiteContext();
  const { defaults, apiKey } = useSettings();
  const def = fieldDef(target.draft.kind, target.key)!;
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState(defaults.models.writer);
  const [picker, setPicker] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));
  const live = useJobs((s) => (jobId ? s.live[jobId] : undefined));
  const current = target.key === 'name' ? target.draft.name : target.draft.fields[target.key];
  const pool = target.pool.filter((d) => d.id !== target.draft.id);
  const options = def.type === 'ref' && def.ref ? namesByKind(pool)[def.ref].filter((n) => n !== target.draft.name) : [];
  const result = job?.status === 'done' ? (job.output as ReforgeOutput).value : undefined;
  const busy = job?.status === 'queued' || job?.status === 'running';

  async function run() {
    const messages = fieldForgePrompt({ draft: target.draft, key: target.key, instruction, knowledge: knowledge(pool, target.draft, instruction, 7000), options });
    const j = await useJobs.getState().enqueue(db, 'reforge', {
      universeId: target.universeId, title: `${def.label} of ${target.draft.name}`,
      input: { model, messages, draft: target.draft, key: target.key, def, options, maxTokens: def.type === 'long' || def.type === 'lines' ? 6000 : 4000 },
    });
    setJobId(j.id);
  }

  async function use() {
    if (!job) return;
    await target.apply(result);
    await useJobs.getState().decide(db, job.id, 'all', 'accepted');
    onClose();
  }

  return (
    <>
      <T v="faint">{target.draft.name}{show(current) ? '' : ' · empty so far'}</T>
      {show(current) ? <Card><T v="dim" numberOfLines={8}>{show(current)}</T></Card> : null}
      <Field value={instruction} onChangeText={setInstruction} placeholder={def.type === 'ref' ? 'Optional: who or what, and why' : 'Optional: what to change. Empty makes it richer and more particular.'} multiline style={{ minHeight: 60 }} />
      {def.type === 'ref' ? <T v="faint">Picks from: {options.length ? options.join(', ') : 'nothing yet in this world'}</T> : null}
      <Row between>
        <T v="faint">Written by {shortModel(model)}</T>
        <Button small kind="ghost" icon="hardware-chip-outline" title="Change" onPress={() => setPicker(true)} />
      </Row>
      {job ? <JobStatusLine job={job} live={live} /> : null}
      {job?.status === 'failed' ? <Banner text={job.error ?? 'It failed.'} /> : null}
      {result !== undefined && !job?.decisions.all ? (
        <>
          <Card style={{ gap: 6 }}>
            <T v="label">New {def.label.toLowerCase()}</T>
            <T>{show(result) || '(none)'}</T>
          </Card>
          <Row>
            <Button title="Use this" icon="checkmark" onPress={() => void use()} style={{ flex: 1 }} />
            <Button kind="outline" icon="refresh-outline" title="Again" onPress={() => { if (job) void useJobs.getState().decide(db, job.id, 'all', 'dismissed'); void run(); }} />
          </Row>
        </>
      ) : (
        <Button title={busy ? 'Reforging…' : job?.status === 'failed' ? 'Try again' : 'Reforge'} icon="sparkles-outline" onPress={() => void run()} loading={busy} disabled={!apiKey || busy} />
      )}
      {busy ? <T v="faint">You can close this: the new value will wait in the world’s inbox.</T> : null}
      <View />
      <ModelPicker open={picker} onClose={() => setPicker(false)} onSelect={setModel} current={model} title="Reforge with" />
    </>
  );
}

/**
 * Reforge for an entry page in edit mode: open(key) reads the world with the
 * entry as it is being edited, and "Use this" puts the new value into the
 * edit, planned the same way Forge plans (names resolved to ids), for the
 * person to save or discard with the rest.
 */
export function useEntryReforge(o: { db: SQLiteDatabase; universeId: string | null | undefined; row: () => LibraryRow | null; onSelf: (row: unknown) => void }) {
  const [target, setTarget] = useState<ReforgeTarget | null>(null);
  const { db, universeId, row, onSelf } = o;
  const open = useCallback(async (key: string) => {
    const r = row();
    if (!r) return;
    const loaded: Library = await loadLibrary(db, universeId ?? null);
    // The entry as it is being edited, not as it was saved.
    const swap = <T extends { id: string }>(xs: T[]) => xs.map((x) => (x.id === r.row.id ? (r.row as unknown as T) : x));
    const lib: Library = { ...loaded, entities: swap(loaded.entities), characters: swap(loaded.characters), species: swap(loaded.species), lore: swap(loaded.lore), universe: r.kind === 'world' ? r.row : loaded.universe };
    const draft = rowDraft(r, lib);
    setTarget({
      draft, key, pool: libraryDrafts(lib), universeId: universeId ?? null,
      apply: (value) => {
        const edited: Draft = key === 'name' ? { ...draft, name: String(value) } : { ...draft, fields: { ...draft.fields, [key]: value } };
        const plan = planDrafts([edited], lib, universeId ?? null);
        const self = plan.universe?.id === draft.id ? plan.universe : [...plan.entities, ...plan.characters, ...plan.species, ...plan.lore].find((x) => x.id === draft.id);
        if (self) onSelf(self);
      },
    });
  }, [db, universeId, row, onSelf]);
  return { open, sheet: <ReforgeSheet target={target} onClose={() => setTarget(null)} /> };
}
