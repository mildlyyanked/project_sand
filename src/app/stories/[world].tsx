import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Session, Universe } from '@/core/types';
import type { WorldInstance } from '@/core/world/types';
import type { InstanceMemory } from '@/core/world/memory';
import { chapterOrder } from '@/core/world/memory';
import { listSessions, sessionStats } from '@/db/repo/sessions';
import { getUniverse } from '@/db/repo/library';
import { listInstances, newInstance, saveInstance } from '@/db/repo/world';
import { loadMemory } from '@/db/repo/memory';
import { newChapter } from '@/state/memory';
import { useSettings } from '@/state/settings';
import { Banner, Button, Empty, IconButton, Ionicons, Row, T } from '@/ui/components';
import { StoryCard, useStoryMenu } from '@/ui/components/Stories';
import { space, useTheme } from '@/ui/theme';

/**
 * A world's stories. The real world is a plain folder. Any other world shows
 * its instances, each a run of chapters in the order they start in the world,
 * with what its memory holds and a way to write the next chapter.
 */
export default function WorldStories() {
  const { world } = useLocalSearchParams<{ world: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const apiKey = useSettings((s) => s.apiKey);
  const [u, setU] = useState<Universe | null>(null);
  const [stories, setStories] = useState<Session[]>([]);
  const [instances, setInstances] = useState<WorldInstance[]>([]);
  const [memory, setMemory] = useState<Record<string, InstanceMemory>>({});
  const [words, setWords] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!world) return;
    const [uni, all, inst] = await Promise.all([getUniverse(db, world), listSessions(db), listInstances(db, world)]);
    setU(uni);
    const mine = all.filter((s) => s.universeId === world);
    setStories(mine);
    setInstances(inst);
    const mem: Record<string, InstanceMemory> = {};
    for (const i of inst) mem[i.id] = await loadMemory(db, i.id);
    setMemory(mem);
    const w: Record<string, number> = {};
    await Promise.all(mine.map(async (s) => (w[s.id] = (await sessionStats(db, s.id)).words)));
    setWords(w);
  }, [db, world]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const menu = useStoryMenu(db, () => void load());

  async function next(i: WorldInstance) {
    setErr(null);
    setBusy(`${i.id}:start`);
    try {
      const s = await newChapter(db, i.id, { apiKey, onKeeping: (title) => setBusy(`${i.id}:${title}`) });
      router.push(`/session/${s.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function addInstance() {
    const i = newInstance(world!, `Instance ${instances.length + 1}`);
    await saveInstance(db, i);
    router.push(`/world/instance/${i.id}`);
  }

  if (!u) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  const loose = stories.filter((s) => !s.instanceId || !instances.some((i) => i.id === s.instanceId));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: u.isDefault ? 'The real world' : u.name, headerRight: () => (!u.isDefault ? <IconButton name="planet-outline" onPress={() => router.push(`/library/universe/${u.id}`)} /> : null) }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}>
        {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
        {u.isDefault ? (
          stories.length ? [...stories].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => <StoryCard key={s.id} s={s} words={words[s.id]} onHold={menu.hold} />)
            : <Empty icon="book-outline" title="No stories here yet" hint="Blank stories from the + on Stories land here." />
        ) : (
          <>
            {instances.map((i) => {
              const chapters = chapterOrder(stories.filter((s) => s.instanceId === i.id));
              const m = memory[i.id];
              const keeping = busy?.startsWith(`${i.id}:`) ? busy.slice(i.id.length + 1) : null;
              return (
                <View key={i.id} style={{ gap: space.sm }}>
                  <Row between>
                    <Row gap={6} style={{ flex: 1 }}>
                      <Ionicons name="git-branch-outline" size={15} color={t.accent} />
                      <T v="label" numberOfLines={1} style={{ flexShrink: 1 }} onPress={() => router.push(`/world/instance/${i.id}`)}>{i.name}{i.isPrime ? ' · prime' : ''}</T>
                    </Row>
                    <Button small kind="ghost" icon="library-outline" title="Memory" onPress={() => router.push(`/world/instance/${i.id}`)} />
                  </Row>
                  {i.description ? <T v="faint">{i.description}</T> : null}
                  {chapters.map((s, n) => <StoryCard key={s.id} s={s} chapter={n + 1} words={words[s.id]} onHold={menu.hold} />)}
                  {m && (m.recaps.length || m.people.length || m.entries.length) ? (
                    <T v="small">Remembers {m.recaps.length} {m.recaps.length === 1 ? 'chapter' : 'chapters'} · {m.people.length} {m.people.length === 1 ? 'person' : 'people'} · {m.entries.length} only here</T>
                  ) : chapters.length ? <T v="faint">Nothing remembered yet: ending a chapter, or starting the next, writes it into memory.</T> : null}
                  <Button small kind="outline" icon="add" title={keeping ? (keeping === 'start' ? 'Starting…' : `Remembering ${keeping}…`) : chapters.length ? `Chapter ${chapters.length + 1}` : 'First chapter'} loading={!!keeping} disabled={!!busy} onPress={() => void next(i)} />
                </View>
              );
            })}
            {loose.length ? (
              <View style={{ gap: space.sm }}>
                <T v="label">Not in an instance</T>
                {loose.map((s) => <StoryCard key={s.id} s={s} words={words[s.id]} onHold={menu.hold} />)}
              </View>
            ) : null}
            <Button kind="ghost" icon="git-branch-outline" title="New instance" onPress={() => void addInstance()} />
            <T v="faint">An instance is one version of this world. Its chapters share a timeline and a memory: what happened, who knows what, who stands where. Canon (the world’s lore) is shared by every instance.</T>
          </>
        )}
      </ScrollView>
      {menu.sheet}
    </View>
  );
}
