import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Preset, RefusalStep } from '@/core/types';
import { deletePreset, getPreset, savePreset } from '@/db/repo/library';
import { useEntity } from '@/ui/useEntity';
import { Button, Card, Chip, Field, IconButton, Row, Screen, Section, T } from '@/ui/components';
import { ModelPicker } from '@/ui/components/ModelPicker';
import { shortModel } from '@/ui/format';

export default function PresetEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [p, update] = useEntity<Preset>(() => getPreset(db, id!), (v) => savePreset(db, v), [id]);
  const [ovText, setOvText] = useState<string | null>(null);
  const [ovErr, setOvErr] = useState(false);
  const [pickFor, setPickFor] = useState<number | null>(null);
  if (!p) return null;

  const setStep = (i: number, step: RefusalStep) => update({ refusalChain: p.refusalChain.map((s, j) => (j === i ? step : s)) });
  const stepText = (s: RefusalStep) => (s.kind === 'model' ? s.model : s.text);
  const changeKind = (i: number, kind: RefusalStep['kind']) => setStep(i, kind === 'model' ? { kind, model: '' } : { kind, text: '' });

  return (
    <Screen scroll>
      <Section title="Prompt">
        <Field label="Name" value={p.name} onChangeText={(v) => update({ name: v })} />
        <Field label="System" value={p.system} onChangeText={(v) => update({ system: v })} multiline style={{ minHeight: 160 }} />
        <Field label="Post-history" hint="Sent last, as a user turn, after the manuscript. Short reminders work best here." value={p.postHistory} onChangeText={(v) => update({ postHistory: v })} multiline />
        <Field label="Prefill" hint="Starts the assistant's reply. Kept as part of the passage. Not every provider honors it." value={p.prefill} onChangeText={(v) => update({ prefill: v })} multiline />
      </Section>
      <Section title="Refusal chain" right={<Button small kind="outline" icon="add" title="Step" onPress={() => update({ refusalChain: [...p.refusalChain, { kind: 'reframe', text: '' }] })} />}>
        <T v="faint">When a reply looks like a refusal, each step is applied in order and the passage is retried. Reframe prepends to the system prompt. Prefill replaces the prefill. Model switches the writer for the retry.</T>
        {p.refusalChain.map((s, i) => (
          <Card key={i} style={{ gap: 8 }}>
            <Row between>
              <Row>
                {(['reframe', 'prefill', 'model'] as const).map((k) => <Chip key={k} small label={k} selected={s.kind === k} onPress={() => changeKind(i, k)} />)}
              </Row>
              <IconButton name="trash-outline" size={18} onPress={() => update({ refusalChain: p.refusalChain.filter((_, j) => j !== i) })} />
            </Row>
            {s.kind === 'model' ? (
              <Button kind="outline" icon="hardware-chip-outline" title={s.model ? shortModel(s.model) : 'Choose fallback model'} onPress={() => setPickFor(i)} />
            ) : (
              <Field value={stepText(s)} onChangeText={(v) => setStep(i, { kind: s.kind, text: v })} multiline placeholder={s.kind === 'prefill' ? 'Text the reply must begin with' : 'Stronger framing to prepend'} autoCapitalize="none" />
            )}
          </Card>
        ))}
      </Section>
      <ModelPicker open={pickFor != null} onClose={() => setPickFor(null)} onSelect={(id) => { if (pickFor != null) setStep(pickFor, { kind: 'model', model: id }); }} current={pickFor != null && p.refusalChain[pickFor]?.kind === 'model' ? (p.refusalChain[pickFor] as { model: string }).model : null} title="Fallback model" />
      <Section title="Per-model overrides">
        <T v="faint">JSON keyed by model id or prefix ending in *, with any of system, prefill, postHistory.</T>
        <Field multiline value={ovText ?? JSON.stringify(p.modelOverrides, null, 2)} onChangeText={(v) => { setOvText(v); try { update({ modelOverrides: JSON.parse(v) }); setOvErr(false); } catch { setOvErr(true); } }} style={{ fontFamily: 'monospace', minHeight: 100 }} autoCapitalize="none" autoCorrect={false} />
        {ovErr ? <T v="faint" style={{ color: '#E06C75' }}>Not valid JSON yet; last valid value is kept.</T> : null}
      </Section>
      <View style={{ height: 8 }} />
      <Button kind="danger" title="Delete preset" onPress={() => Alert.alert('Delete preset?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deletePreset(db, p.id); router.back(); } }])} />
    </Screen>
  );
}
