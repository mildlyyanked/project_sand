import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, ChatMessage, Style, Universe } from '@/core/types';
import { openingPrompt, parsePremises, workshopNotePrompt, workshopSystem } from '@/core/helpers';
import { newId } from '@/core/ids';
import { listCharacters, listStyles, listUniverses } from '@/db/repo/library';
import { blankSession, insertBeat, makeBeat, upsertSession } from '@/db/repo/sessions';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { Banner, Button, Chip, IconButton, Ionicons, Row, Sheet, T } from '@/ui/components';
import { radius, serif, space, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

const OPENERS = ['I have an image, not a plot', 'Something tender and slow', 'Something that goes very dark', 'A character I cannot stop thinking about', 'Just give me five premises'];

interface Turn { id: string; role: 'user' | 'assistant'; text: string; streaming?: boolean }

export default function Workshop() {
  const db = useSQLiteContext();
  const t = useTheme();
  const { apiKey, defaults } = useSettings();
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [universeId, setUniverseId] = useState<string | null>(null);
  const [charIds, setCharIds] = useState<string[]>([]);
  const [styleId, setStyleId] = useState<string | null>(defaults.styleId);
  const [setupOpen, setSetupOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [opening, setOpening] = useState('');
  const [openingBusy, setOpeningBusy] = useState(false);
  const listRef = useRef<FlatList<Turn>>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void Promise.all([listUniverses(db), listCharacters(db), listStyles(db)]).then(([u, c, s]) => { setUniverses(u); setChars(c); setStyles(s); });
  }, [db]);
  const lastLen = turns[turns.length - 1]?.text.length ?? 0;
  useEffect(() => { setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50); }, [turns.length, lastLen]);

  const style = styles.find((s) => s.id === styleId) ?? null;
  const universe = universes.find((u) => u.id === universeId) ?? null;
  const pickedChars = chars.filter((c) => charIds.includes(c.id));
  const system = useMemo(() => workshopSystem({ universe, characters: pickedChars, style }), [universe, pickedChars, style]);
  const transcript = (): ChatMessage[] => [system, ...turns.filter((x) => !x.streaming || x.text).map((x) => ({ role: x.role, content: x.text }))];

  async function send(text: string) {
    const v = text.trim();
    if (!v || busy) return;
    if (!apiKey) return setErr('Add your OpenRouter key in Settings first.');
    setInput('');
    setErr(null);
    const userTurn: Turn = { id: newId(), role: 'user', text: v };
    const reply: Turn = { id: newId(), role: 'assistant', text: '', streaming: true };
    const next = [...turns, userTurn];
    setTurns([...next, reply]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const messages: ChatMessage[] = [system, ...next.map((x) => ({ role: x.role, content: x.text }))];
      let acc = '';
      for await (const ev of client.stream({ apiKey, model: defaults.models.helper, messages, params: { temperature: 0.9, topP: 0.95, maxTokens: 700, reasoning: false }, zdr: defaults.zdr, signal: abort.current.signal })) {
        if (ev.type === 'text') { acc += ev.text ?? ''; setTurns((ts) => ts.map((x) => (x.id === reply.id ? { ...x, text: acc } : x))); }
        if (ev.type === 'error') throw new Error(ev.error);
      }
      setTurns((ts) => ts.map((x) => (x.id === reply.id ? { ...x, text: acc, streaming: false } : x)));
    } catch (e) {
      if (!abort.current?.signal.aborted) setErr(e instanceof Error ? e.message : String(e));
      setTurns((ts) => ts.filter((x) => x.id !== reply.id || x.text));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  async function writeOpening() {
    if (!chosen) return;
    setOpeningBusy(true); setErr(null); setOpening('');
    try {
      let text = '';
      for await (const ev of client.stream({ apiKey, model: defaults.models.writer, messages: openingPrompt(chosen, style), params: { temperature: 0.9, topP: 0.95, maxTokens: 900, reasoning: false }, zdr: defaults.zdr })) {
        if (ev.type === 'text') { text += ev.text ?? ''; setOpening(text); }
        if (ev.type === 'error') throw new Error(ev.error);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setOpeningBusy(false); }
  }

  async function start(withOpening: boolean) {
    if (!chosen) return;
    const title = chosen.split(/[.!?]/)[0]!.split(/\s+/).slice(0, 6).join(' ') || 'Untitled';
    const s = blankSession({ title, models: defaults.models, zdr: defaults.zdr, presetId: defaults.presetId, styleId, universeId, characterIds: charIds });
    await upsertSession(db, s);
    let noteText = `Premise: ${chosen.trim()}`;
    if (turns.length > 2 && apiKey) {
      try {
        let n = '';
        for await (const ev of client.stream({ apiKey, model: defaults.models.helper, messages: workshopNotePrompt(transcript(), chosen), params: { temperature: 0.3, topP: 0.9, maxTokens: 400, reasoning: false }, zdr: defaults.zdr })) if (ev.type === 'text') n += ev.text ?? '';
        if (n.trim()) noteText = n.trim();
      } catch {}
    }
    const note = makeBeat({ sessionId: s.id, parentId: null, role: 'note', text: noteText });
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

  const setupLabel = [universe?.name, pickedChars.length ? `${pickedChars.length} character${pickedChars.length > 1 ? 's' : ''}` : null, style?.name].filter(Boolean).join(' · ') || 'No world, characters or style yet';

  const renderTurn = ({ item }: { item: Turn }) => {
    const premises = item.role === 'assistant' && !item.streaming ? parsePremises(item.text) : [];
    const mine = item.role === 'user';
    return (
      <View style={{ paddingHorizontal: space.lg, paddingVertical: 6, alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <View style={{ maxWidth: '88%', backgroundColor: mine ? t.accent : t.surface, borderRadius: 18, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
          <T style={{ color: mine ? t.accentText : t.text, fontSize: 15, lineHeight: 22 }} selectable>{item.text}{item.streaming ? '▍' : ''}</T>
          {premises.length ? (
            <View style={{ gap: 6 }}>
              {premises.map((p, i) => (
                <Pressable key={i} onPress={() => { setChosen(p); setOpening(''); }} style={({ pressed }) => ({ borderWidth: 1, borderColor: chosen === p ? t.accent : t.border, borderRadius: radius.md, padding: 10, opacity: pressed ? 0.7 : 1, backgroundColor: chosen === p ? t.surface2 : 'transparent' })}>
                  <T v="small" style={{ color: t.accent, marginBottom: 2 }}>{chosen === p ? 'Chosen' : `Use premise ${i + 1}`}</T>
                  <T v="dim">{p}</T>
                </Pressable>
              ))}
            </View>
          ) : !mine && !item.streaming && item.text.length > 80 ? (
            <Pressable onPress={() => { setChosen(item.text.trim()); setOpening(''); }} hitSlop={6}>
              <T v="small" style={{ color: t.accent }}>{chosen === item.text.trim() ? 'Chosen as the premise' : 'Use this as the premise'}</T>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }} keyboardVerticalOffset={90}>
      <Pressable onPress={() => setSetupOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <Ionicons name="options-outline" size={16} color={t.dim} />
        <T v="dim" numberOfLines={1} style={{ flex: 1 }}>{setupLabel}</T>
        <T v="faint">{shortModel(defaults.models.helper)}</T>
      </Pressable>
      {err ? <View style={{ padding: space.md }}><Banner text={err} onClose={() => setErr(null)} /></View> : null}
      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={(x) => x.id}
        renderItem={renderTurn}
        contentContainerStyle={{ paddingVertical: space.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          turns.length === 0 ? (
            <View style={{ padding: space.lg, gap: 12 }}>
              <T v="h">Let’s find the story.</T>
              <T v="dim">Say anything: an image, a mood, a person, a scene you keep replaying, or what you don’t want. The editor asks from there. Ask for premises whenever you’re ready, and keep pushing on them after.</T>
              <Row style={{ flexWrap: 'wrap' }}>
                {OPENERS.map((o) => <Chip key={o} small label={o} onPress={() => send(o)} />)}
              </Row>
            </View>
          ) : null
        }
      />
      {chosen ? (
        <View style={{ borderTopWidth: 1, borderTopColor: t.border, padding: space.md, gap: 8, backgroundColor: t.surface }}>
          <Row between>
            <T v="label">Premise chosen</T>
            <IconButton name="close" size={16} onPress={() => { setChosen(null); setOpening(''); }} />
          </Row>
          <T v="dim" numberOfLines={opening ? 2 : 4}>{chosen}</T>
          {opening ? <T style={{ fontFamily: serif, fontSize: 15, lineHeight: 23 }} numberOfLines={6}>{opening}</T> : null}
          <Row>
            <Button small kind="outline" icon="pencil-outline" title={opening ? 'Rewrite opening' : 'Write the opening'} onPress={writeOpening} loading={openingBusy} disabled={!apiKey} />
            {opening && !openingBusy ? <Button small icon="play" title="Start with it" onPress={() => start(true)} /> : <Button small kind="ghost" title="Start blank" onPress={() => start(false)} />}
          </Row>
        </View>
      ) : null}
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Platform.OS === 'ios' ? space.xl : space.md, backgroundColor: t.bg }}>
        <Row style={{ alignItems: 'flex-end' }}>
          <TextInput value={input} onChangeText={setInput} placeholder={turns.length ? 'Reply…' : 'Where does it start for you?'} placeholderTextColor={t.faint} multiline style={{ flex: 1, backgroundColor: t.surface, color: t.text, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140 }} />
          {busy ? <IconButton name="stop-circle" size={30} color={t.danger} onPress={() => abort.current?.abort()} /> : <IconButton name="arrow-up-circle" size={30} color={input.trim() ? t.accent : t.faint} onPress={() => send(input)} disabled={!input.trim()} />}
        </Row>
        {turns.length > 0 && !busy ? (
          <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <Chip small label="Give me premises" onPress={() => send('Give me premises now, based on everything so far.')} />
            <Chip small label="Push it further" onPress={() => send('Push the last idea further. Make it stranger and more specific.')} />
            <Chip small label="Darker" onPress={() => send('Take that darker.')} />
            <Chip small label="Gentler" onPress={() => send('Make that gentler and more intimate.')} />
          </Row>
        ) : null}
      </View>

      <Sheet open={setupOpen} onClose={() => setSetupOpen(false)} title="Story setup">
        <T v="label">World</T>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="None" selected={!universeId} onPress={() => setUniverseId(null)} />
          {universes.map((u) => <Chip key={u.id} label={u.name} selected={universeId === u.id} onPress={() => setUniverseId(u.id)} />)}
        </Row>
        <T v="label">Characters</T>
        {chars.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {chars.filter((c) => !universeId || !c.universeId || c.universeId === universeId).map((c) => <Chip key={c.id} label={c.name} selected={charIds.includes(c.id)} onPress={() => setCharIds((v) => (v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id]))} />)}
          </Row>
        ) : <T v="faint">None yet. Create them in the Library.</T>}
        <T v="label">Style</T>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="None" selected={!styleId} onPress={() => setStyleId(null)} />
          {styles.map((s) => <Chip key={s.id} label={s.name} selected={styleId === s.id} onPress={() => setStyleId(s.id)} />)}
        </Row>
        <T v="faint">The editor sees these while you talk. Changing them mid-conversation is fine.</T>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
