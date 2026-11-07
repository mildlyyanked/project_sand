import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Style, VoiceSpec, VoiceStrength } from '@/core/types';
import type { HearInput, HearOutput, VoiceInput } from '@/core/jobs';
import { HEAR_SCENES, STRENGTH, buildVoicePrompt, hearPrompt, voiceAnchor, voiceOf, type VoiceBuild } from '@/core/voice';
import { renderStyle } from '@/core/context/cards';
import { deleteStyle, getStyle, saveStyle, styleUsage } from '@/db/repo/library';
import { useSettings } from '@/state/settings';
import { useJobs } from '@/state/jobs';
import { useEntity } from '@/ui/useEntity';
import { HistorySheet } from '@/ui/components/History';
import { ChainEditor } from '@/ui/components/ChainEditor';
import { JobStatusLine } from '@/ui/components/JobStatus';
import { Banner, Button, Card, Chip, Field, IconButton, Ionicons, Row, Screen, Section, Segmented, SwitchRow, T } from '@/ui/components';
import { radius, serif, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

const POV = ['Third person, close on one character', 'First person', 'Omniscient', 'Second person'];
const TENSE = ['Past', 'Present'];

/**
 * A voice: who it writes like, and what that means in rules the writer can
 * follow. Name the writers and how far to go; a strong model writes the
 * rules, a one-line anchor and two original sample passages; the anchor is
 * said again right before every passage. Hear it writes the same scene in any
 * voice so two can be told apart. Form, what to avoid and the writer's
 * plumbing sit below.
 */
export default function StyleEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const { apiKey, defaults, templates } = useSettings();
  const [s, update] = useEntity<Style>(() => getStyle(db, id!), (v) => saveStyle(db, v), [id]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [used, setUsed] = useState<number | null>(null);
  const [ovText, setOvText] = useState<string | null>(null);
  const [ovErr, setOvErr] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [author, setAuthor] = useState('');
  const [wish, setWish] = useState('');
  const [passage, setPassage] = useState('');
  const [learn, setLearn] = useState(false);
  const [scene, setScene] = useState(0);
  const jobs = useJobs((x) => x.jobs);
  const live = useJobs((x) => x.live);
  useEffect(() => {
    if (id) void styleUsage(db, id).then(setUsed);
  }, [db, id]);
  const build = useMemo(() => jobs.filter((j) => j.kind === 'voice' && (j.input as VoiceInput).styleId === id).sort((a, b) => b.createdAt - a.createdAt)[0], [jobs, id]);
  const hear = useMemo(() => jobs.filter((j) => j.kind === 'hear' && (j.input as HearInput).styleId === id).sort((a, b) => b.createdAt - a.createdAt)[0], [jobs, id]);
  if (!s) return null;
  const v = voiceOf(s);
  const setVoice = (p: Partial<VoiceSpec>) => update({ voice: { ...v, ...p } });
  const proposal = build?.status === 'done' && !build.decisions.all ? (build.output as VoiceBuild) : null;
  const model = defaults.editorModel || defaults.models.writer;
  const anchor = voiceAnchor(s);

  function addAuthor() {
    const a = author.trim();
    if (!a || v.authors.includes(a)) return setAuthor('');
    setVoice({ authors: [...v.authors, a] });
    setAuthor('');
  }

  async function buildVoice() {
    const messages = buildVoicePrompt({ authors: v.authors, strength: v.strength, tone: v.tone, wish, sample: learn ? passage : undefined, current: s });
    await useJobs.getState().enqueue(db, 'voice', { universeId: null, title: `Voice: ${v.authors.join(', ') || s!.name}`, input: { model, messages, styleId: s!.id, maxTokens: 10000 } });
  }

  async function applyBuild() {
    if (!build || !proposal) return;
    const { voice, ...rest } = proposal;
    update({ ...rest, name: s!.name === 'New voice' && rest.name ? rest.name : s!.name, voice: { ...v, ...voice }, influences: '' });
    await useJobs.getState().decide(db, build.id, 'all', 'accepted');
  }

  async function hearIt() {
    const messages = hearPrompt(renderStyle(s!), s!.system.trim() || templates.craft, HEAR_SCENES[scene]!);
    await useJobs.getState().enqueue(db, 'hear', { universeId: null, title: `Hear ${s!.name}`, input: { model: defaults.models.writer, messages, styleId: s!.id, scene: HEAR_SCENES[scene]!, maxTokens: 3000 } });
  }

  return (
    <Screen scroll>
      <Section title="Voice" right={<Button small kind="ghost" icon="time-outline" title="History" onPress={() => setHistoryOpen(true)} />}>
        <Field label="Name" value={s.name} onChangeText={(x) => update({ name: x })} />
        {used != null ? <T v="faint">{used === 0 ? 'Not used by any story yet.' : used === 1 ? 'Used by one story. Changes here reach it on its next passage.' : `Shared by ${used} stories. Changes here reach all of them on their next passage.`}</T> : null}
      </Section>

      <Section title="Write like">
        <T v="faint">Name the writers, say how far, and build it: a strong model turns them into rules the writer follows, a one-line anchor said again before every passage, and two sample passages in the voice.</T>
        {v.authors.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {v.authors.map((a) => <Chip key={a} label={`${a}  ×`} selected onPress={() => setVoice({ authors: v.authors.filter((x) => x !== a) })} />)}
          </Row>
        ) : null}
        <Row style={{ alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Field value={author} onChangeText={setAuthor} onSubmitEditing={addAuthor} placeholder={v.authors.length ? 'And another writer' : 'e.g. Kurt Vonnegut, Don DeLillo, Brandon Sanderson'} returnKeyType="done" /></View>
          <IconButton name="add-circle" color={t.accent} size={30} onPress={addAuthor} disabled={!author.trim()} />
        </Row>
        <View style={{ gap: 6 }}>
          <Segmented value={v.strength} onChange={(x) => setVoice({ strength: x as VoiceStrength })} options={(['echo', 'close', 'pastiche'] as VoiceStrength[]).map((k) => ({ key: k, label: STRENGTH[k].label }))} />
          <T v="faint">{STRENGTH[v.strength].hint}</T>
        </View>
        <Field label="Tone" value={v.tone} onChangeText={(x) => setVoice({ tone: x })} placeholder="e.g. deadpan and humane; dread under glossy surfaces; earnest, kinetic" />
        <Field value={wish} onChangeText={setWish} placeholder="Optional: anything else, e.g. shorter chapters, less whimsy, more dialogue" />
        <SwitchRow label="Learn from a passage too" hint="Paste a passage written the way you want; the voice is learned from it, never copied." value={learn} onChange={setLearn} />
        {learn ? <Field multiline value={passage} onChangeText={setPassage} placeholder="Paste a few paragraphs" style={{ minHeight: 120, fontFamily: serif }} /> : null}
        <Button icon="sparkles-outline" title={v.rules.trim() ? 'Rebuild the voice' : 'Build the voice'} disabled={!apiKey || (!v.authors.length && !(learn && passage.trim().length > 200)) || build?.status === 'queued' || build?.status === 'running'} onPress={() => void buildVoice()} />
        <T v="faint">Built by {shortModel(model)} (the editor model in Settings, or the writer).</T>
        {build && build.status !== 'done' ? <JobStatusLine job={build} live={live[build.id]} compact /> : null}
        {build?.status === 'failed' ? <Banner text={build.error ?? 'It failed.'} /> : null}
        {proposal ? (
          <Card style={{ gap: 8 }}>
            <T v="label">Proposed{proposal.name ? ` · ${proposal.name}` : ''}</T>
            {proposal.voice.anchor ? <T style={{ fontStyle: 'italic' }}>{proposal.voice.anchor}</T> : null}
            {proposal.voice.rules ? <T v="dim" numberOfLines={12}>{proposal.voice.rules}</T> : null}
            {proposal.samples?.length ? <T v="faint">{proposal.samples.length} sample passages, {[proposal.pointOfView, proposal.tense].filter(Boolean).join(', ')}</T> : null}
            <Row>
              <Button small icon="checkmark" title="Use it" onPress={() => void applyBuild()} style={{ flex: 1 }} />
              <Button small kind="ghost" title="Dismiss" onPress={() => void useJobs.getState().decide(db, build!.id, 'all', 'dismissed')} />
            </Row>
            <T v="faint">Using it replaces the rules, anchor, form, phrases to avoid and samples below.</T>
          </Card>
        ) : null}
      </Section>

      <Section title="Hear it">
        <T v="faint">The same scene in any voice, written exactly as the writer gets this one: the quickest way to tell two voices apart, or to see if a change took.</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {HEAR_SCENES.map((x, i) => <Chip key={i} small label={x.split('.')[0]!.slice(0, 38)} selected={scene === i} onPress={() => setScene(i)} />)}
        </ScrollView>
        <Button small kind="outline" icon="ear-outline" title={hear?.status === 'running' || hear?.status === 'queued' ? 'Writing…' : 'Write the test scene'} disabled={!apiKey || hear?.status === 'running' || hear?.status === 'queued'} onPress={() => void hearIt()} />
        {hear && hear.status !== 'done' ? <JobStatusLine job={hear} live={live[hear.id]} compact /> : null}
        {hear?.status === 'done' ? (
          <View style={{ gap: 6, padding: 14, borderRadius: radius.md, backgroundColor: t.surface }}>
            <T v="small">{(hear.input as HearInput).scene.split('.')[0]}</T>
            {(hear.output as HearOutput).text.split(/\n{2,}/).map((p, i) => <T key={i} style={{ fontFamily: serif, fontSize: 16, lineHeight: 24 }}>{p.trim()}</T>)}
          </View>
        ) : null}
      </Section>

      <Section title="The voice">
        <Field label="Anchor" hint="Said again right before every passage, where it weighs most. One sentence: what most makes the voice itself." value={v.anchor} onChangeText={(x) => setVoice({ anchor: x })} multiline placeholder="e.g. Plain words, short sentences, a joke that hurts; the narrator steps in to say so it goes." />
        {anchor ? <T v="faint">Before each passage the writer reads: {anchor}</T> : null}
        <Field label="Rules" hint="How the voice writes, as rules the writer can follow. Concrete beats vague: sentence shapes, words, what the narration does and never does." value={v.rules} onChangeText={(x) => setVoice({ rules: x })} multiline style={{ minHeight: 200 }} placeholder={'Sentences:\n- Short, declarative; one long one per page at most.\nDiction:\n- Plain words; no metaphors the reader has to work for.\nNever:\n- Explains a joke.'} />
      </Section>

      <Section title="Samples">
        <T v="faint">Passages in the voice, sent as examples: the strongest guide the writer gets. Building the voice writes two; paste your own too.</T>
        {s.samples.map((p, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <Field multiline value={p} onChangeText={(x) => update({ samples: s.samples.map((y, j) => (j === i ? x : y)) })} style={{ flex: 1, fontFamily: serif, minHeight: 120 }} />
            <IconButton name="close" onPress={() => update({ samples: s.samples.filter((_, j) => j !== i) })} />
          </Row>
        ))}
        <Button kind="ghost" icon="add" title="Add sample" onPress={() => update({ samples: [...s.samples, ''] })} />
      </Section>

      <Section title="Form">
        <View style={{ gap: 6 }}>
          <T v="label">Point of view</T>
          <Row style={{ flexWrap: 'wrap' }}>{POV.map((x) => <Chip key={x} small label={x} selected={s.pointOfView === x} onPress={() => update({ pointOfView: s.pointOfView === x ? '' : x })} />)}</Row>
          <Field value={s.pointOfView} onChangeText={(x) => update({ pointOfView: x })} placeholder="Or say it your way" />
        </View>
        <View style={{ gap: 6 }}>
          <T v="label">Tense</T>
          <Row>{TENSE.map((x) => <Chip key={x} small label={x} selected={s.tense === x} onPress={() => update({ tense: s.tense === x ? '' : x })} />)}</Row>
        </View>
        <Field label="Prose density" value={s.proseDensity} onChangeText={(x) => update({ proseDensity: x })} placeholder="Lean, lush, medium…" />
        <Field label="Dialogue" value={s.dialogueRatio} onChangeText={(x) => update({ dialogueRatio: x })} placeholder="Sparse, balanced, dialogue-driven" />
        <View style={{ gap: 6 }}>
          <T v="label">Register</T>
          <Segmented value={s.register} onChange={(x) => update({ register: x })} options={[{ key: 'clinical', label: 'Clinical' }, { key: 'euphemistic', label: 'Euphemistic' }, { key: 'blunt', label: 'Blunt' }]} />
          <T v="faint">How bodies and acts are named. Applies everywhere, not only to sex.</T>
        </View>
      </Section>

      <Section title="Avoid">
        <Field label="Never use" hint="Comma separated. Also feeds the voice check." value={s.bannedPhrases.join(', ')} onChangeText={(x) => update({ bannedPhrases: x.split(',').map((y) => y.trim()).filter(Boolean) })} />
        <View style={{ gap: 6 }}>
          <T v="label">Repetition control</T>
          <Segmented value={s.repetition} onChange={(x) => update({ repetition: x })} options={[{ key: 'off', label: 'Off' }, { key: 'light', label: 'Light' }, { key: 'medium', label: 'Medium' }, { key: 'strong', label: 'Strong' }]} />
          <T v="faint">Applied through the sampler, mostly as a presence penalty; nothing about it enters the prompt. If a passage ever collapses into a run-on sentence, set this to Off.</T>
        </View>
      </Section>

      <Pressable onPress={() => setAdvanced(!advanced)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 }}>
        <Ionicons name={advanced ? 'chevron-down' : 'chevron-forward'} size={16} color={t.dim} />
        <T v="label">Advanced: writer prompt, persistence, delivery</T>
      </Pressable>
      {advanced ? (
        <>
          {s.vocabulary.trim() ? <Field label="Vocabulary (older voices)" value={s.vocabulary} onChangeText={(x) => update({ vocabulary: x })} multiline /> : null}
          <Section title="Writer prompt" right={!s.system ? <Button small kind="ghost" title={showPrompt ? 'Hide default' : 'Show default'} onPress={() => setShowPrompt(!showPrompt)} /> : undefined}>
            {!s.system ? <T v="faint">Empty: the app’s default writer prompt is used (Settings → Prompt templates). Write one here to replace it entirely, or use the prompt lab from a story to have a strong model draft one.</T> : null}
            {!s.system && showPrompt ? <T v="mono" style={{ fontSize: 12 }}>{templates.craft}</T> : null}
            <Field label="System" value={s.system} onChangeText={(x) => update({ system: x })} multiline style={{ minHeight: 160 }} placeholder="Leave empty for the default" />
            <Field label="Post-history" hint="Sent last, as a user turn, after the manuscript, before the voice's anchor." value={s.postHistory} onChangeText={(x) => update({ postHistory: x })} multiline placeholder="e.g. Continue with the next passage. Prose only." />
            <Field label="Prefill" hint="Starts the assistant's reply. Kept as part of the passage. Not every provider honors it." value={s.prefill} onChangeText={(x) => update({ prefill: x })} multiline />
          </Section>
          <ChainEditor chain={s.refusalChain} onChange={(refusalChain) => update({ refusalChain })} />
          <Section title="Delivery">
            <SwitchRow label="System prompt as first user turn" hint="Some providers water down or ignore the system role. This sends it as the opening exchange instead." value={s.systemAsUser} onChange={(x) => update({ systemAsUser: x })} />
            <Field label="Avoid providers" hint="OpenRouter provider slugs, comma separated. Use it to skip providers that add moderation on top of the model." value={s.providerIgnore.join(', ')} onChangeText={(x) => update({ providerIgnore: x.split(',').map((y) => y.trim()).filter(Boolean) })} autoCapitalize="none" autoCorrect={false} placeholder="e.g. azure, openai" />
            <Field label="Prefer providers" hint="Tried first, in this order." value={s.providerOrder.join(', ')} onChangeText={(x) => update({ providerOrder: x.split(',').map((y) => y.trim()).filter(Boolean) })} autoCapitalize="none" autoCorrect={false} placeholder="e.g. together, deepinfra" />
            <T v="label">Per-model overrides</T>
            <T v="faint">JSON keyed by model id or prefix ending in *, with any of system, prefill, postHistory.</T>
            <Field multiline value={ovText ?? JSON.stringify(s.modelOverrides, null, 2)} onChangeText={(x) => { setOvText(x); try { update({ modelOverrides: JSON.parse(x) }); setOvErr(false); } catch { setOvErr(true); } }} style={{ fontFamily: 'monospace', minHeight: 80 }} autoCapitalize="none" autoCorrect={false} />
            {ovErr ? <T v="faint" style={{ color: t.danger }}>Not valid JSON yet; last valid value is kept.</T> : null}
          </Section>
        </>
      ) : null}

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} kind="style" targetId={s.id} onRestore={(payload) => { try { const j = JSON.parse(payload) as Partial<Style>; const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = j; update(rest); } catch {} }} />
      <Button kind="danger" title="Delete voice" onPress={() => Alert.alert('Delete voice?', used ? `${used} stor${used === 1 ? 'y uses' : 'ies use'} it; they fall back to the default prompt.` : undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteStyle(db, s.id); router.back(); } }])} />
    </Screen>
  );
}
