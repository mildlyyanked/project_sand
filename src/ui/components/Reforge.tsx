import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { fieldDef, knowledge, libraryDrafts, type Draft, type Library } from '@/core/world/drafts';
import { fieldForgePrompt, parseFieldValue } from '@/core/world/forge';
import { useSettings } from '@/state/settings';
import { complete } from '@/state/paint';
import { runInForeground } from '@/state/foreground';
import { applyDraftEdit, loadLibrary, namesByKind, rowDraft, type LibraryRow } from '@/state/library';
import { Banner, Button, Card, Field, Row, Sheet, T } from './index';
import { ModelPicker } from './ModelPicker';
import { shortModel } from '../format';

export interface ReforgeTarget {
  draft: Draft;
  key: string;
  /** The rest of the world, as drafts: read for context and for names to pick from. */
  pool: Draft[];
  apply: (value: unknown) => void | Promise<void>;
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v == null || v === '' ? '' : String(v));

/** Rewrite one field of an entry with the writer model, given the entry and what in the world bears on it. */
export function ReforgeSheet({ target, onClose }: { target: ReforgeTarget | null; onClose: () => void }) {
  const def = target ? fieldDef(target.draft.kind, target.key) : undefined;
  return (
    <Sheet open={!!target} onClose={onClose} title={def ? `Reforge ${def.label.toLowerCase()}` : 'Reforge'} full>
      {target && def ? <ReforgeBody key={`${target.draft.id}:${target.key}`} target={target} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ReforgeBody({ target, onClose }: { target: ReforgeTarget; onClose: () => void }) {
  const { defaults, apiKey } = useSettings();
  const def = fieldDef(target.draft.kind, target.key)!;
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState(defaults.models.writer);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  const current = target.key === 'name' ? target.draft.name : target.draft.fields[target.key];
  const pool = target.pool.filter((d) => d.id !== target.draft.id);
  const options = def.type === 'ref' && def.ref ? namesByKind(pool)[def.ref].filter((n) => n !== target.draft.name) : [];

  async function run() {
    setBusy(true); setErr(null); setResult(undefined);
    try {
      const messages = fieldForgePrompt({ draft: target.draft, key: target.key, instruction, knowledge: knowledge(pool, target.draft, instruction, 7000), options });
      const { text } = await runInForeground('Reforging a field', () => complete({ model, messages, maxTokens: def.type === 'long' || def.type === 'lines' ? 900 : 300, temperature: 0.85 }));
      const v = parseFieldValue(def, text, options);
      if (v === null) throw new Error(`The answer did not fit the field: “${text.trim().slice(0, 140)}”. Try again or say more in the instruction.`);
      setResult(v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    await target.apply(result);
    onClose();
  }

  return (
    <>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      <T v="faint">{target.draft.name}{show(current) ? '' : ' · empty so far'}</T>
      {show(current) ? <Card><T v="dim" numberOfLines={8}>{show(current)}</T></Card> : null}
      <Field value={instruction} onChangeText={setInstruction} placeholder={def.type === 'ref' ? 'Optional: who or what, and why' : 'Optional: what to change. Empty makes it richer and more particular.'} multiline style={{ minHeight: 60 }} />
      {def.type === 'ref' ? <T v="faint">Picks from: {options.length ? options.join(', ') : 'nothing yet in this world'}</T> : null}
      <Row between>
        <T v="faint">Written by {shortModel(model)}</T>
        <Button small kind="ghost" icon="hardware-chip-outline" title="Change" onPress={() => setPicker(true)} />
      </Row>
      {result !== undefined ? (
        <>
          <Card style={{ gap: 6 }}>
            <T v="label">New {def.label.toLowerCase()}</T>
            <T>{show(result) || '(none)'}</T>
          </Card>
          <Row>
            <Button title="Use this" icon="checkmark" onPress={use} style={{ flex: 1 }} />
            <Button kind="outline" icon="refresh-outline" title="Again" onPress={run} loading={busy} />
          </Row>
        </>
      ) : (
        <Button title="Reforge" icon="sparkles-outline" onPress={run} loading={busy} disabled={!apiKey} />
      )}
      <ModelPicker open={picker} onClose={() => setPicker(false)} onSelect={setModel} current={model} title="Reforge with" />
    </>
  );
}

/**
 * Reforge for an editor of an existing entry: open(key) reads the world, shows
 * the sheet, and on "Use this" applies the field through the same planning as
 * Forge, so links on other entries follow.
 */
export function useEntryReforge(o: { db: SQLiteDatabase; universeId: string | null | undefined; row: () => LibraryRow | null; onSelf: (row: unknown) => void }) {
  const [target, setTarget] = useState<ReforgeTarget | null>(null);
  const { db, universeId, row, onSelf } = o;
  const open = useCallback(async (key: string) => {
    const r = row();
    if (!r) return;
    const lib: Library = await loadLibrary(db, universeId ?? null);
    const draft = rowDraft(r, lib);
    setTarget({
      draft,
      key,
      pool: libraryDrafts(lib),
      apply: async (value) => {
        const edited: Draft = key === 'name' ? { ...draft, name: String(value) } : { ...draft, fields: { ...draft.fields, [key]: value } };
        const res = await applyDraftEdit(db, edited, universeId ?? null, lib);
        if (res.self) onSelf(res.self);
        if (res.notes.length) Alert.alert('Also linked', res.notes.join('\n'));
      },
    });
  }, [db, universeId, row, onSelf]);
  return { open, sheet: <ReforgeSheet target={target} onClose={() => setTarget(null)} /> };
}
