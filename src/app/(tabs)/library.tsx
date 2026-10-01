import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Style, Universe } from '@/core/types';
import { listCharacters, listStyles, listUniverses, newCharacter, newStyle, newUniverse, saveCharacter, saveStyle, saveUniverse } from '@/db/repo/library';
import { Badge, Button, Empty, ListItem, Row, Segmented, Screen } from '@/ui/components';
import { ForgeSheet } from '@/ui/components/Forge';
import type { ForgeKind } from '@/core/helpers';
import { space } from '@/ui/theme';

type Tab = 'characters' | 'styles' | 'worlds';

export default function Library() {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<Tab>('characters');
  const [chars, setChars] = useState<Character[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [worlds, setWorlds] = useState<Universe[]>([]);
  const [forge, setForge] = useState<ForgeKind | null>(null);

  const load = useCallback(() => {
    void Promise.all([listCharacters(db), listStyles(db), listUniverses(db)]).then(([c, s, w]) => {
      setChars(c); setStyles(s); setWorlds(w);
    });
  }, [db]);
  useFocusEffect(load);

  async function add() {
    if (tab === 'characters') { const c = newCharacter(); await saveCharacter(db, c); router.push(`/library/character/${c.id}`); }
    if (tab === 'styles') { const s = newStyle(); await saveStyle(db, s); router.push(`/library/style/${s.id}`); }
    if (tab === 'worlds') { const u = newUniverse(); await saveUniverse(db, u); router.push(`/library/universe/${u.id}`); }
  }

  const empty = { characters: 'Characters carry voice, tells, limits and preferences into any story.', styles: 'A voice is how the writer is driven: its system prompt and persistence chain, plus the card that fixes point of view, tense, register and banned phrases.', worlds: 'Worlds hold species, lore and canon shared across stories.' }[tab];

  return (
    <Screen scroll>
      <Segmented value={tab} onChange={setTab} options={[{ key: 'characters', label: 'People' }, { key: 'styles', label: 'Voices' }, { key: 'worlds', label: 'Worlds' }]} />
      <View style={{ marginTop: space.md }}>
        {tab === 'characters' && (chars.length ? chars.map((c) => <ListItem key={c.id} title={c.name} subtitle={c.summary || c.lifeStage} right={!c.adult ? <Badge label="not adult" tone="warn" /> : undefined} onPress={() => router.push(`/library/character/${c.id}`)} />) : <Empty icon="people-outline" title="No characters" hint={empty} />)}
        {tab === 'styles' && (styles.length ? styles.map((s) => <ListItem key={s.id} title={s.name} subtitle={[[s.pointOfView, s.tense].filter(Boolean).join(', '), s.system ? 'own writer prompt' : 'default writer prompt', s.refusalChain.length ? `${s.refusalChain.length} persistence step${s.refusalChain.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')} onPress={() => router.push(`/library/style/${s.id}`)} />) : <Empty icon="text-outline" title="No voices" hint={empty} />)}
        {tab === 'worlds' && (worlds.length ? worlds.map((u) => <ListItem key={u.id} title={u.name} subtitle={u.description} onPress={() => router.push(`/library/universe/${u.id}`)} />) : <Empty icon="planet-outline" title="No worlds" hint={empty} />)}
      </View>
      <Row style={{ marginTop: space.xl }}>
        <Button title={`New ${tab === 'characters' ? 'character' : tab === 'worlds' ? 'world' : 'voice'}`} icon="add" onPress={add} style={{ flex: 1 }} />
        {tab !== 'styles' ? <Button kind="outline" title="Forge" icon="sparkles-outline" onPress={() => setForge(tab === 'characters' ? 'character' : 'world')} style={{ flex: 1 }} /> : null}
      </Row>
      {tab !== 'styles' ? <Empty icon="sparkles-outline" title="" hint={tab === 'characters' ? 'Forge has the writer model invent people from a wish, fitted to a world of your choice.' : 'Forge has the writer model invent a world from a wish, with its first species and lore.'} /> : null}
      <ForgeSheet open={!!forge} onClose={() => setForge(null)} kind={forge ?? 'world'} onSaved={load} />
    </Screen>
  );
}
