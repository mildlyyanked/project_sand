import React, { useState } from 'react';
import type { RefusalStep } from '@/core/types';
import { STEP_INFO } from '@/core/types';
import { Button, Card, Chip, Field, IconButton, Row, Section, T } from './index';
import { ModelPicker } from './ModelPicker';
import { shortModel } from '../format';

const KINDS = ['momentum', 'soften', 'twostep', 'heat', 'reframe', 'prefill', 'model', 'diagnose'] as const;

/** Ordered list of what to try when a reply looks like a refusal. */
export function ChainEditor({ chain, onChange }: { chain: RefusalStep[]; onChange: (c: RefusalStep[]) => void }) {
  const [pickFor, setPickFor] = useState<number | null>(null);
  const setStep = (i: number, step: RefusalStep) => onChange(chain.map((s, j) => (j === i ? step : s)));
  const move = (i: number, d: -1 | 1) => {
    const c = [...chain];
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j]!, c[i]!];
    onChange(c);
  };
  const changeKind = (i: number, kind: RefusalStep['kind']): void => {
    if (kind === 'model') return setStep(i, { kind, model: 'auto' });
    if (kind === 'reframe' || kind === 'prefill') return setStep(i, { kind, text: '' });
    return setStep(i, { kind });
  };
  return (
    <Section title="Persistence" right={<Button small kind="outline" icon="add" title="Step" onPress={() => onChange([...chain, { kind: 'momentum' }])} />}>
      <T v="faint">When a reply looks like a refusal, each step below is applied in order and the passage is retried. Steps stack: a later retry carries the earlier changes. Cheap steps first.</T>
      {chain.map((s, i) => (
        <Card key={i} style={{ gap: 8 }}>
          <Row between>
            <T v="label">Step {i + 1}</T>
            <Row gap={0}>
              <IconButton name="chevron-up" size={16} onPress={() => move(i, -1)} disabled={i === 0} />
              <IconButton name="chevron-down" size={16} onPress={() => move(i, 1)} disabled={i === chain.length - 1} />
              <IconButton name="trash-outline" size={18} onPress={() => onChange(chain.filter((_, j) => j !== i))} />
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
      <ModelPicker open={pickFor != null} onClose={() => setPickFor(null)} onSelect={(id) => { if (pickFor != null) setStep(pickFor, { kind: 'model', model: id }); }} current={pickFor != null && chain[pickFor]?.kind === 'model' ? (chain[pickFor] as { model: string }).model : null} title="Fallback model" />
    </Section>
  );
}
