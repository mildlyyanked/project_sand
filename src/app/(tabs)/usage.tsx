import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { ModelStat } from '@/core/types';
import { listModelStats } from '@/db/repo/library';
import { usageStats, type UsageStats } from '@/db/repo/sessions';
import { spendStats, type SpendStats } from '@/db/repo/spend';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { Card, Empty, ListItem, Row, Screen, Section, T } from '@/ui/components';
import { kTokens, shortModel, usd } from '@/ui/format';
import { useTheme } from '@/ui/theme';

/**
 * Spend and usage. Every generated beat records its model, tokens and the
 * cost OpenRouter reported; pictures and library work (Forge, reforge,
 * retcon, picture prompts) are booked in the spend ledger. Story helper calls
 * (plans, summaries, critiques, chronicle) show up only in the key total.
 */
export default function Usage() {
  const db = useSQLiteContext();
  const t = useTheme();
  const apiKey = useSettings((s) => s.apiKey);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [spend, setSpend] = useState<SpendStats | null>(null);
  const [ledger, setLedger] = useState<ModelStat[]>([]);
  const [key, setKey] = useState<{ usage: number; limit: number | null } | null | 'loading'>(null);

  useFocusEffect(
    useCallback(() => {
      void usageStats(db).then(setStats);
      void spendStats(db).then(setSpend).catch(() => setSpend(null));
      void listModelStats(db).then(setLedger);
      if (apiKey) {
        setKey('loading');
        void client.keyInfo(apiKey).then((i) => setKey(i ? { usage: i.usage, limit: i.limit } : null)).catch(() => setKey(null));
      }
    }, [db, apiKey]),
  );

  if (!stats) return <Screen><View /></Screen>;
  const { total } = stats;
  const today = new Date();
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Writer passages and the spend ledger, day by day.
  const days = new Map<string, { requests: number; costUsd: number; pictures: number }>();
  for (const d of stats.byDay) days.set(d.day, { requests: d.requests, costUsd: d.costUsd, pictures: 0 });
  for (const d of spend?.byDay ?? []) { const x = days.get(d.day) ?? { requests: 0, costUsd: 0, pictures: 0 }; days.set(d.day, { requests: x.requests, costUsd: x.costUsd + d.costUsd, pictures: x.pictures + d.requests }); }
  const byDay = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30).map(([day, v]) => ({ day, ...v }));
  const last7 = byDay.filter((d) => (today.getTime() - new Date(d.day).getTime()) / 86400000 < 7).reduce((n, d) => n + d.costUsd, 0);
  const todayCost = byDay.find((d) => d.day === dayKey(today))?.costUsd ?? 0;
  const kind = (k: 'image' | 'library') => spend?.byKind.find((x) => x.kind === k) ?? { requests: 0, costUsd: 0, unpriced: 0 };
  const pictures = kind('image');
  const library = kind('library');
  const allTime = total.costUsd + pictures.costUsd + library.costUsd;
  const sessionExtra = new Map((spend?.bySession ?? []).map((x) => [x.sessionId, x]));

  return (
    <Screen scroll>
      <Section title="Spend">
        <Card style={{ gap: 10 }}>
          <Row between>
            <View><T v="small">Today</T><T v="title">{usd(todayCost)}</T></View>
            <View><T v="small">Last 7 days</T><T v="title">{usd(last7)}</T></View>
            <View><T v="small">All time</T><T v="title">{usd(allTime)}</T></View>
          </Row>
          <Row between>
            <View><T v="small">Writing</T><T v="dim">{usd(total.costUsd)}</T></View>
            <View><T v="small">Pictures</T><T v="dim">{usd(pictures.costUsd)}{pictures.requests ? ` · ${pictures.requests}` : ''}</T></View>
            <View><T v="small">Library</T><T v="dim">{usd(library.costUsd)}{library.requests ? ` · ${library.requests}` : ''}</T></View>
          </Row>
          <T v="faint">As reported by OpenRouter per request. Pictures are illustrations, portraits, views and sigils{pictures.unpriced ? `; ${pictures.unpriced} came from a host that reports no price` : ''}. Library is Forge, reforge, retcon and picture prompts. Story helper calls (plans, summaries, chronicle) are small and not itemized.</T>
        </Card>
        {apiKey ? (
          <Card style={{ gap: 4 }}>
            <T v="label">OpenRouter key</T>
            {key === 'loading' ? <T v="faint">Checking…</T> : key ? <T v="dim">{usd(key.usage)} used{key.limit != null ? ` of ${usd(key.limit)} limit` : ', no limit set'}. Counts everything on the key, this app included.</T> : <T v="faint">OpenRouter did not answer for this key.</T>}
          </Card>
        ) : null}
      </Section>

      <Section title="Totals">
        <Card style={{ padding: 0, paddingHorizontal: 16 }}>
          <ListItem title="Passages generated" right={<T v="dim">{total.requests.toLocaleString()}</T>} chevron={false} />
          <ListItem title="Words on the page" right={<T v="dim">{total.words.toLocaleString()}</T>} chevron={false} />
          <ListItem title="Prompt tokens" subtitle="What the writer read" right={<T v="dim">{kTokens(total.promptTokens)}</T>} chevron={false} />
          <ListItem title="Completion tokens" subtitle="What the writer wrote" right={<T v="dim">{kTokens(total.completionTokens)}</T>} chevron={false} />
        </Card>
      </Section>

      <Section title="By model">
        {stats.byModel.length ? (
          <Card style={{ padding: 0, paddingHorizontal: 16 }}>
            {stats.byModel.map((m) => {
              const st = ledger.find((l) => l.model === m.model);
              return <ListItem key={m.model} title={shortModel(m.model)} subtitle={`${m.requests} passage${m.requests === 1 ? '' : 's'} · ${kTokens(m.promptTokens)} in · ${kTokens(m.completionTokens)} out${st ? ` · ${st.refusals} refusal${st.refusals === 1 ? '' : 's'} / ${st.attempts}` : ''}`} right={<T v="dim">{usd(m.costUsd)}</T>} chevron={false} />;
            })}
          </Card>
        ) : <Empty icon="hardware-chip-outline" title="Nothing generated yet" hint="Costs appear here after the first passage." />}
      </Section>

      {spend?.byModel.length ? (
        <Section title="Pictures and library">
          <Card style={{ padding: 0, paddingHorizontal: 16 }}>
            {spend.byModel.map((m) => <ListItem key={`${m.kind}:${m.model}`} title={shortModel(m.model)} subtitle={`${m.kind === 'image' ? 'pictures' : 'library'} · ${m.requests} request${m.requests === 1 ? '' : 's'}`} right={<T v="dim">{usd(m.costUsd)}</T>} chevron={false} />)}
          </Card>
        </Section>
      ) : null}

      <Section title="By story">
        {stats.bySession.length ? (
          <Card style={{ padding: 0, paddingHorizontal: 16 }}>
            {stats.bySession.map((s) => (
              <ListItem key={s.sessionId} title={s.title} subtitle={`${s.words.toLocaleString()} words · ${s.requests} passage${s.requests === 1 ? '' : 's'}${sessionExtra.get(s.sessionId) ? ` · ${sessionExtra.get(s.sessionId)!.requests} picture${sessionExtra.get(s.sessionId)!.requests === 1 ? '' : 's'}` : ''}`} right={<T v="dim">{usd(s.costUsd + (sessionExtra.get(s.sessionId)?.costUsd ?? 0))}</T>} onPress={() => router.push(`/session/${s.sessionId}`)} />
            ))}
          </Card>
        ) : null}
      </Section>

      <Section title="By day">
        {byDay.length ? (
          <Card style={{ padding: 0, paddingHorizontal: 16 }}>
            {byDay.map((d) => (
              <ListItem key={d.day} title={d.day} subtitle={[`${d.requests} passage${d.requests === 1 ? '' : 's'}`, d.pictures ? `${d.pictures} other` : ''].filter(Boolean).join(' · ')} right={<T style={{ color: t.dim }}>{usd(d.costUsd)}</T>} chevron={false} />
            ))}
          </Card>
        ) : null}
      </Section>
    </Screen>
  );
}
