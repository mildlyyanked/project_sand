import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import * as Clipboard from 'expo-clipboard';
import { transcriptOf } from '@/core/helpers';
import { Badge, Button, Card, Field, Ionicons, Row, Screen, Section, SwitchRow, T } from '@/ui/components';
import { space, useTheme } from '@/ui/theme';
import { kTokens, shortModel } from '@/ui/format';

export default function ContextInspector() {
  const t = useTheme();
  const s = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  useEffect(() => {
    if (id && s.session?.id !== id) void s.open(db, id);
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const models = useSettings((x) => x.models);
  const [open, setOpen] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const ctx = useMemo(() => s.preview(), [s.session, s.path, s.bundle, s.dropped]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s.session || !ctx) return null;
  const model = models.find((m) => m.id === s.session!.models.writer);
  const ratio = model?.contextLength ? ctx.totalTokens / model.contextLength : null;
  const lastProse = [...s.path].reverse().find((b) => b.role === 'prose' && b.model);

  return (
    <Screen scroll>
      <Card style={{ gap: 6, marginBottom: space.lg }}>
        <Row between>
          <T v="h">~{kTokens(ctx.totalTokens)} tokens next request</T>
          <T v="faint">{shortModel(s.session.models.writer)}</T>
        </Row>
        {ratio != null ? (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, ratio * 100)}%`, height: 6, backgroundColor: ratio > 0.8 ? t.danger : t.accent }} />
          </View>
        ) : null}
        <T v="faint">{model ? `${Math.round((ratio ?? 0) * 100)}% of ${kTokens(model.contextLength)} context` : 'Refresh the model list in Settings to see the context limit.'}</T>
      </Card>

      <Row style={{ marginBottom: space.lg, flexWrap: 'wrap' }}>
        <Button small kind="outline" icon="copy-outline" title="Copy as transcript" onPress={async () => { await Clipboard.setStringAsync(transcriptOf(ctx.messages)); s.setNotice('Copied. Paste it into any chat to compare like for like.'); }} />
        <Button small kind="outline" icon="code-slash-outline" title="Copy as JSON" onPress={async () => { await Clipboard.setStringAsync(JSON.stringify(ctx.messages, null, 2)); s.setNotice('Copied the messages array.'); }} />
      </Row>
      <Section title="Layers, in send order">
        <T v="faint">Switch a layer off to leave it out of the next request. Tap to read what will be sent.</T>
        {ctx.layers.map((l) => {
          const isBeat = l.key.startsWith('beat:');
          const forced = l.key === 'overflow';
          return (
            <Card key={l.key} style={{ padding: 0, opacity: l.dropped ? 0.55 : 1 }}>
              <Pressable onPress={() => setOpen(open === l.key ? null : l.key)} style={{ padding: space.md, gap: 4 }}>
                <Row between>
                  <Row style={{ flex: 1 }}>
                    <Badge label={l.role} tone={l.role === 'system' ? 'info' : l.role === 'assistant' ? 'accent' : 'dim'} />
                    <T numberOfLines={1} style={{ flex: 1 }}>{l.label}</T>
                  </Row>
                  <T v="faint">{kTokens(l.tokens)}</T>
                  {!isBeat && !forced ? (
                    <Pressable hitSlop={10} onPress={() => s.toggleDropped(l.key)}>
                      <Ionicons name={l.dropped ? 'eye-off-outline' : 'eye-outline'} size={20} color={l.dropped ? t.faint : t.text} />
                    </Pressable>
                  ) : null}
                </Row>
                {l.detail ? <T v="faint">{l.detail}</T> : null}
                {open === l.key ? <T v="mono" style={{ marginTop: 8 }} selectable>{l.text}</T> : <T v="faint" numberOfLines={2}>{l.text}</T>}
              </Pressable>
            </Card>
          );
        })}
      </Section>

      <Section title="Summary" right={<Button small kind="outline" title="Summarize now" onPress={() => s.summarizeNow()} loading={s.streaming?.phase === 'summarizing'} />}>
        <T v="faint">Older beats fold into this when they fall out of the recent window. Edit it freely; it is sent as the “story so far”.</T>
        <Field multiline value={summary ?? s.session.summary} onChangeText={setSummary} placeholder="No summary yet." style={{ minHeight: 140 }} />
        {summary != null && summary !== s.session.summary ? <Button title="Save summary" onPress={async () => { await s.patch({ summary }); setSummary(null); }} /> : null}
      </Section>

      <Section title="Strategy">
        <Row style={{ flexWrap: 'wrap' }}>
          <Badge label={`recent ${kTokens(s.session.strategy.recentBudget)}`} />
          <Badge label={`summary ${kTokens(s.session.strategy.summaryBudget)}`} />
          <Badge label={`lore ${kTokens(s.session.strategy.loreBudget)} · scan ${s.session.strategy.loreScanBeats}`} />
        </Row>
        <SwitchRow label="Zero data retention" hint="Only ZDR providers for this session" value={s.session.zdr} onChange={(v) => s.patch({ zdr: v })} />
      </Section>

      {s.lastLog.length ? (
        <Section title="Last assembly">
          {s.lastLog.map((l, i) => <T key={i} v="mono">{l}</T>)}
        </Section>
      ) : null}
      {ctx.log.length ? (
        <Section title="Next assembly">
          {ctx.log.map((l, i) => <T key={i} v="mono">{l}</T>)}
        </Section>
      ) : null}

      {lastProse ? (
        <Section title="Last generation">
          <Row style={{ flexWrap: 'wrap' }}>
            <Badge label={shortModel(lastProse.model ?? '')} tone="accent" />
            {lastProse.promptTokens != null ? <Badge label={`${kTokens(lastProse.promptTokens)} in · ${kTokens(lastProse.completionTokens ?? 0)} out`} /> : null}
            {lastProse.costUsd != null ? <Badge label={`$${lastProse.costUsd.toFixed(4)}`} /> : null}
            {lastProse.direction ? <Badge label={`direction: ${lastProse.direction}`} tone="info" /> : null}
          </Row>
          {lastProse.plan ? <Card><T v="label">Plan it followed</T><T v="dim" selectable style={{ marginTop: 6 }}>{lastProse.plan}</T></Card> : null}
          {lastProse.reasoning ? <Card><T v="label">Model reasoning</T><T v="mono" selectable style={{ marginTop: 6 }}>{lastProse.reasoning}</T></Card> : <T v="faint">No reasoning stream on this beat. Turn on reasoning in session settings for models that support it.</T>}
        </Section>
      ) : null}
    </Screen>
  );
}
