import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Style } from '@/core/types';
import { deleteStyle, getStyle, saveStyle, styleUsage } from '@/db/repo/library';
import { styleFromSamplePrompt } from '@/core/helpers';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { useEntity } from '@/ui/useEntity';
import { HistorySheet } from '@/ui/components/History';
import { ChainEditor } from '@/ui/components/ChainEditor';
import { Banner, Button, Field, IconButton, Row, Screen, Section, Segmented, SwitchRow, T } from '@/ui/components';
import { serif } from '@/ui/theme';

/**
 * A voice is everything that shapes how the writer writes: the card the model
 * reads (point of view, tense, register…) and the way it is driven (system
 * prompt, post-history, persistence chain, delivery).
 */
export default function StyleEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { apiKey, defaults, templates } = useSettings();
  const [s, update] = useEntity<Style>(() => getStyle(db, id!), (v) => saveStyle(db, v), [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [used, setUsed] = useState<number | null>(null);
  const [ovText, setOvText] = useState<string | null>(null);
  const [ovErr, setOvErr] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => {
    if (id) void styleUsage(db, id).then(setUsed);
  }, [db, id]);
  if (!s) return null;

  async function analyze() {
    const sample = s!.samples.find((x) => x.trim().length > 200);
    if (!sample) return setErr('Add a sample of at least a couple of paragraphs first.');
    setBusy(true);
    setErr(null);
    try {
      let text = '';
      for await (const ev of client.stream({ apiKey, model: defaults.models.helper, messages: styleFromSamplePrompt(sample), params: { temperature: 0.2, topP: 0.9, maxTokens: 600, reasoning: false }, zdr: defaults.zdr })) {
        if (ev.type === 'text') text += ev.text ?? '';
        if (ev.type === 'error') throw new Error(ev.error);
      }
      const j = JSON.parse(text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()) as Partial<Style>;
      update({ pointOfView: j.pointOfView ?? s!.pointOfView, tense: j.tense ?? s!.tense, proseDensity: j.proseDensity ?? s!.proseDensity, dialogueRatio: j.dialogueRatio ?? s!.dialogueRatio, register: (['clinical', 'euphemistic', 'blunt'] as const).includes(j.register as never) ? j.register! : s!.register, vocabulary: j.vocabulary ?? s!.vocabulary, influences: j.influences ?? s!.influences, bannedPhrases: Array.isArray(j.bannedPhrases) ? j.bannedPhrases.map(String) : s!.bannedPhrases });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      <Section title="Voice" right={<Button small kind="ghost" icon="time-outline" title="History" onPress={() => setHistoryOpen(true)} />}>
        <Field label="Name" value={s.name} onChangeText={(v) => update({ name: v })} />
        {used != null ? <T v="faint">{used === 0 ? 'Not used by any story yet.' : used === 1 ? 'Used by one story. Changes here reach it on its next passage.' : `Shared by ${used} stories. Changes here reach all of them on their next passage.`}</T> : null}
      </Section>

      <Section title="Card">
        <T v="faint">Sent to the writer as a card. Leave a line empty to say nothing about it.</T>
        <Field label="Point of view" value={s.pointOfView} onChangeText={(v) => update({ pointOfView: v })} placeholder="Third close on the viewpoint character; or first; or omniscient" />
        <Field label="Tense" value={s.tense} onChangeText={(v) => update({ tense: v })} placeholder="Past / present" />
        <Field label="Prose density" value={s.proseDensity} onChangeText={(v) => update({ proseDensity: v })} placeholder="Lean, lush, medium…" />
        <Field label="Dialogue ratio" value={s.dialogueRatio} onChangeText={(v) => update({ dialogueRatio: v })} placeholder="Sparse, balanced, dialogue-driven" />
        <View style={{ gap: 6 }}>
          <T v="label">Register</T>
          <Segmented value={s.register} onChange={(v) => update({ register: v })} options={[{ key: 'clinical', label: 'Clinical' }, { key: 'euphemistic', label: 'Euphemistic' }, { key: 'blunt', label: 'Blunt' }]} />
          <T v="faint">How bodies and acts are named. Applies everywhere, not only to sex.</T>
        </View>
        <Field label="Vocabulary" value={s.vocabulary} onChangeText={(v) => update({ vocabulary: v })} multiline placeholder="Words to favor, words to avoid, period flavor…" />
        <Field label="Influences" hint="Writers whose voice this draws on. Sent to the writer as-is." value={s.influences} onChangeText={(v) => update({ influences: v })} placeholder="e.g. Annie Proulx for weather, early McCarthy for violence" multiline />
        <View style={{ gap: 6 }}>
          <T v="label">Repetition control</T>
          <Segmented value={s.repetition} onChange={(v) => update({ repetition: v })} options={[{ key: 'off', label: 'Off' }, { key: 'light', label: 'Light' }, { key: 'medium', label: 'Medium' }, { key: 'strong', label: 'Strong' }]} />
          <T v="faint">Applied through the sampler, mostly as a presence penalty; nothing about it enters the prompt. If a passage ever collapses into a run-on sentence, set this to Off.</T>
        </View>
        <Field label="Never use" hint="Comma separated. Also feeds the voice check." value={s.bannedPhrases.join(', ')} onChangeText={(v) => update({ bannedPhrases: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
      </Section>

      <Section title="Sample passages" right={<Button small kind="outline" title="Analyze" onPress={analyze} loading={busy} />}>
        <T v="faint">Sent as examples of the voice. Analyze fills the card from the first long sample.</T>
        {s.samples.map((p, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <Field multiline value={p} onChangeText={(v) => update({ samples: s.samples.map((x, j) => (j === i ? v : x)) })} style={{ flex: 1, fontFamily: serif, minHeight: 120 }} />
            <IconButton name="close" onPress={() => update({ samples: s.samples.filter((_, j) => j !== i) })} />
          </Row>
        ))}
        <Button kind="ghost" icon="add" title="Add sample" onPress={() => update({ samples: [...s.samples, ''] })} />
      </Section>

      <Section title="Writer prompt" right={!s.system ? <Button small kind="ghost" title={showPrompt ? 'Hide default' : 'Show default'} onPress={() => setShowPrompt(!showPrompt)} /> : undefined}>
        {!s.system ? <T v="faint">Empty: the app’s default writer prompt is used (Settings → Prompt templates). Write one here to replace it entirely, or use the prompt lab from a story to have a strong model draft one.</T> : null}
        {!s.system && showPrompt ? <T v="mono" style={{ fontSize: 12 }}>{templates.craft}</T> : null}
        <Field label="System" value={s.system} onChangeText={(v) => update({ system: v })} multiline style={{ minHeight: 160 }} placeholder="Leave empty for the default" />
        <Field label="Post-history" hint="Sent last, as a user turn, after the manuscript. A short reminder of what to do now works best here." value={s.postHistory} onChangeText={(v) => update({ postHistory: v })} multiline placeholder="e.g. Continue with the next passage. Prose only." />
        <Field label="Prefill" hint="Starts the assistant's reply. Kept as part of the passage. Not every provider honors it." value={s.prefill} onChangeText={(v) => update({ prefill: v })} multiline />
      </Section>

      <ChainEditor chain={s.refusalChain} onChange={(refusalChain) => update({ refusalChain })} />

      <Section title="Delivery">
        <SwitchRow label="System prompt as first user turn" hint="Some providers water down or ignore the system role. This sends it as the opening exchange instead." value={s.systemAsUser} onChange={(v) => update({ systemAsUser: v })} />
        <Field label="Avoid providers" hint="OpenRouter provider slugs, comma separated. Use it to skip providers that add moderation on top of the model." value={s.providerIgnore.join(', ')} onChangeText={(v) => update({ providerIgnore: v.split(',').map((x) => x.trim()).filter(Boolean) })} autoCapitalize="none" autoCorrect={false} placeholder="e.g. azure, openai" />
        <Field label="Prefer providers" hint="Tried first, in this order." value={s.providerOrder.join(', ')} onChangeText={(v) => update({ providerOrder: v.split(',').map((x) => x.trim()).filter(Boolean) })} autoCapitalize="none" autoCorrect={false} placeholder="e.g. together, deepinfra" />
        <T v="label">Per-model overrides</T>
        <T v="faint">JSON keyed by model id or prefix ending in *, with any of system, prefill, postHistory.</T>
        <Field multiline value={ovText ?? JSON.stringify(s.modelOverrides, null, 2)} onChangeText={(v) => { setOvText(v); try { update({ modelOverrides: JSON.parse(v) }); setOvErr(false); } catch { setOvErr(true); } }} style={{ fontFamily: 'monospace', minHeight: 80 }} autoCapitalize="none" autoCorrect={false} />
        {ovErr ? <T v="faint" style={{ color: '#E06C75' }}>Not valid JSON yet; last valid value is kept.</T> : null}
      </Section>

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} kind="style" targetId={s.id} onRestore={(payload) => { try { const j = JSON.parse(payload) as Partial<Style>; const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = j; update(rest); } catch {} }} />
      <Button kind="danger" title="Delete voice" onPress={() => Alert.alert('Delete voice?', used ? `${used} stor${used === 1 ? 'y uses' : 'ies use'} it; they fall back to the default prompt.` : undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteStyle(db, s.id); router.back(); } }])} />
    </Screen>
  );
}
