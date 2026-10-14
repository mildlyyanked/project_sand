import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import { DRAFT_FIELDS, KIND_NOUN, hooks, knowledge, libraryDrafts, normName, type Draft, type LibKind, type Library, type Plan } from '@/core/world/drafts';
import { ensureAnchor, forgeNoun, forgePrompt, parseForgeDrafts, type ForgeKind } from '@/core/world/forge';
import { listUniverses } from '@/db/repo/library';
import { useSettings } from '@/state/settings';
import { complete } from '@/state/paint';
import { runInForeground } from '@/state/foreground';
import { loadLibrary, namesByKind, rowDraft, saveDrafts } from '@/state/library';
import { Badge, Banner, Button, Card, Chip, Field, FieldLabel, IconButton, Row, Sheet, Stepper, T } from './index';
import { ModelPicker } from './ModelPicker';
import { FieldEditor } from './World';
import { ReforgeSheet, type ReforgeTarget } from './Reforge';
import { shortModel } from '../format';

export type { ForgeKind };

const LABEL: Record<ForgeKind, { title: string; placeholder: string }> = {
  world: { title: 'Forge a world', placeholder: 'e.g. A drowned city-state run by salvage guilds; tide law; something living in the deep cisterns' },
  species: { title: 'Forge peoples', placeholder: 'e.g. A sea-born people who moult once a decade; a parasite that confers rank' },
  lore: { title: 'Forge lore', placeholder: 'e.g. How the guild courts work; the night market; what the bells mean' },
  character: { title: 'Forge characters', placeholder: 'e.g. A disgraced tide-judge and the smuggler who owns her debt' },
  location: { title: 'Forge places', placeholder: 'e.g. The undercity beneath the cathedral: three levels, each worse' },
  organization: { title: 'Forge factions', placeholder: 'e.g. A smugglers’ union posing as a burial society' },
  item: { title: 'Forge things', placeholder: 'e.g. Rations and medicine a scavenger would find; one cursed heirloom' },
  mixed: { title: 'Grow the world', placeholder: 'Optional: a direction, e.g. more about the war in the north' },
};

/** What can be forged under an entry of each kind, and what to call it. */
const UNDER: Record<LibKind, { kind: ForgeKind; label: string }[]> = {
  location: [{ kind: 'location', label: 'Places inside' }, { kind: 'character', label: 'Characters here' }, { kind: 'organization', label: 'Factions here' }, { kind: 'item', label: 'Things here' }, { kind: 'lore', label: 'Lore' }, { kind: 'mixed', label: 'Anything' }],
  organization: [{ kind: 'character', label: 'Members' }, { kind: 'organization', label: 'Branches' }, { kind: 'location', label: 'Places it holds' }, { kind: 'item', label: 'Things it owns' }, { kind: 'lore', label: 'Lore' }, { kind: 'mixed', label: 'Anything' }],
  character: [{ kind: 'character', label: 'People in their life' }, { kind: 'item', label: 'Belongings' }, { kind: 'location', label: 'Places in their life' }, { kind: 'organization', label: 'Groups tied to them' }, { kind: 'lore', label: 'Lore' }],
  item: [{ kind: 'character', label: 'People tied to it' }, { kind: 'location', label: 'Places tied to it' }, { kind: 'lore', label: 'Lore' }],
  species: [{ kind: 'character', label: 'Members' }, { kind: 'location', label: 'Places of theirs' }, { kind: 'lore', label: 'Lore' }],
  lore: [{ kind: 'lore', label: 'Related lore' }, { kind: 'character', label: 'Characters' }, { kind: 'location', label: 'Places' }],
  world: [{ kind: 'mixed', label: 'Anything' }],
};

export interface ForgeSheetProps {
  open: boolean;
  onClose: () => void;
  kind: ForgeKind;
  universeId?: string | null;
  /** Forge under this entry: new entries tie to it. */
  anchor?: { kind: LibKind; id: string } | null;
  /** Canonize a name from a story: one entry, true to what the story says. */
  canon?: { name: string; kind: 'character' | 'location' | 'organization' | 'item'; excerpts: string[] } | null;
  onSaved: (plan: Plan, drafts: Draft[]) => void;
}

/**
 * Invent library entries with the writer model: a wish (or a surprise), the
 * world's own entries as context, a preview where every entry can be opened
 * and any field reforged, then a save that links new entries to old ones.
 */
export function ForgeSheet(props: ForgeSheetProps) {
  // The body mounts fresh on every open, so its state starts clean without resetting in an effect.
  const title = props.canon ? `Canonize ${props.canon.name}` : props.anchor ? 'Forge under this' : LABEL[props.kind].title;
  return (
    <Sheet open={props.open} onClose={props.onClose} title={title} full>
      {props.open ? <ForgeBody {...props} /> : null}
    </Sheet>
  );
}

const subtitleOf = (d: Draft) => {
  const f = d.fields;
  const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '');
  return [s('type'), s('lifeStage'), s('occupation'), s('summary') || s('description') || s('text') || s('adulthood')].filter(Boolean).join(' · ');
};

function ForgeBody({ onClose, kind, universeId, anchor, canon, onSaved }: ForgeSheetProps) {
  const db = useSQLiteContext();
  const { apiKey, defaults } = useSettings();
  const under = anchor ? UNDER[anchor.kind] : null;
  const [kindSel, setKindSel] = useState<ForgeKind>(canon?.kind ?? under?.[0]?.kind ?? kind);
  const [wish, setWish] = useState('');
  const [lookalike, setLookalike] = useState('');
  const [count, setCount] = useState(canon ? 1 : kind === 'character' ? 2 : 3);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [uId, setUId] = useState<string | null>(universeId ?? null);
  const [lib, setLib] = useState<Library | null>(null);
  const [model, setModel] = useState(defaults.models.writer);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [reforge, setReforge] = useState<ReforgeTarget | null>(null);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void listUniverses(db).then(setUniverses);
  }, [db]);
  useEffect(() => {
    void loadLibrary(db, kindSel === 'world' ? null : uId).then(setLib);
  }, [db, uId, kindSel]);

  const pool = useMemo(() => (lib && kindSel !== 'world' ? libraryDrafts(lib) : []), [lib, kindSel]);
  const anchorDraft = useMemo(() => {
    if (!anchor || !lib) return null;
    const e = lib.entities.find((x) => x.id === anchor.id);
    if (e) return rowDraft({ kind: e.kind, row: e }, lib);
    const c = lib.characters.find((x) => x.id === anchor.id);
    if (c) return rowDraft({ kind: 'character', row: c }, lib);
    const s = lib.species.find((x) => x.id === anchor.id);
    if (s) return rowDraft({ kind: 'species', row: s }, lib);
    const l = lib.lore.find((x) => x.id === anchor.id);
    return l ? rowDraft({ kind: 'lore', row: l }, lib) : null;
  }, [anchor, lib]);

  const needsWorld = kindSel !== 'world' && kindSel !== 'character';
  const people = kindSel === 'character' || kindSel === 'mixed';
  const batchPool = [...pool, ...(drafts ?? [])];

  async function generate(surprise = false) {
    if (!apiKey) return setErr('Add your OpenRouter key in Settings first.');
    if (needsWorld && !uId) return setErr('Pick the world these belong to.');
    setBusy(true); setErr(null); setDrafts(null); setSkip(new Set()); setEditing(null); setProgress(0);
    try {
      const n = kindSel === 'world' ? 1 : count;
      const focus = anchorDraft ?? (canon ? { name: canon.name, kind: canon.kind } : null);
      const extra = [wish, canon?.excerpts.join(' ') ?? ''].join(' ');
      const messages = forgePrompt(kindSel, { wish, count: n, knowledge: knowledge(pool, focus, extra), anchor: anchorDraft ?? undefined, surprise: surprise ? { hooks: hooks(pool) } : undefined, lookalike: people ? lookalike : undefined, canon: canon ?? undefined });
      const maxTokens = kindSel === 'world' ? 9000 : kindSel === 'mixed' ? 1200 + 1000 * n : 1000 + 900 * n;
      const { text, finish } = await runInForeground('Forging library entries', () => complete({ model, messages, maxTokens, onText: setProgress }));
      let r = parseForgeDrafts(kindSel, text, { lookalike: people ? lookalike : undefined });
      if (!r) {
        const flat = text.trim().replace(/\s+/g, ' ');
        const peek = flat.slice(0, 160);
        const tail = flat.length > 320 ? ` It ended: “…${flat.slice(-120)}”` : '';
        if (finish === 'length') throw new Error(`The reply ran out of room before anything usable was complete. Ask for less, or a model that writes more tightly. It began: “${peek}…”`);
        throw new Error(peek ? `The model did not answer with the expected JSON. It began: “${peek}…”${tail} Try again, a clearer wish, or another model.` : 'The model returned nothing. Try again or another model.');
      }
      r = ensureAnchor(r, anchorDraft);
      if (canon) r = r.map((d, i) => (i === 0 ? { ...d, name: canon.name } : d));
      // Never offer a second entry under a name the world already has.
      const taken = new Set(pool.map((d) => `${d.kind}:${normName(d.name)}`));
      r = r.filter((d) => !taken.has(`${d.kind}:${normName(d.name)}`));
      if (!r.length) throw new Error('Everything the model offered already exists in this world. Try again or a different wish.');
      setDrafts(r);
      if (finish === 'length') setErr('The reply ran out of room, so the last entries may be missing or cut short. What arrived whole is below.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!drafts) return;
    setBusy(true);
    try {
      const keep = drafts.filter((d) => !skip.has(d.id));
      const plan = await saveDrafts(db, keep, kindSel === 'world' ? null : uId);
      onSaved(plan, keep);
      if (plan.notes.length) setNotes(plan.notes);
      else onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const updateDraft = (id: string, p: Partial<Draft>) => setDrafts((ds) => (ds ? ds.map((d) => (d.id === id ? { ...d, ...p } : d)) : ds));
  const toggle = (id: string) => setSkip((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const editingDraft = drafts?.find((d) => d.id === editing) ?? null;

  if (notes) {
    return (
      <>
        <T v="h">Saved</T>
        <T v="dim">Older entries were linked to the new ones:</T>
        {notes.map((n, i) => <T key={i}>• {n}</T>)}
        <Button title="Done" onPress={onClose} />
      </>
    );
  }

  return (
    <>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {editingDraft ? (
        <>
          <DraftEditor draft={editingDraft} pool={batchPool} onChange={(p) => updateDraft(editingDraft.id, p)} onReforge={(key) => setReforge({ draft: editingDraft, key, pool: batchPool, apply: (v) => updateDraft(editingDraft.id, key === 'name' ? { name: String(v) } : { fields: { ...editingDraft.fields, [key]: v } }) })} />
          <Button kind="outline" icon="arrow-back" title="Back to the list" onPress={() => setEditing(null)} />
        </>
      ) : !drafts ? (
        <>
          {anchorDraft ? (
            <Card style={{ gap: 6 }}>
              <T v="faint">Under {KIND_NOUN[anchorDraft.kind].toLowerCase()}</T>
              <T v="h">{anchorDraft.name}</T>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {under!.map((u) => <Chip key={u.kind} small label={u.label} selected={kindSel === u.kind} onPress={() => setKindSel(u.kind)} />)}
              </ScrollView>
            </Card>
          ) : null}
          {canon ? <Card style={{ gap: 4 }}><T v="faint">From the story</T>{canon.excerpts.slice(-3).map((x, i) => <T key={i} v="dim" numberOfLines={4}>“{x}”</T>)}</Card> : null}
          <Field value={wish} onChangeText={setWish} placeholder={canon ? `Optional: anything to add about ${canon.name}` : LABEL[kindSel].placeholder} multiline style={{ minHeight: 70 }} />
          {people ? <Field label="Looks like, optional" hint="A real person or a fictional character whose look inspires theirs. The appearance is written from it in the model's own words; the name never reaches the writer or an image model." value={lookalike} onChangeText={setLookalike} placeholder="e.g. Tilda Swinton, or Aragorn" /> : null}
          {kindSel !== 'world' && !anchor && !canon ? (
            <View style={{ gap: 6 }}>
              <T v="label">{needsWorld ? 'World' : 'World, optional'}</T>
              <Row style={{ flexWrap: 'wrap' }}>
                {!needsWorld ? <Chip label="None" selected={!uId} onPress={() => setUId(null)} /> : null}
                {universes.map((u) => <Chip key={u.id} label={u.name} selected={uId === u.id} onPress={() => setUId(u.id)} />)}
              </Row>
            </View>
          ) : null}
          {kindSel !== 'world' && !canon ? <Row between><T>How many</T><Stepper value={count} min={1} max={kindSel === 'mixed' ? 8 : 6} onChange={setCount} /></Row> : null}
          <Row between>
            <T v="faint">Written by {shortModel(model)}</T>
            <Button small kind="ghost" icon="hardware-chip-outline" title="Change" onPress={() => setPickerOpen(true)} />
          </Row>
          <Row>
            <Button title={busy ? `Writing… ${progress > 0 ? `${Math.round(progress / 4)} tokens` : ''}` : 'Generate'} icon="sparkles-outline" onPress={() => generate(false)} loading={busy} disabled={!apiKey} style={{ flex: 1 }} />
            {!canon ? <Button kind="outline" icon="shuffle-outline" title="Surprise me" onPress={() => generate(true)} disabled={busy || !apiKey} /> : null}
          </Row>
          <T v="faint">{kindSel === 'world' ? 'A world comes with its description, genre, rules and calendar, nested places, factions, lore and, where it calls for them, peoples.' : `The model reads the world first: every name in it, and in full the entries that bear on this. New entries link to old ones by name, and old entries that already mention them get linked back when you save. Surprise me grows the world from its loose threads${pool.length ? '' : ' (there are none yet)'}.`}</T>
        </>
      ) : (
        <>
          <T v="faint">Tap an entry to open it: every field can be edited or reforged before saving. Tick off what you do not want.</T>
          {drafts.map((d) => (
            <Card key={d.id} onPress={() => setEditing(d.id)} style={{ gap: 4, opacity: skip.has(d.id) ? 0.45 : 1 }}>
              <Row between>
                <IconButton name={skip.has(d.id) ? 'square-outline' : 'checkbox'} size={20} onPress={() => toggle(d.id)} />
                <T v="h" style={{ flex: 1 }} numberOfLines={1}>{d.name}</T>
                {d.kind !== kindSel ? <Badge label={KIND_NOUN[d.kind].toLowerCase()} tone="dim" /> : null}
                {d.kind === 'character' && d.fields.adult === false ? <Badge label="not adult" tone="warn" /> : null}
              </Row>
              <T v="dim" numberOfLines={4}>{subtitleOf(d)}</T>
              <LinkLine d={d} />
            </Card>
          ))}
          <Row>
            <Button title={`Save ${drafts.length - skip.size} to library`} icon="checkmark" onPress={save} loading={busy} disabled={drafts.length === skip.size} style={{ flex: 1 }} />
            <Button kind="outline" icon="refresh-outline" title="Again" onPress={() => generate(false)} loading={busy} />
          </Row>
          <Button kind="ghost" title="Back to the wish" onPress={() => setDrafts(null)} />
        </>
      )}
      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setModel} current={model} title="Forge with" />
      <ReforgeSheet target={reforge} onClose={() => setReforge(null)} />
    </>
  );
}

/** The links a draft will make, in one faint line. */
function LinkLine({ d }: { d: Draft }) {
  const parts = DRAFT_FIELDS[d.kind].filter((f) => f.type === 'ref' && typeof d.fields[f.key] === 'string' && (d.fields[f.key] as string).trim()).map((f) => `${f.label.toLowerCase()} ${d.fields[f.key] as string}`);
  return parts.length ? <T v="faint" numberOfLines={2}>{parts.join(' · ')}</T> : null;
}

/** Every field of a draft, editable, each with a sparkle to reforge it alone. References are by name. */
export function DraftEditor({ draft, pool, onChange, onReforge }: { draft: Draft; pool: Draft[]; onChange: (p: Partial<Draft>) => void; onReforge: (key: string) => void }) {
  const names = namesByKind(pool.filter((d) => d.id !== draft.id));
  return (
    <View style={{ gap: 14 }}>
      <T v="faint">{KIND_NOUN[draft.kind]}</T>
      <Field label="Name" value={draft.name} onChangeText={(v) => onChange({ name: v })} onForge={() => onReforge('name')} />
      {DRAFT_FIELDS[draft.kind].map((def) => {
        if (def.type === 'ref' && def.ref) {
          const v = typeof draft.fields[def.key] === 'string' ? (draft.fields[def.key] as string) : '';
          const opts = names[def.ref];
          const all = v && !opts.some((o) => normName(o) === normName(v)) ? [v, ...opts] : opts;
          return (
            <View key={def.key} style={{ gap: 6 }}>
              <FieldLabel label={def.label} onForge={() => onReforge(def.key)} />
              {all.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Chip small label="None" selected={!v} onPress={() => onChange({ fields: { ...draft.fields, [def.key]: '' } })} />
                  {all.map((n) => <Chip key={n} small label={n} selected={normName(v) === normName(n)} onPress={() => onChange({ fields: { ...draft.fields, [def.key]: n } })} />)}
                </ScrollView>
              ) : <T v="faint">Nothing to pick yet.</T>}
            </View>
          );
        }
        return <FieldEditor key={def.key} defs={[def]} data={draft.fields} onChange={(p) => onChange({ fields: { ...draft.fields, ...p } })} onForge={(d) => onReforge(d.key)} />;
      })}
    </View>
  );
}

export { forgeNoun };
