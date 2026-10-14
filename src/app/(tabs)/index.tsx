import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Session, Universe } from '@/core/types';
import type { WorldInstance } from '@/core/world/types';
import { blankSession, copySession, deleteSession, listSessions, sessionStats, upsertSession } from '@/db/repo/sessions';
import { listUniverses } from '@/db/repo/library';
import { defaultWorldId, listInstances, primeInstance } from '@/db/repo/world';
import { useSettings } from '@/state/settings';
import { Badge, Card, Chip, Empty, Ionicons, MenuItem, Row, Sheet, T } from '@/ui/components';
import { appVersion } from '@/ui/version';
import { radius, space, useTheme } from '@/ui/theme';
import { relTime, shortModel } from '@/ui/format';

export default function Home() {
  const db = useSQLiteContext();
  const t = useTheme();
  const defaults = useSettings((s) => s.defaults);
  const apiKey = useSettings((s) => s.apiKey);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [templates, setTemplates] = useState<Session[]>([]);
  const [stats, setStats] = useState<Record<string, { words: number; cost: number }>>({});
  const [sheet, setSheet] = useState(false);
  const [held, setHeld] = useState<Session | null>(null);
  const [worlds, setWorlds] = useState<Universe[]>([]);
  const [instances, setInstances] = useState<WorldInstance[]>([]);
  const [worldFilter, setWorldFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, tpl, w, inst] = await Promise.all([listSessions(db), listSessions(db, { templates: true }), listUniverses(db), listInstances(db)]);
    setSessions(s);
    setTemplates(tpl);
    setWorlds(w);
    setInstances(inst);
    const st: Record<string, { words: number; cost: number }> = {};
    await Promise.all(s.map(async (x) => (st[x.id] = await sessionStats(db, x.id))));
    setStats(st);
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function createBlank() {
    // Plain writing in the real world: no world context, no continuity, no chronicle.
    const real = await defaultWorldId(db);
    const inst = real ? await primeInstance(db, real, 'Our world') : null;
    const s = blankSession({ models: defaults.models, zdr: defaults.zdr, styleId: defaults.styleId, universeId: real, instanceId: inst?.id ?? null });
    await upsertSession(db, s);
    setSheet(false);
    router.push(`/session/${s.id}`);
  }
  function confirmDelete(s: Session) {
    setHeld(null);
    Alert.alert(`Delete “${s.title}”?`, 'Every beat and branch goes with it. There is no undo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSession(db, s.id); await load(); } },
    ]);
  }
  async function duplicate(s: Session) {
    setHeld(null);
    const copy = await copySession(db, s.id, { title: `${s.title} copy`, withBeats: true });
    await load();
    if (copy) router.push(`/session/${copy.id}`);
  }
  async function fromTemplate(tpl: Session) {
    const s = await copySession(db, tpl.id, { title: tpl.title.replace(/ template$/i, ''), withBeats: false });
    setSheet(false);
    if (s) router.push(`/session/${s.id}`);
  }

  const worldName = (id: string | null) => worlds.find((w) => w.id === id)?.name ?? 'The real world';
  const instName = (id: string | null) => { const i = instances.find((x) => x.id === id); return i && !i.isPrime ? i.name : ''; };
  const realId = worlds.find((w) => w.isDefault)?.id ?? null;
  const shown = sessions.filter((x) => !worldFilter || (x.universeId ?? realId) === worldFilter);
  const groups = new Map<string, Session[]>();
  for (const x of shown) { const k = x.universeId ?? realId ?? ''; groups.set(k, [...(groups.get(k) ?? []), x]); }
  const rows: ({ kind: 'header'; id: string; name: string; count: number } | { kind: 'story'; s: Session })[] = [];
  for (const [k, list] of groups) {
    if (groups.size > 1 || worldFilter) rows.push({ kind: 'header', id: k, name: worldName(k), count: list.length });
    for (const x of list) rows.push({ kind: 'story', s: x });
  }
  const usedWorlds = worlds.filter((w) => sessions.some((x) => (x.universeId ?? realId) === w.id));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {usedWorlds.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Chip small label="All worlds" selected={!worldFilter} onPress={() => setWorldFilter(null)} />
          {usedWorlds.map((w) => <Chip key={w.id} small label={w.name} selected={worldFilter === w.id} onPress={() => setWorldFilter(worldFilter === w.id ? null : w.id)} />)}
        </ScrollView>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'header' ? `h:${r.id}` : r.s.id)}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, flexGrow: 1 }}
        ListEmptyComponent={<Empty icon="book-outline" title="No stories yet" hint={apiKey ? 'Tap + to start one.' : 'Add your OpenRouter key in Settings, then tap + to start.'} />}
        ListFooterComponent={<T v="small" style={{ textAlign: 'center', marginTop: 8, opacity: 0.6 }}>{sessions.length ? 'Hold a story for options · ' : ''}{appVersion()}</T>}
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <Pressable onPress={() => row.id && router.push(`/library/universe/${row.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Ionicons name="planet-outline" size={14} color={t.dim} />
                <T v="label">{row.name}</T>
                <T v="faint">· {row.count}</T>
              </Pressable>
            );
          }
          const item = row.s;
          const st = stats[item.id];
          return (
            <Card onPress={() => router.push(`/session/${item.id}`)} onLongPress={() => setHeld(item)} style={{ gap: 6 }}>
              <Row between>
                <T v="h" numberOfLines={1} style={{ flex: 1 }}>
                  {item.title}
                </T>
                <T v="faint">{relTime(item.updatedAt)}</T>
              </Row>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                <T v="faint">{shortModel(item.models.writer)}</T>
                {st ? <T v="faint">· {st.words.toLocaleString()} words</T> : null}
                {item.mode === 'pov' ? <Badge label="played" tone="accent" /> : null}
                {instName(item.instanceId) ? <Badge label={instName(item.instanceId)} tone="info" /> : null}
                {item.explicit ? <Badge label="explicit" tone="warn" /> : null}
                {item.zdr ? <Badge label="ZDR" tone="ok" /> : null}
                {item.variantOf ? <Badge label="variant" tone="info" /> : null}
              </Row>
              {item.variantNote ? <T v="faint" numberOfLines={1}>{item.variantNote}</T> : null}
            </Card>
          );
        }}
      />
      <Pressable onPress={() => setSheet(true)} style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: 28, width: 58, height: 58, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1, elevation: 6 })}>
        <Ionicons name="add" size={30} color={t.accentText} />
      </Pressable>
      <Sheet open={!!held} onClose={() => setHeld(null)} title={held?.title}>
        {held ? (
          <>
            <MenuItem icon="open-outline" label="Open" onPress={() => { setHeld(null); router.push(`/session/${held.id}`); }} />
            <MenuItem icon="options-outline" label="Session settings" onPress={() => { setHeld(null); router.push(`/session/${held.id}/settings`); }} />
            <MenuItem icon="copy-outline" label="Duplicate" onPress={() => duplicate(held)} />
            <MenuItem icon="trash-outline" label="Delete story" danger onPress={() => confirmDelete(held)} />
          </>
        ) : null}
      </Sheet>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="New story">
        <MenuItem icon="document-outline" label="Blank" hint="Plain writing in the real world: just the story" onPress={createBlank} />
        <MenuItem icon="planet-outline" label="In a world" hint="Pick a world and a version of it; share its timeline" onPress={() => { setSheet(false); router.push('/start'); }} />
        <MenuItem icon="game-controller-outline" label="Play a character" hint="Be one person inside a world: tests, needs, inventory" onPress={() => { setSheet(false); router.push('/start?mode=pov'); }} />
        <MenuItem icon="chatbubbles-outline" label="Workshop it" hint="Talk it through with an editor until a premise lands" onPress={() => { setSheet(false); router.push('/new'); }} />
        {templates.length ? (
          <View style={{ marginTop: space.md, gap: 4 }}>
            <T v="label">From template</T>
            {templates.map((tpl) => (
              <MenuItem key={tpl.id} icon="copy-outline" label={tpl.title} hint={[tpl.variantNote, shortModel(tpl.models.writer)].filter(Boolean).join(' · ')} onPress={() => fromTemplate(tpl)} />
            ))}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
