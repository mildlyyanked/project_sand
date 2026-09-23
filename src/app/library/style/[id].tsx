import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Style } from '@/core/types';
import { deleteStyle, getStyle, saveStyle } from '@/db/repo/library';
import { styleFromSamplePrompt } from '@/core/helpers';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { useEntity } from '@/ui/useEntity';
import { Banner, Button, Field, IconButton, Row, Screen, Section, Segmented, T } from '@/ui/components';
import { serif } from '@/ui/theme';

export default function StyleEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { apiKey, defaults } = useSettings();
  const [s, update] = useEntity<Style>(() => getStyle(db, id!), (v) => saveStyle(db, v), [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
      <Section title="Card">
        <Field label="Name" value={s.name} onChangeText={(v) => update({ name: v })} />
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
          <T v="faint">Applied through the sampler, mostly as a presence penalty; nothing about it enters the prompt. Frequency penalties are kept tiny on purpose: over a long passage they strip out articles and punctuation. If a passage ever collapses into a run-on sentence, set this to Off.</T>
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
      <Button kind="danger" title="Delete style" onPress={() => Alert.alert('Delete style?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteStyle(db, s.id); router.back(); } }])} />
    </Screen>
  );
}
