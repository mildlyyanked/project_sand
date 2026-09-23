import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { runInForeground } from '@/state/foreground';
import { applyRepetition } from '@/core/repetition';
import { Banner, Button, Card, Chip, Field, Row, Screen, T } from '@/ui/components';
import { ModelPicker } from '@/ui/components/ModelPicker';
import { serif, useTheme } from '@/ui/theme';
import { shortModel, usd } from '@/ui/format';

interface Draft { model: string; text: string; done: boolean; error?: string; cost: number | null }

export default function Race() {
  const t = useTheme();
  const s = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  useEffect(() => {
    if (id && s.session?.id !== id) void s.open(db, id);
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { apiKey, defaults } = useSettings();
  const session = s.session;
  const used = useMemo(() => Array.from(new Set(s.beats.map((b) => b.model).filter((m): m is string => !!m))), [s.beats]);
  const candidates = useMemo(() => Array.from(new Set([session?.models.writer, defaults.models.writer, ...used].filter((m): m is string => !!m))), [session, defaults, used]);
  const [picked, setPicked] = useState<string[]>(session ? [session.models.writer] : []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState('');
  if (!session) return null;

  const toggle = (m: string) => setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : p.length < 3 ? [...p, m] : p));

  async function run() {
    const ctx = s.preview(direction.trim() || undefined);
    if (!ctx) return;
    setBusy(true);
    const init = picked.map((model) => ({ model, text: '', done: false, cost: null }));
    setDrafts(init);
    await runInForeground('Racing drafts', () => Promise.all(
      picked.map(async (model, i) => {
        const upd = (p: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));
        try {
          let text = '';
          for await (const ev of client.stream({ apiKey, model, messages: ctx.messages, params: applyRepetition(session!.params, s.bundle.style?.repetition), zdr: session!.zdr })) {
            if (ev.type === 'text') { text += ev.text ?? ''; upd({ text }); }
            if (ev.type === 'usage') upd({ cost: ev.usage?.costUsd ?? null });
            if (ev.type === 'error') throw new Error(ev.error);
          }
          upd({ done: true });
        } catch (e) {
          upd({ done: true, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    ));
    setBusy(false);
  }
  async function use(d: Draft) {
    await s.insertGenerated({ parentId: session!.currentBeatId, text: d.text.trim(), model: d.model, direction: direction.trim() || undefined, usage: d.cost != null ? { promptTokens: 0, completionTokens: 0, costUsd: d.cost } : null });
    router.back();
  }

  return (
    <Screen scroll>
      <T v="dim">Pick up to three models. Each writes the next passage from the same context. Keep the one you like; the rest are discarded.</T>
      <Row style={{ flexWrap: 'wrap', marginTop: 12 }}>
        {candidates.map((m) => <Chip key={m} label={shortModel(m)} selected={picked.includes(m)} onPress={() => toggle(m)} />)}
        {picked.filter((m) => !candidates.includes(m)).map((m) => <Chip key={m} label={shortModel(m)} selected onPress={() => toggle(m)} />)}
      </Row>
      <View style={{ marginTop: 12, gap: 8 }}>
        <Button small kind="outline" icon="add" title="Add another model" onPress={() => setPickerOpen(true)} disabled={picked.length >= 3} />
        <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(id) => toggle(id)} pinned={used} title="Add to the race" />
        <Field value={direction} onChangeText={setDirection} placeholder="Optional direction for this passage" />
        <Button title="Run" icon="flash-outline" onPress={run} loading={busy} disabled={picked.length === 0 || !apiKey} />
      </View>
      {drafts.map((d) => (
        <Card key={d.model} style={{ marginTop: 16, gap: 10 }}>
          <Row between>
            <T v="h">{shortModel(d.model)}</T>
            <T v="faint">{d.done ? (d.cost != null ? usd(d.cost) : 'done') : 'writing…'}</T>
          </Row>
          {d.error ? <Banner text={d.error} /> : null}
          <T style={{ fontFamily: serif, fontSize: 16, lineHeight: 25, color: t.text }}>{d.text}{!d.done ? '▍' : ''}</T>
          {d.done && d.text.trim() ? <Button title="Use this" onPress={() => use(d)} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
