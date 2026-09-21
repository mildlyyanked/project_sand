import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Preset, Style, Universe } from '@/core/types';
import { listCharacters, listPresets, listStyles, listUniverses, newCharacter, newPreset, newStyle, newUniverse, saveCharacter, savePreset, saveStyle, saveUniverse } from '@/db/repo/library';
import { Badge, Button, Empty, ListItem, Segmented, Screen } from '@/ui/components';
import { space } from '@/ui/theme';

type Tab = 'characters' | 'styles' | 'presets' | 'worlds';

export default function Library() {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<Tab>('characters');
  const [chars, setChars] = useState<Character[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [worlds, setWorlds] = useState<Universe[]>([]);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([listCharacters(db), listStyles(db), listPresets(db), listUniverses(db)]).then(([c, s, p, w]) => {
        setChars(c); setStyles(s); setPresets(p); setWorlds(w);
      });
    }, [db]),
  );

  async function add() {
    if (tab === 'characters') { const c = newCharacter(); await saveCharacter(db, c); router.push(`/library/character/${c.id}`); }
    if (tab === 'styles') { const s = newStyle(); await saveStyle(db, s); router.push(`/library/style/${s.id}`); }
    if (tab === 'presets') { const p = newPreset(); await savePreset(db, p); router.push(`/library/preset/${p.id}`); }
    if (tab === 'worlds') { const u = newUniverse(); await saveUniverse(db, u); router.push(`/library/universe/${u.id}`); }
  }

  const empty = { characters: 'Characters carry voice, tells, limits and preferences into any story.', styles: 'A style card fixes point of view, tense, register and banned phrases.', presets: 'Presets hold the system prompt, prefill and the refusal chain.', worlds: 'Worlds hold species, lore and canon shared across stories.' }[tab];

  return (
    <Screen scroll>
      <Segmented value={tab} onChange={setTab} options={[{ key: 'characters', label: 'People' }, { key: 'styles', label: 'Styles' }, { key: 'presets', label: 'Presets' }, { key: 'worlds', label: 'Worlds' }]} />
      <View style={{ marginTop: space.md }}>
        {tab === 'characters' && (chars.length ? chars.map((c) => <ListItem key={c.id} title={c.name} subtitle={c.summary || c.lifeStage} right={!c.adult ? <Badge label="not adult" tone="warn" /> : undefined} onPress={() => router.push(`/library/character/${c.id}`)} />) : <Empty icon="people-outline" title="No characters" hint={empty} />)}
        {tab === 'styles' && (styles.length ? styles.map((s) => <ListItem key={s.id} title={s.name} subtitle={[s.pointOfView, s.tense, s.register].filter(Boolean).join(' · ')} onPress={() => router.push(`/library/style/${s.id}`)} />) : <Empty icon="text-outline" title="No styles" hint={empty} />)}
        {tab === 'presets' && (presets.length ? presets.map((p) => <ListItem key={p.id} title={p.name} subtitle={`${p.refusalChain.length} refusal step${p.refusalChain.length === 1 ? '' : 's'}`} onPress={() => router.push(`/library/preset/${p.id}`)} />) : <Empty icon="construct-outline" title="No presets" hint={empty} />)}
        {tab === 'worlds' && (worlds.length ? worlds.map((u) => <ListItem key={u.id} title={u.name} subtitle={u.description} onPress={() => router.push(`/library/universe/${u.id}`)} />) : <Empty icon="planet-outline" title="No worlds" hint={empty} />)}
      </View>
      <Button title={`New ${tab === 'characters' ? 'character' : tab === 'worlds' ? 'world' : tab.slice(0, -1)}`} icon="add" onPress={add} style={{ marginTop: space.xl }} />
    </Screen>
  );
}
