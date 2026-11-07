import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import { KIND_NOUN, hooks, knowledge, libraryDrafts, normName, type Draft, type LibKind, type Library, type Plan } from '@/core/world/drafts';
import { forgeNoun, forgePrompt, type ForgeKind } from '@/core/world/forge';
import { listUniverses } from '@/db/repo/library';
import { useSettings } from '@/state/settings';
import { useJobs } from '@/state/jobs';
import { loadLibrary, rowDraft } from '@/state/library';
import { Banner, Button, Card, Chip, Field, Row, Sheet, Stepper, T } from './index';
import { ModelPicker } from './ModelPicker';
import { ProposalReview } from './Proposals';
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
  const [err, setErr] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));

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

  /** Write the request down as a job; it runs in the background and its results wait in the world's inbox. */
  async function generate(surprise = false) {
    if (!apiKey) return setErr('Add your OpenRouter key in Settings first.');
    if (needsWorld && !uId) return setErr('Pick the world these belong to.');
    setErr(null);
    const n = kindSel === 'world' ? 1 : count;
    const focus = anchorDraft ?? (canon ? { name: canon.name, kind: canon.kind } : null);
    const extra = [wish, canon?.excerpts.join(' ') ?? ''].join(' ');
    const messages = forgePrompt(kindSel, { wish, count: n, knowledge: knowledge(pool, focus, extra), anchor: anchorDraft ?? undefined, surprise: surprise ? { hooks: hooks(pool) } : undefined, lookalike: people ? lookalike : undefined, canon: canon ?? undefined });
    // Generous: a cap costs nothing unused, thinking models spend part of it, and a cut-off reply is continued anyway.
    const maxTokens = kindSel === 'world' ? 24000 : kindSel === 'mixed' ? 6000 + 2500 * n : 4000 + 2000 * n;
    const what = canon ? `Canonize ${canon.name}` : anchorDraft ? `${under?.find((u) => u.kind === kindSel)?.label ?? 'Entries'} for ${anchorDraft.name}` : surprise ? `Surprise: ${n} ${forgeNoun(kindSel, n)}` : wish.trim() ? `${n} ${forgeNoun(kindSel, n)}: ${wish.trim()}` : `${n} ${forgeNoun(kindSel, n)}`;
    const j = await useJobs.getState().enqueue(db, 'forge', {
      universeId: kindSel === 'world' ? null : uId, title: what.length > 80 ? `${what.slice(0, 78)}…` : what,
      input: { kind: kindSel, model, messages, maxTokens, lookalike: people ? lookalike : undefined, anchor: anchorDraft ? { kind: anchorDraft.kind, name: anchorDraft.name } : null, canon: canon?.name ?? null, taken: pool.map((d) => `${d.kind}:${normName(d.name)}`) },
    });
    setJobId(j.id);
  }

  if (job) {
    return (
      <>
        <ProposalReview job={job} onDone={onClose} onAccepted={(notes) => onSaved({ universe: null, entities: [], characters: [], species: [], lore: [], links: [], notes }, [])} />
        {job.status === 'done' || job.status === 'failed' || job.status === 'cancelled' ? <Button kind="ghost" title="Back to the wish" onPress={() => setJobId(null)} /> : <Button kind="ghost" title="Close: it keeps going" onPress={onClose} />}
      </>
    );
  }

  return (
    <>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
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
        <Button title="Generate" icon="sparkles-outline" onPress={() => void generate(false)} disabled={!apiKey} style={{ flex: 1 }} />
        {!canon ? <Button kind="outline" icon="shuffle-outline" title="Surprise me" onPress={() => void generate(true)} disabled={!apiKey} /> : null}
      </Row>
      <T v="faint">{kindSel === 'world' ? 'A world comes with its description, genre, rules, style bible and calendar, nested places, factions, lore and, where it calls for them, peoples.' : `The model reads the world first: every name in it, and in full the entries that bear on this. New entries link to old ones by name, and old entries that already mention them get linked back when you add them. Surprise me grows the world from its loose threads${pool.length ? '' : ' (there are none yet)'}.`} It runs in the background: close this and the results wait in the world’s inbox.</T>
      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setModel} current={model} title="Forge with" />
    </>
  );
}

export { forgeNoun };
