import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Style, Universe } from '@/core/types';
import { openingPrompt, parsePremises, premisePrompt } from '@/core/helpers';
import { listCharacters, listStyles, listUniverses } from '@/db/repo/library';
import { blankSession, insertBeat, makeBeat, upsertSession } from '@/db/repo/sessions';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { Banner, Button, Card, Chip, Field, Row, Screen, Section, T } from '@/ui/components';
import { serif } from '@/ui/theme';

const GENRES = ['Literary', 'Romance', 'Horror', 'Noir', 'Fantasy', 'Science fiction', 'Erotica', 'Thriller', 'Slice of life'];
const MOODS = ['Tender', 'Bleak', 'Playful', 'Menacing', 'Slow burn', 'Frantic', 'Melancholy', 'Feral'];

export default function NewStory() {
  const db = useSQLiteContext();
  const { apiKey, defaults } = useSettings();
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [universeId, setUniverseId] = useState<string | null>(null);
  const [charIds, setCharIds] = useState<string[]>([]);
  const [styleId, setStyleId] = useState<string | null>(defaults.styleId);
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [seeds, setSeeds] = useState('');
  const [premises, setPremises] = useState<string[]>([]);
  const [raw, setRaw] = useState('');
  const [chosen, setChosen] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState<'premises' | 'opening' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listUniverses(db), listCharacters(db), listStyles(db)]).then(([u, c, s]) => { setUniverses(u); setChars(c); setStyles(s); });
  }, [db]);

  const style = styles.find((s) => s.id === styleId) ?? null;
  const universe = universes.find((u) => u.id === universeId) ?? null;
  const pickedChars = chars.filter((c) => charIds.includes(c.id));

  async function findPremises() {
    setBusy('premises'); setErr(null); setPremises([]); setRaw('');
    try {
      let text = '';
      for await (const ev of client.stream({ apiKey, model: defaults.models.helper, messages: premisePrompt({ genre, mood, seeds, universe, characters: pickedChars }), params: { temperature: 1, topP: 0.95, maxTokens: 900, reasoning: false }, zdr: defaults.zdr })) {
        if (ev.type === 'text') { text += ev.text ?? ''; setRaw(text); }
        if (ev.type === 'error') throw new Error(ev.error);
      }
      setPremises(parsePremises(text));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  async function writeOpening() {
    setBusy('opening'); setErr(null); setOpening('');
    try {
      let text = '';
      for await (const ev of client.stream({ apiKey, model: defaults.models.writer, messages: openingPrompt(chosen, style), params: { temperature: 0.9, topP: 0.95, maxTokens: 900, reasoning: false }, zdr: defaults.zdr })) {
        if (ev.type === 'text') { text += ev.text ?? ''; setOpening(text); }
        if (ev.type === 'error') throw new Error(ev.error);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  async function start(withOpening: boolean) {
    const title = chosen.split(/[.!?]/)[0]!.split(/\s+/).slice(0, 6).join(' ') || 'Untitled';
    const s = blankSession({ title, models: defaults.models, zdr: defaults.zdr, presetId: defaults.presetId, styleId, universeId, characterIds: charIds });
    await upsertSession(db, s);
    const note = makeBeat({ sessionId: s.id, parentId: null, role: 'note', text: `Premise: ${chosen.trim()}` });
    await insertBeat(db, note);
    let current = note.id;
    if (withOpening && opening.trim()) {
      const b = makeBeat({ sessionId: s.id, parentId: note.id, role: 'prose', text: opening.trim(), model: defaults.models.writer });
      await insertBeat(db, b);
      current = b.id;
    }
    await upsertSession(db, { ...s, currentBeatId: current });
    router.replace(`/session/${s.id}`);
  }

  return (
    <Screen scroll>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      <Section title="1 · Where and who">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="No world" selected={!universeId} onPress={() => setUniverseId(null)} />
          {universes.map((u) => <Chip key={u.id} label={u.name} selected={universeId === u.id} onPress={() => setUniverseId(u.id)} />)}
        </Row>
        {chars.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {chars.filter((c) => !universeId || !c.universeId || c.universeId === universeId).map((c) => <Chip key={c.id} label={c.name} selected={charIds.includes(c.id)} onPress={() => setCharIds((v) => (v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id]))} />)}
          </Row>
        ) : null}
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="No style" selected={!styleId} onPress={() => setStyleId(null)} />
          {styles.map((s) => <Chip key={s.id} label={s.name} selected={styleId === s.id} onPress={() => setStyleId(s.id)} />)}
        </Row>
      </Section>
      <Section title="2 · What kind">
        <Row style={{ flexWrap: 'wrap' }}>{GENRES.map((g) => <Chip key={g} small label={g} selected={genre === g} onPress={() => setGenre(genre === g ? '' : g)} />)}</Row>
        <Row style={{ flexWrap: 'wrap' }}>{MOODS.map((m) => <Chip key={m} small label={m} selected={mood === m} onPress={() => setMood(mood === m ? '' : m)} />)}</Row>
        <Field value={seeds} onChangeText={setSeeds} placeholder="Seeds: an image, a line, a situation, a constraint…" multiline />
        <Button title={premises.length ? 'Five more' : 'Find premises'} icon="sparkles-outline" onPress={findPremises} loading={busy === 'premises'} disabled={!apiKey} />
        {busy === 'premises' && raw ? <T v="dim">{raw}</T> : null}
      </Section>
      {premises.length ? (
        <Section title="3 · Pick one">
          {premises.map((p, i) => (
            <Card key={i} onPress={() => { setChosen(p); setOpening(''); }} style={{ borderColor: chosen === p ? '#D8A657' : undefined }}>
              <T>{p}</T>
            </Card>
          ))}
        </Section>
      ) : null}
      <Section title={premises.length ? 'Or write your own' : '3 · Or write the premise yourself'}>
        <Field value={chosen} onChangeText={(v) => { setChosen(v); setOpening(''); }} placeholder="A situation, a pressure, a hook." multiline />
      </Section>
      {chosen.trim() ? (
        <Section title="4 · Open">
          <Row>
            <Button title={opening ? 'Rewrite opening' : 'Write the opening'} icon="pencil-outline" kind="outline" onPress={writeOpening} loading={busy === 'opening'} disabled={!apiKey} />
            <Button title="Start blank" kind="ghost" onPress={() => start(false)} />
          </Row>
          {opening ? (
            <View style={{ gap: 12 }}>
              <T style={{ fontFamily: serif, fontSize: 16, lineHeight: 25 }}>{opening}</T>
              {busy !== 'opening' ? <Button title="Start with this opening" icon="play" onPress={() => start(true)} /> : null}
            </View>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}
