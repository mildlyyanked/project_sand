import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import { dayOf, type AgentState } from '@/core/world/agent';
import { getAgent } from '@/db/repo/agent';
import { answerQuestion, ensureTodayQuestion, skipQuestion } from '@/state/agent';
import { useJobs } from '@/state/jobs';
import { useSettings } from '@/state/settings';
import { Button, Card, Field, Ionicons, Row, T } from './index';
import { workshopRoute } from './Entry';
import { useTheme } from '../theme';

/**
 * Today's question from a world's agent: one question a day, aimed at what
 * the world is thinnest on. Answer it in a few sentences and the agent folds
 * the answer into the world, proposing what it implies; skip it, or ask for
 * another. Asked in the background the first time the card is seen each day.
 */
export function QuestionCard({ universe, hideWhenDone, showWorld }: { universe: Universe; hideWhenDone?: boolean; showWorld?: boolean }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const apiKey = useSettings((s) => s.apiKey);
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const asking = useJobs((s) => s.jobs.find((j) => j.universeId === universe.id && j.kind === 'question' && (j.status === 'queued' || j.status === 'running')));
  const failed = useJobs((s) => s.jobs.find((j) => j.universeId === universe.id && j.kind === 'question' && j.status === 'failed' && dayOf(j.createdAt) === dayOf()));
  const doneAt = useJobs((s) => s.jobs.filter((j) => j.universeId === universe.id && j.kind === 'question' && j.status === 'done').reduce((m, j) => Math.max(m, j.updatedAt), 0));

  const load = useCallback(async () => {
    const a = await getAgent(db, universe.id);
    setAgent(a);
    if (apiKey && a.today?.date !== dayOf()) await ensureTodayQuestion(db, universe.id);
  }, [db, universe.id, apiKey]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // A question that just arrived.
  useEffect(() => { if (doneAt) void getAgent(db, universe.id).then(setAgent); }, [doneAt, db, universe.id]);

  if (!agent) return null;
  const today = agent.today?.date === dayOf() ? agent.today : null;
  if (!apiKey && !today) return null;
  if (hideWhenDone && (!today || today.skipped || (today.answered && !sent)) && !asking) return null;
  const head = (
    <Row gap={6}>
      <Ionicons name="help-buoy-outline" size={15} color={t.accent} />
      <T v="label" style={{ flex: 1 }} numberOfLines={1}>Today’s question{showWorld ? ` · ${universe.name}` : ''}</T>
    </Row>
  );

  if (!today) {
    return (
      <Card style={{ gap: 8 }}>
        {head}
        {asking ? <T v="faint">The agent is reading the world for a question…</T> : failed ? <><T v="faint">It could not come up with one: {failed.error}</T><Button small kind="outline" title="Try again" onPress={() => void ensureTodayQuestion(db, universe.id, { force: true })} /></> : <Button small kind="outline" title="Ask me one" onPress={() => void ensureTodayQuestion(db, universe.id, { force: true })} />}
      </Card>
    );
  }

  if (today.answered || sent) {
    return (
      <Card style={{ gap: 8 }}>
        {head}
        <T v="dim" numberOfLines={3}>{today.question}</T>
        <T v="faint">{sent ? 'Sent. The agent is folding your answer into the world; what it proposes will wait in the inbox.' : 'Answered today.'}</T>
        <Row style={{ flexWrap: 'wrap' }}>
          <Button small kind="outline" icon="chatbubbles-outline" title="See what came of it" onPress={() => router.push(workshopRoute(universe.id) as never)} />
          <Button small kind="ghost" title="Another question" onPress={async () => { setSent(false); await ensureTodayQuestion(db, universe.id, { force: true }); }} />
        </Row>
      </Card>
    );
  }

  if (today.skipped) {
    return (
      <Card style={{ gap: 8 }}>
        {head}
        <T v="faint">Skipped for today.</T>
        <Button small kind="ghost" title="Ask another" onPress={() => void ensureTodayQuestion(db, universe.id, { force: true })} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }}>
      {head}
      <T v="serif" style={{ fontSize: 18, lineHeight: 26 }}>{today.question}</T>
      {today.why ? <T v="faint">{today.why}</T> : null}
      <Field value={answer} onChangeText={setAnswer} multiline placeholder="A few sentences is plenty. Half an idea is fine too." style={{ minHeight: 80 }} />
      <Row>
        <Button title="Answer" icon="send" loading={busy} disabled={!answer.trim() || busy || !apiKey} onPress={async () => { setBusy(true); try { await answerQuestion(db, universe.id, answer.trim()); setAnswer(''); setSent(true); } finally { setBusy(false); } }} style={{ flex: 1 }} />
        <Button kind="ghost" title="Skip" onPress={async () => { await skipQuestion(db, universe.id); await load(); }} />
      </Row>
      {asking ? <View><T v="faint">Thinking of another…</T></View> : null}
    </Card>
  );
}
