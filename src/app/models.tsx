import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { ModelInfo } from '@/core/types';
import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';
import { patchSession, getSession } from '@/db/repo/sessions';
import { Badge, Button, Chip, Empty, Field, Row, T } from '@/ui/components';
import { space, useTheme } from '@/ui/theme';
import { kTokens } from '@/ui/format';

type Slot = 'writer' | 'summarizer' | 'helper';

export default function Models() {
  const { target, current } = useLocalSearchParams<{ target: string; current?: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const settings = useSettings();
  const sessionStore = useSession();
  const [q, setQ] = useState('');
  const [zdrOnly, setZdrOnly] = useState(false);
  const [reasoningOnly, setReasoningOnly] = useState(false);
  const [custom, setCustom] = useState('');

  const zdr = useMemo(() => new Set(settings.zdrIds), [settings.zdrIds]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return settings.models
      .filter((m) => (!zdrOnly || zdr.has(m.id)) && (!reasoningOnly || m.supportsReasoning) && (!needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [settings.models, q, zdrOnly, reasoningOnly, zdr]);

  async function choose(id: string) {
    const [kind, sid, slot] = (target ?? '').split(':');
    if (kind === 'default') await settings.setDefaults(db, { models: { ...settings.defaults.models, [sid as Slot]: id } });
    else if (kind === 'session' && sid && slot) {
      if (sessionStore.session?.id === sid) await sessionStore.patch({ models: { ...sessionStore.session.models, [slot as Slot]: id } });
      else {
        const s = await getSession(db, sid);
        if (s) await patchSession(db, sid, { models: { ...s.models, [slot]: id } });
      }
    }
    router.back();
  }

  const Item = ({ m }: { m: ModelInfo }) => {
    const isZ = zdr.has(m.id);
    const sel = m.id === current;
    return (
      <Pressable onPress={() => choose(m.id)} style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: space.lg, gap: 3, backgroundColor: sel ? t.surface2 : 'transparent', opacity: pressed ? 0.6 : 1 })}>
        <Row between>
          <T v="h" numberOfLines={1} style={{ flex: 1 }}>{m.name}</T>
          <Badge label={isZ ? 'ZDR' : 'no logging'} tone={isZ ? 'ok' : 'dim'} />
        </Row>
        <T v="faint" numberOfLines={1}>{m.id}</T>
        <Row gap={10}>
          <T v="small">{kTokens(m.contextLength)} ctx</T>
          <T v="small">${m.promptPricePerM.toFixed(2)} / ${m.completionPricePerM.toFixed(2)} per M</T>
          {m.supportsReasoning ? <T v="small">reasoning</T> : null}
        </Row>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Field value={q} onChangeText={setQ} placeholder="Search models" autoCapitalize="none" autoCorrect={false} autoFocus />
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="ZDR only" selected={zdrOnly} onPress={() => setZdrOnly(!zdrOnly)} />
          <Chip label="Reasoning" selected={reasoningOnly} onPress={() => setReasoningOnly(!reasoningOnly)} />
          <T v="faint">{list.length} models</T>
        </Row>
      </View>
      <FlatList
        data={list}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Item m={item} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ padding: space.lg, gap: space.md }}>
            {settings.models.length === 0 ? <Empty icon="cloud-download-outline" title="No model list cached" hint="Refresh the list in Settings, or type a model id below." /> : <T v="dim">No match.</T>}
            <Field label="Model id" value={custom} onChangeText={setCustom} placeholder="vendor/model" autoCapitalize="none" autoCorrect={false} />
            <Button title="Use this id" onPress={() => custom.trim() && choose(custom.trim())} disabled={!custom.trim()} />
          </View>
        }
        ListFooterComponent={
          settings.models.length ? (
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Field label="Or type a model id" value={custom} onChangeText={setCustom} placeholder="vendor/model" autoCapitalize="none" autoCorrect={false} />
              <Button title="Use this id" kind="outline" onPress={() => custom.trim() && choose(custom.trim())} disabled={!custom.trim()} />
            </View>
          ) : null
        }
      />
    </View>
  );
}
