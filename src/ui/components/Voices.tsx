import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Style } from '@/core/types';
import type { ForgeOutput, Job } from '@/core/jobs';
import { STRENGTH, namedIn, playsLike, sayingsOf, voiceAnchor, voiceOf } from '@/core/voice';
import { characterDraft, knowledge, libraryDrafts, type Library } from '@/core/world/drafts';
import { inspirePrompt } from '@/core/world/forge';
import { changedFields } from '@/core/world/agent';
import { saveCharacter } from '@/db/repo/library';
import { useJobs } from '@/state/jobs';
import { useSettings } from '@/state/settings';
import { acceptDrafts } from '@/state/proposals';
import { Banner, Button, Card, Field, Row, Sheet, T } from './index';
import { Avatar } from './EntryImage';
import { JobStatusLine } from './JobStatus';

const named = namedIn;

/**
 * The voices of a story, from inside it: the voice the prose is written in,
 * and the people in the scene with how each of them sounds. Anyone who has
 * just walked in can be given who they play like and a voice on the spot,
 * written in the background and saved to their card, and every passage after
 * keeps them sounding like it.
 */
export function VoicesSheet({ open, onClose, style, cast, people, last, recent, lib, drift, onDrift, onChanged }: {
  open: boolean; onClose: () => void; style: Style | null; cast: Character[]; people: Character[]; last: string; recent: string; lib: Library; drift: string[]; onDrift: () => void; onChanged: () => void;
}) {
  const v = voiceOf(style);
  const inScene = useMemo(() => {
    const all = [...cast, ...people.filter((p) => !cast.some((c) => c.id === p.id))];
    const here = all.filter((c) => named(last, c) || named(recent, c));
    return here.length ? here : cast;
  }, [cast, people, last, recent]);
  return (
    <Sheet open={open} onClose={onClose} title="Voices" full>
      <T v="label">The prose</T>
      {style ? (
        <Card style={{ gap: 6 }}>
          <T v="h">{style.name}</T>
          {v.authors.length ? <T v="dim">Writes like {v.authors.join(' and ')} · {STRENGTH[v.strength].label.toLowerCase()}</T> : <T v="faint">Not built from any writer yet. Name a writer on the voice to make it hold.</T>}
          {voiceAnchor(style) ? <T v="faint" style={{ fontStyle: 'italic' }}>{voiceAnchor(style)}</T> : null}
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small kind="outline" icon="create-outline" title="Edit the voice" onPress={() => { onClose(); router.push(`/library/style/${style.id}`); }} />
          </Row>
        </Card>
      ) : <T v="faint">No voice on this story: the default writer prompt. Pick one in the story’s settings.</T>}
      {drift.length ? (
        <View style={{ gap: 4 }}>
          <T v="small">The last passage drifted:</T>
          {drift.map((n) => <T key={n} v="dim">• {n}</T>)}
          <Button small kind="ghost" title="Regenerate it, staying on voice" onPress={onDrift} />
        </View>
      ) : null}
      <T v="label" style={{ marginTop: 12 }}>In the scene</T>
      <T v="faint">Before every passage the writer is reminded how each of them sounds. Give anyone a voice here: who they play like, and lines they would say.</T>
      {inScene.length ? inScene.map((c) => <PersonVoice key={c.id} c={c} lib={lib} onChanged={onChanged} />) : <T v="faint">Nobody from the library is in the scene yet.</T>}
    </Sheet>
  );
}

function PersonVoice({ c, lib, onChanged }: { c: Character; lib: Library; onChanged: () => void }) {
  const db = useSQLiteContext();
  const { apiKey, defaults } = useSettings();
  const [editing, setEditing] = useState(false);
  const [who, setWho] = useState(c.data.inspiredBy ?? '');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined)) as Job<'inspire'> | undefined;
  const live = useJobs((s) => (jobId ? s.live[jobId] : undefined));
  const proposal = job?.status === 'done' ? (job.output as ForgeOutput).drafts[0] : null;
  const decided = proposal ? job?.decisions[proposal.id] : undefined;
  const lines = sayingsOf(c);
  const plays = playsLike(c);

  async function write() {
    const name = who.trim();
    // Saved first: the writer plays them like this from the next passage, even before their voice is written.
    const next = { ...c, data: { ...c.data, inspiredBy: name, playsLike: true } };
    await saveCharacter(db, next);
    onChanged();
    const withMe: Library = { ...lib, characters: [...lib.characters.filter((x) => x.id !== c.id), next] };
    const draft = characterDraft(next, withMe);
    const messages = inspirePrompt({ draft, who: name, aspects: ['mind', 'voice'], knowledge: knowledge(libraryDrafts(withMe), draft, '', 4000) });
    const j = await useJobs.getState().enqueue(db, 'inspire', { universeId: c.universeId, title: `${c.name}, played like ${name}`, input: { model: defaults.models.writer, messages, draft, who: name, aspects: ['mind', 'voice'], maxTokens: 6000 } });
    setJobId(j.id);
  }

  return (
    <Card style={{ gap: 8 }}>
      <Row gap={10}>
        <Avatar data={c.data as Record<string, unknown>} name={c.name} size={34} />
        <View style={{ flex: 1 }}>
          <T v="h" numberOfLines={1}>{c.name}</T>
          {c.data.inspiredBy?.trim() ? <T v="small" numberOfLines={1}>{plays ? 'Plays like' : 'Inspired by'} {c.data.inspiredBy.trim()}</T> : null}
        </View>
        {!editing ? <Button small kind="ghost" title={c.voice.trim() || lines.length ? 'Change' : 'Give a voice'} onPress={() => setEditing(true)} /> : null}
      </Row>
      {c.voice.trim() ? <T v="dim" numberOfLines={3}>{c.voice.trim()}</T> : !editing ? <T v="faint">No voice yet: the writer guesses.</T> : null}
      {lines.length ? <T v="faint" numberOfLines={2}>{lines.slice(0, 2).map((l) => `“${l.replace(/^["“]|["”]$/g, '')}”`).join('  ')}</T> : null}
      {editing ? (
        <View style={{ gap: 8 }}>
          <Field label="Plays like" value={who} onChangeText={setWho} placeholder="e.g. Adam Sandler in Uncut Gems" />
          <Row>
            <Button small icon="sparkles-outline" title="Write their voice" disabled={!apiKey || !who.trim() || job?.status === 'running' || job?.status === 'queued'} onPress={() => void write()} style={{ flex: 1 }} />
            <Button small kind="ghost" title="Close" onPress={() => setEditing(false)} />
          </Row>
          <T v="faint">They play like this from the next passage on. Their voice, personality and lines are written from it in the background, for you to use or dismiss.</T>
        </View>
      ) : null}
      {job && job.status !== 'done' ? <JobStatusLine job={job} live={live} compact /> : null}
      {job?.status === 'failed' ? <Banner text={job.error ?? 'It failed.'} /> : null}
      {proposal && !decided ? (
        <View style={{ gap: 6 }}>
          {changedFields(proposal).map((k) => <T key={k} v="dim" numberOfLines={5}><T v="dim" style={{ fontWeight: '600' }}>{k === 'sayings' ? 'Sounds like' : k === 'drives' ? 'Wants and fears' : k[0]!.toUpperCase() + k.slice(1)}: </T>{String(proposal.fields[k] ?? '')}</T>)}
          <Row>
            <Button small icon="checkmark" title="Use it" onPress={async () => { await acceptDrafts(db, job!, [proposal.id]); onChanged(); setEditing(false); }} style={{ flex: 1 }} />
            <Button small kind="ghost" title="Dismiss" onPress={() => void useJobs.getState().decide(db, job!.id, proposal.id, 'dismissed')} />
          </Row>
        </View>
      ) : decided === 'accepted' ? <T v="small">Saved to {c.name}’s card.</T> : null}
    </Card>
  );
}
