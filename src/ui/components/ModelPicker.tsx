import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { ModelInfo } from '@/core/types';
import { useSettings } from '@/state/settings';
import { Badge, Button, Chip, Empty, Field, Row, Sheet, T } from './index';
import { space, useTheme } from '../theme';
import { kTokens, relTime, shortModel } from '../format';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  current?: string | null;
  title?: string;
  /** Ids to show first, e.g. models already used in the story. */
  pinned?: string[];
}

/**
 * The one way to choose a model anywhere in the app. Pulls the OpenRouter
 * catalog when it is missing or stale, and never asks for a typed id.
 */
export function ModelPicker({ open, onClose, onSelect, current, title = 'Choose model', pinned = [] }: Props) {
  const db = useSQLiteContext();
  const t = useTheme();
  const { models, zdrIds, modelsLoading, modelsError, modelsFetchedAt, apiKey, ensureModels } = useSettings();
  const [q, setQ] = useState('');
  const [zdrOnly, setZdrOnly] = useState(false);
  const [reasoningOnly, setReasoningOnly] = useState(false);
  useEffect(() => {
    if (open) void ensureModels(db);
  }, [open, db, ensureModels]);

  const zdr = useMemo(() => new Set(zdrIds), [zdrIds]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = models.filter((m) => (!zdrOnly || zdr.has(m.id)) && (!reasoningOnly || m.supportsReasoning) && (!needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)));
    const rank = (m: ModelInfo) => (m.id === current ? 0 : pinned.includes(m.id) ? 1 : 2);
    return filtered.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [models, q, zdrOnly, reasoningOnly, zdr, current, pinned]);

  const Item = ({ m }: { m: ModelInfo }) => {
    const isZ = zdr.has(m.id);
    const sel = m.id === current;
    return (
      <Pressable onPress={() => { onSelect(m.id); onClose(); }} style={({ pressed }) => ({ paddingVertical: 10, paddingHorizontal: 4, gap: 2, borderRadius: 10, backgroundColor: sel ? t.surface2 : 'transparent', opacity: pressed ? 0.6 : 1 })}>
        <Row between>
          <T v="h" numberOfLines={1} style={{ flex: 1 }}>{m.name}</T>
          {pinned.includes(m.id) && !sel ? <Badge label="used" tone="accent" /> : null}
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
    <Sheet open={open} onClose={onClose} title={title} full>
      <Field value={q} onChangeText={setQ} placeholder="Search models" autoCapitalize="none" autoCorrect={false} />
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip small label="ZDR only" selected={zdrOnly} onPress={() => setZdrOnly(!zdrOnly)} />
        <Chip small label="Reasoning" selected={reasoningOnly} onPress={() => setReasoningOnly(!reasoningOnly)} />
        <View style={{ flex: 1 }} />
        <T v="faint">{modelsLoading ? 'refreshing…' : modelsFetchedAt ? `${list.length} · ${relTime(modelsFetchedAt)}` : `${list.length}`}</T>
        <Button small kind="ghost" title="Refresh" onPress={() => ensureModels(db, { force: true })} loading={modelsLoading} disabled={!apiKey} />
      </Row>
      {modelsError ? <T v="faint" style={{ color: t.danger }}>{modelsError}</T> : null}
      {!apiKey ? <Empty icon="key-outline" title="No API key" hint="Add your OpenRouter key in Settings to load the model list." /> : null}
      {apiKey && !models.length && !modelsLoading ? <Empty icon="cloud-download-outline" title="No models yet" hint="Tap Refresh to load the catalog." /> : null}
      <FlatList data={list} keyExtractor={(m) => m.id} renderItem={({ item }) => <Item m={item} />} scrollEnabled={false} keyboardShouldPersistTaps="handled" ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.border }} />} />
      {current ? <T v="faint" style={{ marginTop: space.sm }}>Current: {shortModel(current)}</T> : null}
    </Sheet>
  );
}
