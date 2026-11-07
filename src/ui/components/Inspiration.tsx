import React, { useState } from 'react';
import { View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character } from '@/core/types';
import type { InspireAspect } from '@/core/world/types';
import type { ForgeOutput } from '@/core/jobs';
import { characterDraft, knowledge, libraryDrafts, type Library } from '@/core/world/drafts';
import { inspirePrompt } from '@/core/world/forge';
import { changedFields } from '@/core/world/agent';
import { useJobs } from '@/state/jobs';
import { useSettings } from '@/state/settings';
import { Banner, Button, Card, Chip, Field, Row, SwitchRow, T } from './index';
import { JobStatusLine } from './JobStatus';

const ASPECTS: { key: InspireAspect; label: string }[] = [{ key: 'look', label: 'Look' }, { key: 'mind', label: 'Personality' }, { key: 'voice', label: 'Voice' }];
const LABEL: Record<string, string> = { appearance: 'Appearance', personality: 'Personality', drives: 'Wants and fears', voice: 'Voice', sayings: 'Sounds like' };

/**
 * What inspires a character: someone from a book, film, show or game, or a
 * real person. The character is an original take on them: look, personality
 * and voice are written from the inspiration into this world, in the app's
 * own words, and that writing is what scenes use. The name stays here, on
 * the card; it never reaches the writer or a painter, so a scene gets the
 * character, not an imitation of somebody else's story.
 */
export function InspirationEditor({ c, lib, onChange }: { c: Character; lib: Library | null; onChange: (p: Partial<Character>) => void }) {
  const db = useSQLiteContext();
  const { apiKey, defaults } = useSettings();
  const [wish, setWish] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));
  const live = useJobs((s) => (jobId ? s.live[jobId] : undefined));
  const who = c.data.inspiredBy ?? '';
  const aspects = c.data.inspire?.length ? c.data.inspire : (['look', 'mind', 'voice'] as InspireAspect[]);
  const proposal = job?.status === 'done' && !job.decisions[(job.output as ForgeOutput).drafts[0]?.id ?? ''] ? (job.output as ForgeOutput).drafts[0] : null;
  const setData = (p: Partial<Character['data']>) => onChange({ data: { ...c.data, ...p } });
  const toggle = (a: InspireAspect) => { const next = aspects.includes(a) ? aspects.filter((x) => x !== a) : [...aspects, a]; setData({ inspire: next.length ? next : aspects }); };

  async function write() {
    const l: Library = lib ?? { universe: null, entities: [], characters: [c], species: [], lore: [] };
    const withMe = { ...l, characters: [...l.characters.filter((x) => x.id !== c.id), c] };
    const draft = characterDraft(c, withMe);
    const messages = inspirePrompt({ draft, who: who.trim(), aspects, knowledge: knowledge(libraryDrafts(withMe), draft, '', 5000), wish });
    const j = await useJobs.getState().enqueue(db, 'inspire', { universeId: c.universeId, title: `${c.name}, inspired by ${who.trim()}`, input: { model: defaults.models.writer, messages, draft, who: who.trim(), aspects, maxTokens: 6000 } });
    setJobId(j.id);
  }

  async function use() {
    if (!job || !proposal) return;
    const keys = changedFields(proposal);
    const data: Record<string, unknown> = { ...c.data };
    for (const k of keys) if (k !== 'voice') data[k] = proposal.fields[k];
    onChange({ data: data as Character['data'], ...(keys.includes('voice') ? { voice: String(proposal.fields.voice ?? '') } : {}) });
    await useJobs.getState().decide(db, job.id, proposal.id, 'accepted');
  }

  return (
    <View style={{ gap: 10 }}>
      <Field label="Inspired by" value={who} onChangeText={(v) => setData({ inspiredBy: v })} placeholder="e.g. Aragorn, Lisbeth Salander, Buster Keaton" />
      <T v="faint">An original take on them, carried into this world: the look, personality, voice and lines written here are what scenes use.</T>
      {who.trim() ? <SwitchRow label="Tell the writer who they play like" hint="In every scene they are in, the writer is told to play them like this: the manner, rhythm and energy, never the lines or the story. Off keeps the name on this card only. Painters never see it." value={c.data.playsLike !== false} onChange={(x) => setData({ playsLike: x })} /> : null}
      {who.trim() ? (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            {ASPECTS.map((a) => <Chip key={a.key} small label={a.label} selected={aspects.includes(a.key)} onPress={() => toggle(a.key)} />)}
          </Row>
          <Field value={wish} onChangeText={setWish} placeholder="Optional: what to keep or change, e.g. older, kinder, less of a loner" />
          <Button small icon="sparkles-outline" title={`Write ${aspects.length === 3 ? 'look, personality and voice' : aspects.map((a) => ASPECTS.find((x) => x.key === a)!.label.toLowerCase()).join(' and ')} from ${who.trim().split(' ')[0]}`} disabled={!apiKey || job?.status === 'queued' || job?.status === 'running'} onPress={() => void write()} />
          {job ? <JobStatusLine job={job} live={live} compact /> : null}
          {job?.status === 'failed' ? <Banner text={job.error ?? 'It failed.'} /> : null}
          {proposal ? (
            <Card style={{ gap: 8 }}>
              <T v="label">Proposed</T>
              {changedFields(proposal).map((k) => <View key={k} style={{ gap: 2 }}><T v="small">{LABEL[k] ?? k}</T><T>{String(proposal.fields[k] ?? '')}</T></View>)}
              <Row>
                <Button small icon="checkmark" title="Use it" onPress={() => void use()} style={{ flex: 1 }} />
                <Button small kind="ghost" title="Dismiss" onPress={() => job && proposal && void useJobs.getState().decide(db, job.id, proposal.id, 'dismissed')} />
              </Row>
              <T v="faint">Using it fills this edit; Save keeps it.</T>
            </Card>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
