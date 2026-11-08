import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import { awaiting, type Job } from '@/core/jobs';
import { listUniverses } from '@/db/repo/library';
import { useJobs } from '@/state/jobs';
import { Button, Chip, Screen, Section, T } from '@/ui/components';
import { InboxList, ProposalSheet } from '@/ui/components/Proposals';
import { space } from '@/ui/theme';

const shown = (j: Job) => j.kind !== 'question' && j.status !== 'cancelled' && (awaiting(j) || j.status === 'queued' || j.status === 'running' || j.status === 'failed');

/**
 * Everything the helpers have written and are writing, across every world:
 * what waits on a decision first, then what is still running, then what
 * failed. Open one to read it, change it, accept it or let it go.
 */
export default function Inbox() {
  const db = useSQLiteContext();
  const { world } = useLocalSearchParams<{ world?: string }>();
  const [filter, setFilter] = useState<string | 'all'>(world ?? 'all');
  const [open, setOpen] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<Universe[]>([]);
  const jobs = useJobs((s) => s.jobs);
  useFocusEffect(useCallback(() => { void useJobs.getState().refresh(db); void listUniverses(db).then(setWorlds); }, [db]));
  const all = useMemo(() => jobs.filter(shown), [jobs]);
  const inFilter = all.filter((j) => filter === 'all' || (filter === 'voices' ? !j.universeId : j.universeId === filter));
  const groups: { key: string; name: string; jobs: Job[] }[] = useMemo(() => {
    const out: { key: string; name: string; jobs: Job[] }[] = [];
    for (const j of inFilter) {
      const key = j.universeId ?? 'voices';
      const name = j.universeId ? worlds.find((u) => u.id === j.universeId)?.name ?? 'A world' : 'Voices';
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, name, jobs: [] }; out.push(g); }
      g.jobs.push(j);
    }
    for (const g of out) g.jobs.sort((a, b) => Number(awaiting(b)) - Number(awaiting(a)) || b.updatedAt - a.updatedAt);
    return out.sort((a, b) => b.jobs.filter(awaiting).length - a.jobs.filter(awaiting).length);
  }, [inFilter, worlds]);
  const counts = (key: string) => all.filter((j) => (key === 'voices' ? !j.universeId : j.universeId === key) && awaiting(j)).length;
  const keys = [...new Set(all.map((j) => j.universeId ?? 'voices'))];
  const failed = inFilter.filter((j) => j.status === 'failed');

  return (
    <Screen scroll>
      {keys.length > 1 || filter !== 'all' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: space.md }}>
          <Chip label={`Everything · ${all.filter(awaiting).length}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
          {keys.map((k) => <Chip key={k} label={`${k === 'voices' ? 'Voices' : worlds.find((u) => u.id === k)?.name ?? 'A world'}${counts(k) ? ` · ${counts(k)}` : ''}`} selected={filter === k} onPress={() => setFilter(k)} />)}
        </ScrollView>
      ) : null}
      {groups.length ? groups.map((g) => (
        <Section key={g.key} title={`${g.name}${g.jobs.filter(awaiting).length ? ` · ${g.jobs.filter(awaiting).length} waiting` : ''}`}>
          <InboxList jobs={g.jobs} onOpen={setOpen} />
        </Section>
      )) : (
        <View style={{ gap: 8, paddingTop: space.lg }}>
          <T v="h">Nothing waiting</T>
          <T v="dim">What Forge, Reforge, the world’s agent, the style bible, voices and maps write lands here for you to accept or dismiss. It keeps going when you leave the app.</T>
        </View>
      )}
      {failed.length > 1 ? <Button kind="ghost" title={`Clear ${failed.length} failed`} onPress={async () => { for (const j of failed) await useJobs.getState().cancel(db, j.id); }} /> : null}
      <ProposalSheet jobId={open} onClose={() => setOpen(null)} />
      <View style={{ height: 40 }} />
    </Screen>
  );
}
