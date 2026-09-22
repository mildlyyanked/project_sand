import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Session } from '@/core/types';
import { blankSession, copySession, deleteSession, listSessions, sessionStats, upsertSession } from '@/db/repo/sessions';
import { useSettings } from '@/state/settings';
import { Badge, Card, Empty, IconButton, Ionicons, MenuItem, Row, Sheet, T } from '@/ui/components';
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

  const load = useCallback(async () => {
    const [s, tpl] = await Promise.all([listSessions(db), listSessions(db, { templates: true })]);
    setSessions(s);
    setTemplates(tpl);
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
    const s = blankSession({ models: defaults.models, zdr: defaults.zdr, presetId: defaults.presetId, styleId: defaults.styleId });
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

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Row gap={0}>
              <IconButton name="library-outline" onPress={() => router.push('/library')} />
              <IconButton name="settings-outline" onPress={() => router.push('/settings')} badge={!apiKey} />
            </Row>
          ),
        }}
      />
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, flexGrow: 1 }}
        ListEmptyComponent={<Empty icon="book-outline" title="No stories yet" hint={apiKey ? 'Tap + to start one.' : 'Add your OpenRouter key in Settings, then tap + to start.'} />}
        ListFooterComponent={sessions.length ? <T v="faint" style={{ textAlign: 'center', marginTop: 8 }}>Hold a story for options</T> : null}
        renderItem={({ item }) => {
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
        <MenuItem icon="document-outline" label="Blank" hint="Start from nothing" onPress={createBlank} />
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
