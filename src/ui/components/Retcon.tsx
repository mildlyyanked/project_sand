import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { fieldDef, knowledge, libraryDrafts, planDrafts, type Draft, type Library } from '@/core/world/drafts';
import { affected, applyEdits, mergeEdits, parseRetcon, renameEdits, retconPrompt, type RetconEdit } from '@/core/world/retcon';
import { renameInEvents } from '@/db/repo/world';
import { useSettings } from '@/state/settings';
import { complete } from '@/state/paint';
import { runInForeground } from '@/state/foreground';
import { loadLibrary, rowDraft, savePlan, type LibraryRow } from '@/state/library';
import { Banner, Button, Card, Field, Ionicons, Row, Sheet, T } from './index';
import { useTheme } from '../theme';

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v == null || v === '' ? '—' : String(v));

/**
 * Retcon an entry: rename it and/or say what is now true. The rename is
 * carried through every mention and reference in the world (and the
 * timelines); the change is worked through the entries it touches by the
 * writer model. Every edit is shown before anything is saved.
 */
export function RetconSheet({ open, onClose, universeId, row, onSelf }: { open: boolean; onClose: () => void; universeId: string | null | undefined; row: () => LibraryRow | null; onSelf: (row: unknown) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Retcon" full>
      {open ? <RetconBody onClose={onClose} universeId={universeId ?? null} row={row} onSelf={onSelf} /> : null}
    </Sheet>
  );
}

function RetconBody({ onClose, universeId, row, onSelf }: { onClose: () => void; universeId: string | null; row: () => LibraryRow | null; onSelf: (row: unknown) => void }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const { defaults, apiKey } = useSettings();
  const [ctx, setCtx] = useState<{ lib: Library; pool: Draft[]; target: Draft } | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edits, setEdits] = useState<RetconEdit[] | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<string | null>(null);

  React.useEffect(() => {
    const r = row();
    if (!r) return;
    void loadLibrary(db, universeId).then((lib) => {
      const target = rowDraft(r, lib);
      // The editor's unsaved state is the truth for the target.
      const pool = libraryDrafts(lib).map((d) => (d.id === target.id ? target : d));
      setCtx({ lib, pool, target });
      setRename(target.name);
    });
  }, [db, universeId, row]);

  if (!ctx) return <T v="faint">Reading the world…</T>;
  const { lib, pool, target } = ctx;
  const to = (rename ?? target.name).trim();

  async function work() {
    setBusy(true); setErr(null); setEdits(null); setOff(new Set());
    try {
      const mech = renameEdits(pool, target, to);
      let model: RetconEdit[] = [];
      if (change.trim()) {
        if (!apiKey) throw new Error('Add your OpenRouter key in Settings first.');
        const touched = affected(pool, target, change);
        const messages = retconPrompt({ target, change, renameTo: to, affected: touched, knowledge: knowledge(pool.filter((d) => d.id !== target.id), target, change, 5000) });
        const { text } = await runInForeground('Working through the retcon', () => complete({ model: defaults.models.writer, messages, maxTokens: 3000, temperature: 0.4, spend: { db, note: `retcon ${target.name}` } }));
        model = parseRetcon(text, pool);
        if (!model.length && !mech.length) throw new Error(text.trim() ? 'The model found nothing in the world that needs to change for this.' : 'The model returned nothing. Try again or another writer model.');
      }
      const all = mergeEdits(mech, model);
      if (!all.length) throw new Error(to !== target.name ? 'Nothing else in the world names it.' : 'Say what changes, or give it a new name.');
      setEdits(all);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!edits) return;
    setBusy(true);
    try {
      const chosen = edits.filter((_, i) => !off.has(i));
      const changed = applyEdits(pool, chosen);
      const plan = planDrafts(changed, lib, universeId);
      // The editor holds the target; everything else is saved here.
      const self = plan.universe?.id === target.id ? plan.universe : [...plan.entities, ...plan.characters, ...plan.species, ...plan.lore].find((x) => x.id === target.id);
      await savePlan(db, { ...plan, universe: plan.universe?.id === target.id ? null : plan.universe, entities: plan.entities.filter((x) => x.id !== target.id), characters: plan.characters.filter((x) => x.id !== target.id), species: plan.species.filter((x) => x.id !== target.id), lore: plan.lore.filter((x) => x.id !== target.id) });
      const renamed = chosen.some((e) => e.id === target.id && e.key === 'name');
      const events = renamed && universeId ? await renameInEvents(db, universeId, target.name, to) : 0;
      if (self) onSelf(self);
      const entries = new Set(chosen.map((e) => e.id)).size;
      setDone(`${chosen.length} change${chosen.length === 1 ? '' : 's'} across ${entries} entr${entries === 1 ? 'y' : 'ies'}${events ? `, and ${events} timeline event${events === 1 ? '' : 's'}` : ''}.${plan.notes.length ? ` Also linked: ${plan.notes.join('; ')}.` : ''}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <T v="h">Retconned</T>
        <T v="dim">{done}</T>
        <T v="faint">Stories already written keep their words; from here on the writer reads the world as it now stands.</T>
        <Button title="Done" onPress={onClose} />
      </>
    );
  }

  const groups = edits ? [...new Set(edits.map((e) => e.id))].map((id) => ({ id, items: edits.map((e, i) => ({ e, i })).filter((x) => x.e.id === id) })) : [];
  return (
    <>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {!edits ? (
        <>
          <T v="faint">Change the truth about {target.name} and carry it through the world. A new name replaces every mention and reference, here and in the timelines. A change in words goes to the writer model with every entry it touches; you see each edit before anything is saved.</T>
          <Field label="Name" value={rename ?? ''} onChangeText={setRename} />
          <Field label="What changes" value={change} onChangeText={setChange} multiline style={{ minHeight: 100 }} placeholder={`e.g. ${target.kind === 'character' ? 'She was never a guild member; she founded the rival Ash Collective and leads it from the docks.' : target.kind === 'organization' ? 'The guild was dissolved ten years ago; its halls belong to the crown now.' : target.kind === 'location' ? 'The city burned in the war and was rebuilt upriver.' : 'What is now true.'}`} />
          <Button title={change.trim() ? 'Work it through' : 'Find every mention'} icon="git-compare-outline" onPress={work} loading={busy} disabled={!to || (to === target.name && !change.trim())} />
        </>
      ) : (
        <>
          <T v="faint">Untick anything to leave as it is.</T>
          {groups.map((g) => (
            <Card key={g.id} style={{ gap: 8 }}>
              <T v="h">{g.items[0]!.e.name}</T>
              {g.items.map(({ e, i }) => (
                <Pressable key={i} onPress={() => setOff((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} style={{ flexDirection: 'row', gap: 8, opacity: off.has(i) ? 0.45 : 1 }}>
                  <Ionicons name={off.has(i) ? 'square-outline' : 'checkbox'} size={18} color={t.accent} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="label">{fieldDef(e.kind, e.key)?.label ?? e.key}{e.why ? ` · ${e.why}` : ''}</T>
                    <T v="faint" numberOfLines={3} style={{ textDecorationLine: 'line-through' }}>{show(e.before)}</T>
                    <T numberOfLines={6}>{show(e.after)}</T>
                  </View>
                </Pressable>
              ))}
            </Card>
          ))}
          <Row>
            <Button title={`Apply ${edits.length - off.size}`} icon="checkmark" onPress={apply} loading={busy} disabled={edits.length === off.size} style={{ flex: 1 }} />
            <Button kind="outline" title="Back" onPress={() => setEdits(null)} />
          </Row>
        </>
      )}
    </>
  );
}
