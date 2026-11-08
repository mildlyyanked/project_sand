import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Style, Universe } from '@/core/types';
import { VoiceGallery } from '@/ui/components/VoiceGallery';
import { voiceOf } from '@/core/voice';
import { listCharacters, listStyles, listUniverses, newStyle, newUniverse, saveStyle, saveUniverse } from '@/db/repo/library';
import { listEntities } from '@/db/repo/world';
import { Button, Card, Empty, Ionicons, ListItem, Row, SearchBox, Segmented, Screen, T, matches } from '@/ui/components';
import { ForgeSheet } from '@/ui/components/Forge';
import { Avatar } from '@/ui/components/EntryImage';
import { space, useTheme } from '@/ui/theme';

type Tab = 'worlds' | 'styles';

/**
 * The library is two things: the worlds stories happen in (with everyone
 * and everything in them, their maps and their style) and the voices they
 * are written in. Characters live in their world; those of no world in the
 * real one.
 */
export default function Library() {
  const db = useSQLiteContext();
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('worlds');
  const [chars, setChars] = useState<Character[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [worlds, setWorlds] = useState<Universe[]>([]);
  const [places, setPlaces] = useState<Record<string, number>>({});
  const [forge, setForge] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    void Promise.all([listCharacters(db), listStyles(db), listUniverses(db)]).then(async ([c, s, w]) => {
      setChars(c); setStyles(s); setWorlds(w);
      const counts = await Promise.all(w.map(async (u) => [u.id, (await listEntities(db, u.id)).length] as const));
      setPlaces(Object.fromEntries(counts));
    });
  }, [db]);
  useFocusEffect(load);

  async function add() {
    if (tab === 'styles') { const s = newStyle(); await saveStyle(db, s); router.push(`/library/style/${s.id}`); }
    if (tab === 'worlds') { const u = newUniverse(); await saveUniverse(db, u); router.push(`/library/universe/${u.id}?edit=1`); }
  }

  const people = (u: Universe) => chars.filter((c) => c.universeId === u.id || (!c.universeId && u.isDefault)).length;
  const sorted = [...worlds].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt - a.updatedAt);
  const shownWorlds = sorted.filter((w) => matches(q, w.name, w.description, w.data.genre, ...chars.filter((c) => c.universeId === w.id || (!c.universeId && w.isDefault)).map((c) => c.name)));
  const hits = q.trim() ? chars.filter((c) => matches(q, c.name, c.summary, c.data.occupation)) : [];

  return (
    <Screen scroll>
      <Segmented value={tab} onChange={(v) => { setTab(v); setQ(''); }} options={[{ key: 'worlds', label: 'Worlds' }, { key: 'styles', label: 'Voices' }]} />
      <View style={{ marginTop: space.md, gap: space.sm }}>
        {(tab === 'styles' ? styles.length : worlds.length) > 5 || tab === 'worlds' ? <SearchBox value={q} onChange={setQ} placeholder={tab === 'styles' ? 'Search voices' : 'Search worlds and the people in them'} /> : null}
        {tab === 'worlds' ? (
          <>
            {shownWorlds.map((u) => (
              <Card key={u.id} onPress={() => router.push(`/library/universe/${u.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {u.isDefault ? <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="earth-outline" size={22} color={t.dim} /></View> : <Avatar data={u.data as unknown as Record<string, unknown>} name={u.name} size={44} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="h" numberOfLines={1}>{u.name}</T>
                  <T v="small" numberOfLines={1}>{u.isDefault ? 'Plain stories, and characters of no world' : u.data.genre.split('\n')[0] || u.description}</T>
                  <T v="faint" numberOfLines={1}>{[`${people(u)} ${people(u) === 1 ? 'character' : 'characters'}`, places[u.id] ? `${places[u.id]} places, factions and things` : ''].filter(Boolean).join(' · ')}</T>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.faint} />
              </Card>
            ))}
            {hits.length ? (
              <View style={{ gap: 2, marginTop: space.sm }}>
                <T v="label">Characters</T>
                {hits.slice(0, 30).map((c) => <ListItem key={c.id} left={<Avatar data={c.data as Record<string, unknown>} name={c.name} />} title={c.name} subtitle={[worlds.find((w) => w.id === c.universeId)?.name ?? 'The real world', c.summary].filter(Boolean).join(' · ')} onPress={() => router.push(`/library/character/${c.id}`)} />)}
              </View>
            ) : null}
            {!shownWorlds.length && !hits.length ? <Empty icon="planet-outline" title={q ? 'Nothing matches' : 'No worlds'} hint="Worlds hold places, factions, characters, peoples, things and lore shared across stories." /> : null}
          </>
        ) : null}
        {tab === 'styles' && (styles.length ? styles.filter((x) => matches(q, x.name, x.influences, x.register, voiceOf(x).authors.join(' '))).map((s) => <ListItem key={s.id} title={s.name} subtitle={[voiceOf(s).authors.length ? `writes like ${voiceOf(s).authors.join(' and ')}` : '', [s.pointOfView, s.tense].filter(Boolean).join(', '), s.system ? 'own writer prompt' : '', s.refusalChain.length ? `${s.refusalChain.length} persistence step${s.refusalChain.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')} onPress={() => router.push(`/library/style/${s.id}`)} />) : <Empty icon="text-outline" title="No voices" hint="A voice is how the prose reads: who it writes like, its rules, samples and form. Start from one in the gallery below, or build your own." />)}
        {tab === 'styles' && !q.trim() ? (
          <View style={{ gap: space.sm, marginTop: space.lg }}>
            <T v="label">Gallery</T>
            <VoiceGallery added={new Set(styles.map((x) => x.id))} onOpen={(id) => { load(); router.push(`/library/style/${id}`); }} />
          </View>
        ) : null}
      </View>
      <Row style={{ marginTop: space.xl }}>
        <Button title={tab === 'worlds' ? 'New world' : 'New voice'} icon="add" onPress={add} style={{ flex: 1 }} />
        {tab === 'worlds' ? <Button kind="outline" title="Forge a world" icon="sparkles-outline" onPress={() => setForge(true)} style={{ flex: 1 }} /> : null}
      </Row>
      {tab === 'worlds' ? <T v="faint" style={{ marginTop: space.sm }}>Characters, places and everything else are made inside a world: open it, then Entries or its Workshop.</T> : null}
      <ForgeSheet open={forge} onClose={() => setForge(false)} kind="world" onSaved={load} />
    </Screen>
  );
}
