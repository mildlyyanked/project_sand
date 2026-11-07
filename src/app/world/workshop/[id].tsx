import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { WorkshopMessage } from '@/core/world/agent';
import type { LibKind } from '@/core/world/drafts';
import { KIND_NOUN } from '@/core/world/drafts';
import { proposalCount } from '@/core/jobs';
import { getAgent, listWorkshop } from '@/db/repo/agent';
import { agentModel, askAgent, retryReply, saveBrief, type Focus } from '@/state/agent';
import { useJobs } from '@/state/jobs';
import { useSettings } from '@/state/settings';
import { Badge, Banner, Button, Chip, Field, IconButton, Ionicons, Row, Sheet, T } from '@/ui/components';
import { JobStatusLine } from '@/ui/components/JobStatus';
import { ProposalSheet, subtitleOf } from '@/ui/components/Proposals';
import { MiniAvatar, openEntry } from '@/ui/components/Entry';
import { useWorld } from '@/ui/useWorld';
import { KeyboardShift, useHeaderOffset } from '@/ui/keyboard';
import { radius, serif, space, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

const OPENERS = ['What does this world need most right now?', 'Ask me about what I want this world to be.', 'Find the contradictions and gaps.', 'Surprise me with something that fits.'];

/**
 * A world's workshop: a conversation with its agent, a curious co-author
 * that knows everything in the world and keeps a brief of what the writer
 * wants. Replies are written in the background and saved with the thread;
 * what the agent proposes waits for a decision, here or in the inbox.
 * Opened from an entry, the conversation is about that entry.
 */
export default function Workshop() {
  const { id, focus: focusId, kind, intent } = useLocalSearchParams<{ id: string; focus?: string; kind?: LibKind; intent?: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const offset = useHeaderOffset();
  const apiKey = useSettings((s) => s.apiKey);
  const w = useWorld(id);
  const [thread, setThread] = useState<WorkshopMessage[]>([]);
  const [input, setInput] = useState('');
  const [focusOverride, setFocusOverride] = useState<Focus | null | undefined>(undefined);
  const [brief, setBrief] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState('');
  const [review, setReview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sentIntent = useRef(false);
  const listRef = useRef<FlatList<WorkshopMessage>>(null);
  const jobs = useJobs((s) => s.jobs);
  const live = useJobs((s) => s.live);
  const mine = useMemo(() => jobs.filter((j) => j.universeId === id && j.kind === 'workshop'), [jobs, id]);
  const stamp = mine.map((j) => `${j.id}:${j.status}:${Object.keys(j.decisions).length}`).join('|');

  const load = useCallback(() => (id ? Promise.all([listWorkshop(db, id), getAgent(db, id)]).then(([m, a]) => { setThread(m); setBrief(a.brief); }) : Promise.resolve()), [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // A reply finished, failed or was decided on: read the thread again.
  useEffect(() => { void load(); }, [stamp, load]);

  // The entry this was opened from, until the writer lets it go.
  const opened = useMemo<Focus | null>(() => { const e = focusId ? w.byId.get(focusId) : undefined; return e ? { kind: kind ?? e.kind, id: e.id, name: e.name } : null; }, [focusId, kind, w.byId]);
  const focus = focusOverride === undefined ? opened : focusOverride;
  const setFocus = setFocusOverride;

  const send = useCallback(async (text: string, f: Focus | null = focus, why?: string) => {
    if (!id || !text.trim()) return;
    setErr(null);
    setInput('');
    try {
      await askAgent(db, id, { text, focus: f, intent: why });
      await load();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [db, id, focus, load]);

  // Opened from a forge point on an entry: say what is wanted, once.
  useEffect(() => {
    if (!intent || !focus || sentIntent.current || !apiKey) return;
    sentIntent.current = true;
    void send(`I want ${intent} for ${focus.name}. Ask me what you need, or propose some.`, focus, intent);
  }, [intent, focus, send, apiKey]);

  const u = w.lib?.universe;

  const renderMessage = ({ item: m }: { item: WorkshopMessage }) => {
    const job = m.data.jobId ? mine.find((j) => j.id === m.data.jobId) : undefined;
    if (m.role === 'user') {
      return (
        <View style={{ alignSelf: 'flex-end', maxWidth: '86%', marginHorizontal: space.lg, marginVertical: 6, gap: 4 }}>
          {m.data.question ? <T v="small" style={{ textAlign: 'right' }}>Answering: {m.data.question}</T> : null}
          {m.data.focus ? <T v="small" style={{ textAlign: 'right' }}>About {m.data.focus.name}</T> : null}
          <View style={{ backgroundColor: t.surface2, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 }}><T>{m.text}</T></View>
        </View>
      );
    }
    const waiting = !m.text && !m.data.error && job && (job.status === 'queued' || job.status === 'running');
    const left = job ? proposalCount(job) : 0;
    const drafts = m.data.drafts ?? [];
    return (
      <View style={{ marginHorizontal: space.lg, marginVertical: 8, gap: 8 }}>
        <Row gap={6}><Ionicons name="sparkles-outline" size={13} color={t.accent} /><T v="small">{u?.name ?? 'The world'}’s agent</T>{m.data.briefChanged ? <Badge label="brief updated" tone="info" /> : null}</Row>
        {waiting && job ? <JobStatusLine job={job} live={live[job.id]} compact /> : null}
        {m.data.error ? (
          <View style={{ gap: 6 }}>
            <Banner text={m.data.error} />
            <Button small kind="outline" icon="refresh-outline" title="Try again" onPress={async () => { await retryReply(db, m); await load(); }} />
          </View>
        ) : job && !m.text && (job.status === 'cancelled') ? (
          <Button small kind="outline" icon="refresh-outline" title="Stopped. Try again" onPress={async () => { await retryReply(db, m); await load(); }} />
        ) : null}
        {m.text ? m.text.split(/\n{2,}/).map((p, i) => <T key={i} style={{ fontFamily: serif, fontSize: 16, lineHeight: 24 }}>{p.trim()}</T>) : null}
        {drafts.length ? (
          <Pressable onPress={() => job && setReview(job.id)} style={{ gap: 6, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: left ? t.accent : t.border, backgroundColor: t.surface }}>
            <Row between><T v="label">{drafts.length} {drafts.length === 1 ? 'proposal' : 'proposals'}</T><T v="small">{left ? `${left} to decide` : 'decided'}</T></Row>
            {drafts.slice(0, 5).map((d) => (
              <Row key={d.id} gap={8}>
                <MiniAvatar e={{ kind: d.kind, name: d.name }} size={22} />
                <T numberOfLines={1} style={{ flex: 1 }}>{d.existing ? `Change ${d.name}` : d.name}</T>
                <T v="small">{job?.decisions[d.id] === 'accepted' ? 'added' : job?.decisions[d.id] === 'dismissed' ? 'dismissed' : d.existing ? 'change' : KIND_NOUN[d.kind].toLowerCase()}</T>
              </Row>
            ))}
            {drafts.length > 5 ? <T v="small">and {drafts.length - 5} more</T> : null}
            {left ? <T v="small" style={{ color: t.accent }}>Review them</T> : null}
            {!left && drafts[0] && !drafts[0].existing && job?.decisions[drafts[0].id] === 'accepted' ? <T v="faint" numberOfLines={1}>{subtitleOf(drafts[0])}</T> : null}
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardShift style={{ flex: 1, backgroundColor: t.bg }} offset={offset}>
      <Stack.Screen options={{ title: u ? `Workshop · ${u.name}` : 'Workshop', headerRight: () => <IconButton name="reader-outline" onPress={() => { setBriefDraft(brief); setBriefOpen(true); }} /> }} />
      {err ? <View style={{ padding: space.md }}><Banner text={err} onClose={() => setErr(null)} /></View> : null}
      <FlatList
        ref={listRef}
        data={thread}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        contentContainerStyle={{ paddingVertical: space.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          thread.length === 0 ? (
            <View style={{ padding: space.lg, gap: 12 }}>
              <T v="h">Let’s build {u?.name ?? 'this world'} together.</T>
              <T v="dim">The agent has read everything in the world. Tell it what you want, answer its questions, ask for anything. It keeps a brief of what you are after, and proposes entries and changes for you to accept or dismiss. Replies are written in the background: you can leave and come back.</T>
              <Row style={{ flexWrap: 'wrap' }}>{OPENERS.map((o) => <Chip key={o} small label={o} onPress={() => void send(o)} />)}</Row>
            </View>
          ) : null
        }
      />
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Platform.OS === 'ios' ? space.xl : space.md, backgroundColor: t.bg, gap: 6 }}>
        {focus ? (
          <Row gap={6}>
            <Pressable onPress={() => openEntry(focus.kind, focus.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
              <MiniAvatar e={{ kind: focus.kind, name: focus.name, image: w.byId.get(focus.id)?.image }} size={18} />
              <T v="small">About {focus.name}</T>
            </Pressable>
            <IconButton name="close" size={14} onPress={() => setFocus(null)} />
          </Row>
        ) : null}
        <Row style={{ alignItems: 'flex-end' }}>
          <TextInput value={input} onChangeText={setInput} placeholder={thread.length ? 'Reply…' : 'What do you want for this world?'} placeholderTextColor={t.faint} multiline style={{ flex: 1, backgroundColor: t.surface, color: t.text, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140 }} />
          <IconButton name="arrow-up-circle" size={30} color={input.trim() ? t.accent : t.faint} onPress={() => void send(input)} disabled={!input.trim() || !apiKey} />
        </Row>
        {thread.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip small label="Propose some" onPress={() => void send('Propose entries now, from what we have said.')} />
            <Chip small label="Ask me something" onPress={() => void send('Ask me the one question that would help most.')} />
            <Chip small label="Stranger" onPress={() => void send('Push that stranger and more specific.')} />
            <Chip small label="What is missing?" onPress={() => void send('What is this world missing? Be specific.')} />
          </Row>
        ) : null}
        {!apiKey ? <T v="faint">Add your OpenRouter key in Settings to talk to the agent.</T> : <T v="small">Thinks with {shortModel(agentModel())}</T>}
      </View>
      <ProposalSheet jobId={review} onClose={() => { setReview(null); void load(); void w.reload(); }} onAccepted={() => void w.reload()} />
      <Sheet open={briefOpen} onClose={() => setBriefOpen(false)} title="The brief" full>
        <T v="faint">What you want this world to be, as the agent understands it: the vision, what you love, what to avoid, decisions made, questions open. The agent keeps it up to date as you talk; change anything here.</T>
        <Field value={briefDraft} onChangeText={setBriefDraft} multiline style={{ minHeight: 220 }} placeholder="Empty so far. Talk to the agent, or write it yourself." />
        <Row>
          <Button title="Save" icon="checkmark" disabled={briefDraft === brief} onPress={async () => { if (id) await saveBrief(db, id, briefDraft); setBrief(briefDraft); setBriefOpen(false); }} style={{ flex: 1 }} />
          <Button kind="ghost" title="Cancel" onPress={() => setBriefOpen(false)} />
        </Row>
      </Sheet>
    </KeyboardShift>
  );
}
