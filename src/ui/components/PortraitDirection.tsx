import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Universe } from '@/core/types';
import { characterDraft } from '@/core/world/drafts';
import { composePicture, entryImagePrompt, portraitDirectionPrompt } from '@/core/world/forge';
import { imageOf } from '@/core/world/portraits';
import { newId, now } from '@/core/ids';
import { saveCharacter } from '@/db/repo/library';
import { useSettings } from '@/state/settings';
import { complete, paint, paintReady } from '@/state/paint';
import { removeImage, saveImage } from '@/state/images';
import { runInForeground } from '@/state/foreground';
import { Banner, Button, Chip, Field, Row, T } from './index';
import { Avatar, worldLine } from './EntryImage';
import { radius, useTheme } from '../theme';

/**
 * The world's portrait direction: one paragraph every character portrait
 * follows, so they read as one gallery. Write it by hand, have the helper
 * write or refine it from the world and its art direction, and try it on a
 * character before committing; the current portraits sit alongside to judge
 * against. Never sent to the writer.
 */
export function PortraitDirection({ u, people, onChange, onPortrait }: { u: Universe; people: Character[]; onChange: (text: string) => void; onPortrait: () => void }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { defaults } = useSettings();
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState<'write' | 'try' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ who: Character; uri: string; prompt: string; model: string } | null>(null);
  const current = u.data.portraitStyle ?? '';
  const art = u.data.artStyle?.trim() || defaults.artStyle.trim();
  const gallery = people.filter((c) => imageOf(c.data as Record<string, unknown>));
  const ready = paintReady();

  async function write() {
    setBusy('write'); setErr(null);
    try {
      const looks = people.map((c) => c.data.appearance?.trim()).filter((x): x is string => !!x);
      const { text } = await complete({ model: defaults.models.helper, messages: portraitDirectionPrompt({ world: `World: ${worldLine(u)}`, art, current, people: looks, wish }), maxTokens: 1500, temperature: 0.6, spend: { db, note: 'portrait direction' } });
      if (!text.trim()) throw new Error('The helper wrote nothing. Try again.');
      onChange(text.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function tryOn(c: Character) {
    setBusy('try'); setErr(null);
    try {
      const lib = { universe: u, entities: [], characters: people, species: [], lore: [] };
      const { text } = await complete({ model: defaults.models.helper, messages: entryImagePrompt({ draft: characterDraft(c, lib), world: worldLine(u) }), maxTokens: 2000, temperature: 0.7, spend: { db, note: `portrait test: ${c.name}` } });
      const prompt = composePicture('character', text.trim() || c.summary, { art, portrait: current });
      const out = await runInForeground(`Painting ${c.name}`, () => paint(prompt, { zdr: defaults.zdr, spend: { db, note: `portrait test: ${c.name}` } }));
      if (trial) await removeImage(trial.uri);
      setTrial({ who: c, uri: await saveImage(newId(), out.dataUrl), prompt, model: out.model });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function keep() {
    if (!trial) return;
    const old = imageOf(trial.who.data as Record<string, unknown>);
    if (old) await removeImage(old.uri);
    await saveCharacter(db, { ...trial.who, data: { ...trial.who.data, image: { uri: trial.uri, prompt: trial.prompt, model: trial.model, at: now() } } as Character['data'] });
    setTrial(null);
    onPortrait();
  }

  return (
    <View style={{ gap: 10 }}>
      <T v="faint">Every portrait of this world’s people follows this, in place of the general art direction’s framing, so they look like one gallery: medium, crop and pose, lens, light, background, palette, how faces are drawn. Never sent to the writer.</T>
      {gallery.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {gallery.map((c) => <View key={c.id} style={{ alignItems: 'center', gap: 2, width: 60 }}><Avatar data={c.data as Record<string, unknown>} name={c.name} size={52} /><T v="small" numberOfLines={1}>{c.name.split(' ')[0]}</T></View>)}
        </ScrollView>
      ) : null}
      <Field label="Portrait direction" value={current} onChangeText={onChange} multiline placeholder={art ? `Falls back to the art direction: ${art.slice(0, 80)}…` : 'e.g. Oil on gessoed panel, bust crop, three-quarter turn, eye level, single warm key light from the left, dark umber background, muted earth palette, visible brushwork, faces modelled softly.'} />
      <Field label="What you want, optional" value={wish} onChangeText={setWish} placeholder="e.g. moodier, more painterly, closer crops" />
      <Row style={{ flexWrap: 'wrap' }}>
        <Button small icon="sparkles-outline" title={current ? 'Refine it' : 'Write it'} loading={busy === 'write'} disabled={!!busy} onPress={() => void write()} />
      </Row>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {people.length ? (
        <View style={{ gap: 6 }}>
          <T v="label">Try it on</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {people.slice(0, 20).map((c) => <Chip key={c.id} small label={c.name} selected={pick === c.id} onPress={() => setPick(pick === c.id ? null : c.id)} />)}
          </ScrollView>
          {pick ? <Button small kind="outline" icon="color-palette-outline" title={ready.ok ? 'Paint a test portrait' : 'Painting is not set up'} loading={busy === 'try'} disabled={!!busy || !ready.ok} onPress={() => { const c = people.find((x) => x.id === pick); if (c) void tryOn(c); }} /> : null}
          {!ready.ok ? <T v="faint">{ready.why}</T> : null}
        </View>
      ) : null}
      {trial ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Image source={{ uri: trial.uri }} style={{ width: 200, height: 200, borderRadius: radius.md, backgroundColor: t.surface2 }} />
          <T v="small">{trial.who.name} · {trial.model}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small icon="checkmark" title={`Keep as ${trial.who.name.split(' ')[0]}'s portrait`} onPress={() => void keep()} />
            <Button small kind="ghost" title="Discard" onPress={async () => { await removeImage(trial.uri); setTrial(null); }} />
          </Row>
        </View>
      ) : null}
    </View>
  );
}
