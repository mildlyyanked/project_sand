import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Universe } from '@/core/types';
import type { WorldEntity } from '@/core/world/types';
import type { BibleOutput } from '@/core/jobs';
import { BIBLE_FIELDS, bibleOf, type ArtBible } from '@/core/world/schema';
import { characterDraft, entityDraft, type LibKind } from '@/core/world/drafts';
import { DEFAULT_ART_STYLE, DEFAULT_SIGIL_STYLE, biblePrompt, composePicture, entryImagePrompt } from '@/core/world/forge';
import { worldLine } from '@/core/world/lines';
import { imageOf } from '@/core/world/portraits';
import { newId, now } from '@/core/ids';
import { saveCharacter } from '@/db/repo/library';
import { saveEntity } from '@/db/repo/world';
import { useSettings } from '@/state/settings';
import { useJobs } from '@/state/jobs';
import { complete, paint, paintReady } from '@/state/paint';
import { removeImage, saveImage } from '@/state/images';
import { runInForeground } from '@/state/foreground';
import { Banner, Button, Card, Chip, Field, Row, T } from './index';
import { JobStatusLine } from './JobStatus';
import { radius, useTheme } from '../theme';

type Subject = { kind: LibKind; id: string; name: string; row: Character | WorldEntity };

/**
 * A style bible: the look every picture of a world shares, and how each kind
 * of picture is framed within it, edited as one. The helper can write the
 * whole bible or any one line, in the background; what it writes is
 * proposed, not applied. Try it on an entry to judge it against the
 * pictures already there. Never sent to the writer.
 */
export function StyleBible({ value, onChange, universe, people = [], entities = [], fallback }: { value: Partial<ArtBible>; onChange: (b: Partial<ArtBible>) => void; universe?: Universe | null; people?: Character[]; entities?: WorldEntity[]; fallback?: Partial<ArtBible> }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { defaults, apiKey } = useSettings();
  const [wish, setWish] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));
  const live = useJobs((s) => (jobId ? s.live[jobId] : undefined));
  const [pick, setPick] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ who: Subject; uri: string; prompt: string; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = paintReady();
  const effective = bibleOf(value, fallback ?? defaults.art);
  const subjects: Subject[] = [
    ...people.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, row: c })),
    ...entities.filter((e) => e.kind !== 'item' || e.data.rarity).slice(0, 40).map((e) => ({ kind: e.kind, id: e.id, name: e.name, row: e })),
  ];
  const gallery = subjects.filter((s) => imageOf(s.row.data as Record<string, unknown>)).slice(0, 24);
  const proposal = job?.status === 'done' && !job.decisions.all ? (job.output as BibleOutput).bible : null;

  async function write(only?: keyof ArtBible) {
    setErr(null);
    const looks = people.map((c) => c.data.appearance?.trim()).filter((x): x is string => !!x);
    const messages = biblePrompt({ world: universe ? `World: ${worldLine(universe, { long: true })}` : 'No particular world: a default look for worlds that set none of their own.', current: value, people: looks, wish, only });
    const j = await useJobs.getState().enqueue(db, 'bible', { universeId: universe?.id ?? null, title: `${only ? BIBLE_FIELDS.find((f) => f.key === only)!.label : 'Style bible'} for ${universe?.name ?? 'every world'}`, input: { model: defaults.models.helper, messages, only, maxTokens: only ? 1200 : 3000 } });
    setJobId(j.id);
  }

  async function use() {
    if (!job || !proposal) return;
    onChange({ ...value, ...proposal });
    await useJobs.getState().decide(db, job.id, 'all', 'accepted');
  }

  async function tryOn(s: Subject) {
    setBusy(true); setErr(null);
    try {
      const lib = { universe: universe ?? null, entities, characters: people, species: [], lore: [] };
      const draft = s.kind === 'character' ? characterDraft(s.row as Character, lib) : entityDraft(s.row as WorldEntity, lib);
      const { text } = await complete({ model: defaults.models.helper, messages: entryImagePrompt({ draft, world: worldLine(universe) }), maxTokens: 2000, temperature: 0.7, spend: { db, note: `style test: ${s.name}` } });
      const prompt = composePicture(s.kind, text.trim() || s.name, effective);
      const out = await runInForeground(`Painting ${s.name}`, () => paint(prompt, { zdr: defaults.zdr, spend: { db, note: `style test: ${s.name}` } }));
      if (trial) await removeImage(trial.uri);
      setTrial({ who: s, uri: await saveImage(newId(), out.dataUrl), prompt, model: out.model });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!trial) return;
    const old = imageOf(trial.who.row.data as Record<string, unknown>);
    if (old) await removeImage(old.uri);
    const image = { uri: trial.uri, prompt: trial.prompt, model: trial.model, at: now() };
    if (trial.who.kind === 'character') await saveCharacter(db, { ...(trial.who.row as Character), data: { ...(trial.who.row as Character).data, image } as Character['data'] });
    else await saveEntity(db, { ...(trial.who.row as WorldEntity), data: { ...(trial.who.row as WorldEntity).data, image } });
    setTrial(null);
  }

  const placeholder = (k: keyof ArtBible) => {
    const f = (fallback ?? defaults.art)?.[k]?.trim();
    if (f) return `From the app's bible: ${f.slice(0, 90)}${f.length > 90 ? '…' : ''}`;
    return k === 'look' ? DEFAULT_ART_STYLE : k === 'sigils' ? DEFAULT_SIGIL_STYLE : 'Empty: the default framing for the kind';
  };

  return (
    <View style={{ gap: 12 }}>
      <T v="faint">{universe ? 'Every picture of this world starts from the look; portraits, places and things are framed by their line; sigils follow their own. ' : 'For worlds whose own bible leaves a line empty. '}Never sent to the writer.</T>
      {gallery.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {gallery.map((s) => <Image key={s.id} source={{ uri: imageOf(s.row.data as Record<string, unknown>)!.uri }} style={{ width: 64, height: 64, borderRadius: s.kind === 'character' ? 32 : radius.sm, backgroundColor: t.surface2 }} />)}
        </ScrollView>
      ) : null}
      {BIBLE_FIELDS.map((f) => <Field key={f.key} label={f.label} hint={f.hint} value={value[f.key] ?? ''} onChangeText={(v) => onChange({ ...value, [f.key]: v })} multiline placeholder={placeholder(f.key)} onForge={apiKey ? () => void write(f.key) : undefined} />)}
      <Field label="What you want, optional" value={wish} onChangeText={setWish} placeholder="e.g. moodier, more painterly, closer crops, like old travel posters" />
      <Button small icon="sparkles-outline" title={BIBLE_FIELDS.some((f) => value[f.key]?.trim()) ? 'Refine the bible' : 'Write the bible'} disabled={!apiKey || job?.status === 'running' || job?.status === 'queued'} onPress={() => void write()} />
      {job ? <JobStatusLine job={job} live={live} compact /> : null}
      {job?.status === 'failed' ? <Banner text={job.error ?? 'It failed.'} /> : null}
      {proposal ? (
        <Card style={{ gap: 8 }}>
          <T v="label">Proposed</T>
          {BIBLE_FIELDS.filter((f) => proposal[f.key]).map((f) => <View key={f.key} style={{ gap: 2 }}><T v="small">{f.label}</T><T>{proposal[f.key]}</T></View>)}
          <Row>
            <Button small icon="checkmark" title="Use it" onPress={() => void use()} style={{ flex: 1 }} />
            <Button small kind="ghost" title="Dismiss" onPress={() => job && void useJobs.getState().decide(db, job.id, 'all', 'dismissed')} />
          </Row>
        </Card>
      ) : null}
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {subjects.length ? (
        <View style={{ gap: 6 }}>
          <T v="label">Try it on</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {subjects.slice(0, 30).map((s) => <Chip key={s.id} small label={s.name} selected={pick === s.id} onPress={() => setPick(pick === s.id ? null : s.id)} />)}
          </ScrollView>
          {pick ? <Button small kind="outline" icon="color-palette-outline" title={ready.ok ? 'Paint a test with this bible' : 'Painting is not set up'} loading={busy} disabled={busy || !ready.ok} onPress={() => { const s = subjects.find((x) => x.id === pick); if (s) void tryOn(s); }} /> : null}
          {!ready.ok ? <T v="faint">{ready.why}</T> : <T v="faint">Paints with the bible as it stands in this edit, saved or not.</T>}
        </View>
      ) : null}
      {trial ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Image source={{ uri: trial.uri }} style={{ width: 220, height: 220, borderRadius: radius.md, backgroundColor: t.surface2 }} />
          <T v="small">{trial.who.name} · {trial.model}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small icon="checkmark" title={`Keep as ${trial.who.name.split(' ')[0]}’s picture`} onPress={() => void keep()} />
            <Button small kind="ghost" title="Discard" onPress={async () => { await removeImage(trial.uri); setTrial(null); }} />
          </Row>
        </View>
      ) : null}
    </View>
  );
}
