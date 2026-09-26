import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Preset, RefusalStep } from '@/core/types';
import { STEP_INFO } from '@/core/types';
import { deletePreset, getPreset, savePreset } from '@/db/repo/library';
import { useEntity } from '@/ui/useEntity';
import { Button, Card, Chip, Field, IconButton, Row, Screen, Section, SwitchRow, T } from '@/ui/components';
import { ModelPicker } from '@/ui/components/ModelPicker';
import { HistorySheet } from '@/ui/components/History';
import { shortModel } from '@/ui/format';

export default function PresetEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [p, update] = useEntity<Preset>(() => getPreset(db, id!), (v) => savePreset(db, v), [id]);
  const [ovText, setOvText] = useState<string | null>(null);
  const [ovErr, setOvErr] = useState(false);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!p) return null;

  const setStep = (i: number, step: RefusalStep) => update({ refusalChain: p.refusalChain.map((s, j) => (j === i ? step : s)) });
  const move = (i: number, d: -1 | 1) => {
    const c = [...p.refusalChain];
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j]!, c[i]!];
    update({ refusalChain: c });
  };
  const changeKind = (i: number, kind: RefusalStep['kind']): void => {
    if (kind === 'model') return setStep(i, { kind, model: 'auto' });
    if (kind === 'reframe' || kind === 'prefill') return setStep(i, { kind, text: '' });
    return setStep(i, { kind });
  };
  const KINDS = ['momentum', 'soften', 'twostep', 'heat', 'reframe', 'prefill', 'model'] as const;

  return (
    <Screen scroll>
      <Section title="Prompt" right={<Button small kind="ghost" icon="time-outline" title="History" onPress={() => setHistoryOpen(true)} />}>
        <Field label="Name" value={p.name} onChangeText={(v) => update({ name: v })} />
        <Field label="System" value={p.system} onChangeText={(v) => update({ system: v })} multiline style={{ minHeight: 160 }} />
        <Field label="Post-history" hint="Sent last, as a user turn, after the manuscript. Short reminders work best here." value={p.postHistory} onChangeText={(v) => update({ postHistory: v })} multiline />
        <Field label="Prefill" hint="Starts the assistant's reply. Kept as part of the passage. Not every provider honors it." value={p.prefill} onChangeText={(v) => update({ prefill: v })} multiline />
      </Section>
      <Section title="Persistence" right={<Button small kind="outline" icon="add" title="Step" onPress={() => update({ refusalChain: [...p.refusalChain, { kind: 'momentum' }] })} />}>
        <T v="faint">When a reply looks like a refusal, each step below is applied in order and the passage is retried. Steps stack: a later retry carries the earlier changes. Cheap steps first.</T>
        {p.refusalChain.map((s, i) => (
          <Card key={i} style={{ gap: 8 }}>
            <Row between>
              <T v="label">Step {i + 1}</T>
              <Row gap={0}>
                <IconButton name="chevron-up" size={16} onPress={() => move(i, -1)} disabled={i === 0} />
                <IconButton name="chevron-down" size={16} onPress={() => move(i, 1)} disabled={i === p.refusalChain.length - 1} />
                <IconButton name="trash-outline" size={18} onPress={() => update({ refusalChain: p.refusalChain.filter((_, j) => j !== i) })} />
              </Row>
            </Row>
            <Row style={{ flexWrap: 'wrap' }}>
              {KINDS.map((k) => <Chip key={k} small label={STEP_INFO[k].label} selected={s.kind === k} onPress={() => changeKind(i, k)} />)}
            </Row>
            <T v="faint">{STEP_INFO[s.kind].hint}</T>
            {s.kind === 'model' ? (
              <Row>
                <Chip small label="Auto from ledger" selected={s.model === 'auto'} onPress={() => setStep(i, { kind: 'model', model: 'auto' })} />
                <Chip small label={s.model && s.model !== 'auto' ? shortModel(s.model) : 'Pick a model'} selected={s.model !== 'auto' && !!s.model} onPress={() => setPickFor(i)} />
              </Row>
            ) : s.kind === 'reframe' || s.kind === 'prefill' ? (
              <Field value={s.text} onChangeText={(v) => setStep(i, { kind: s.kind, text: v })} multiline placeholder={s.kind === 'prefill' ? 'Text the reply must begin with' : 'Stronger framing to prepend'} autoCapitalize="none" />
            ) : null}
          </Card>
        ))}
      </Section>
      <Section title="Delivery">
        <SwitchRow label="System prompt as first user turn" hint="Some providers water down or ignore the system role. This sends it as the opening exchange instead." value={p.systemAsUser} onChange={(v) => update({ systemAsUser: v })} />
        <Field label="Avoid providers" hint="OpenRouter provider slugs, comma separated. Use it to skip providers that add moderation on top of the model." value={p.providerIgnore.join(', ')} onChangeText={(v) => update({ providerIgnore: v.split(',').map((x) => x.trim()).filter(Boolean) })} autoCapitalize="none" autoCorrect={false} placeholder="e.g. azure, openai" />
        <Field label="Prefer providers" hint="Tried first, in this order." value={p.providerOrder.join(', ')} onChangeText={(v) => update({ providerOrder: v.split(',').map((x) => x.trim()).filter(Boolean) })} autoCapitalize="none" autoCorrect={false} placeholder="e.g. together, deepinfra" />
      </Section>
      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} kind="preset" targetId={p.id} onRestore={(payload) => { try { const j = JSON.parse(payload) as { system?: string; postHistory?: string }; update({ system: j.system ?? p.system, postHistory: j.postHistory ?? p.postHistory }); } catch {} }} />
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
