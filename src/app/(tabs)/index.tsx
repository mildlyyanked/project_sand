import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Session, Universe } from '@/core/types';
import type { WorldInstance } from '@/core/world/types';
import { blankSession, copySession, listSessions, sessionStats, upsertSession } from '@/db/repo/sessions';
import { listUniverses } from '@/db/repo/library';
import { defaultWorldId, listInstances, primeInstance } from '@/db/repo/world';
import { useSettings } from '@/state/settings';
import { Card, Empty, Ionicons, MenuItem, Row, Sheet, T } from '@/ui/components';
import { StoryCard, useStoryMenu } from '@/ui/components/Stories';
import { Avatar } from '@/ui/components/EntryImage';
import { appVersion } from '@/ui/version';
import { radius, space, useTheme } from '@/ui/theme';
import { relTime, shortModel } from '@/ui/format';

/**
 * Stories, by world. The real world is one folder of stories; every other
 * world opens onto its instances, each a run of chapters with a shared
 * memory. The most recent stories stay one tap away at the top.
 */
export default function Home() {
  const db = useSQLiteContext();
  const t = useTheme();
  const defaults = useSettings((s) => s.defaults);
  const apiKey = useSettings((s) => s.apiKey);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [templates, setTemplates] = useState<Session[]>([]);
  const [stats, setStats] = useState<Record<string, { words: number; cost: number }>>({});
  const [sheet, setSheet] = useState(false);
  const [worlds, setWorlds] = useState<Universe[]>([]);
  const [instances, setInstances] = useState<WorldInstance[]>([]);

  const load = useCallback(async () => {
    const [s, tpl, w, inst] = await Promise.all([listSessions(db), listSessions(db, { templates: true }), listUniverses(db), listInstances(db)]);
    setSessions(s);
    setTemplates(tpl);
    setWorlds(w);
    setInstances(inst);
    const st: Record<string, { words: number; cost: number }> = {};
    await Promise.all(s.slice(0, 3).map(async (x) => (st[x.id] = await sessionStats(db, x.id))));
    setStats(st);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const menu = useStoryMenu(db, () => void load());

  async function createBlank() {
    // Plain writing in the real world: no world context, no continuity, no chronicle.
    const real = await defaultWorldId(db);
    const inst = real ? await primeInstance(db, real, 'Our world') : null;
    const s = blankSession({ models: defaults.models, zdr: defaults.zdr, styleId: defaults.styleId, universeId: real, instanceId: inst?.id ?? null });
    await upsertSession(db, s);
    setSheet(false);
    router.push(`/session/${s.id}`);
  }
  async function fromTemplate(tpl: Session) {
    const s = await copySession(db, tpl.id, { title: tpl.title.replace(/ template$/i, ''), withBeats: false });
    setSheet(false);
    if (s) router.push(`/session/${s.id}`);
  }

  const realId = worlds.find((w) => w.isDefault)?.id ?? null;
  const worldOf = (s: Session) => s.universeId ?? realId;
  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const folders = worlds
    .map((w) => {
      const mine = sessions.filter((s) => worldOf(s) === w.id);
      const insts = instances.filter((i) => i.universeId === w.id && mine.some((s) => s.instanceId === i.id));
      return { w, stories: mine, instances: insts, last: mine.reduce((m, s) => Math.max(m, s.updatedAt), 0) };
    })
    .filter((f) => f.stories.length || f.w.isDefault)
    .sort((a, b) => Number(b.w.isDefault) - Number(a.w.isDefault) || b.last - a.last);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={folders}
        keyExtractor={(f) => f.w.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: recent.length ? space.sm : 0 }}>
            {recent.length ? (
              <>
                <T v="label">Recent</T>
                {recent.map((s) => <StoryCard key={s.id} s={s} words={stats[s.id]?.words} onHold={menu.hold} />)}
                <T v="label" style={{ marginTop: space.sm }}>Worlds</T>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Empty icon="book-outline" title="No stories yet" hint={apiKey ? 'Tap + to start one.' : 'Add your OpenRouter key in Settings, then tap + to start.'} />}
        ListFooterComponent={<T v="small" style={{ textAlign: 'center', marginTop: 8, opacity: 0.6 }}>{sessions.length ? 'Hold a story for options · ' : ''}{appVersion()}</T>}
        renderItem={({ item: f }) => (
          <Card onPress={() => router.push(`/stories/${f.w.id}`)} style={{ gap: 6 }}>
            <Row gap={10}>
              {f.w.isDefault ? <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="earth-outline" size={20} color={t.dim} /></View> : <Avatar data={f.w.data as unknown as Record<string, unknown>} name={f.w.name} size={36} />}
              <View style={{ flex: 1 }}>
                <T v="h" numberOfLines={1}>{f.w.name}</T>
                <T v="faint" numberOfLines={1}>
                  {f.stories.length} {f.stories.length === 1 ? 'story' : 'stories'}
                  {!f.w.isDefault && f.instances.length ? ` · ${f.instances.length} ${f.instances.length === 1 ? 'instance' : 'instances'}` : ''}
                  {f.last ? ` · ${relTime(f.last)}` : ''}
                </T>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.faint} />
            </Row>
            {f.stories.length ? <T v="small" numberOfLines={1}>Latest: {[...f.stories].sort((a, b) => b.updatedAt - a.updatedAt)[0]!.title}</T> : null}
          </Card>
        )}
      />
      <Pressable onPress={() => setSheet(true)} style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: 28, width: 58, height: 58, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1, elevation: 6 })}>
        <Ionicons name="add" size={30} color={t.accentText} />
      </Pressable>
      {menu.sheet}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="New story">
        <MenuItem icon="document-outline" label="Blank" hint="Plain writing in the real world: just the story" onPress={createBlank} />
        <MenuItem icon="planet-outline" label="In a world" hint="Pick a world and an instance; chapters share its memory" onPress={() => { setSheet(false); router.push('/start'); }} />
        <MenuItem icon="game-controller-outline" label="Play a character" hint="Be one person inside a world, on its map" onPress={() => { setSheet(false); router.push('/start?mode=pov'); }} />
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
