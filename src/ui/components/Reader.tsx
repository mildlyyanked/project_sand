import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { READERS, personaOf, type ReaderKey, type ReaderMsg } from '@/core/reader';
import { useReader } from '@/state/reader';
import { Banner, Button, Field, IconButton, Ionicons, MenuItem, Row, Sheet, T } from './index';
import { KeyboardShift } from '../keyboard';
import { radius, serif, space, useTheme } from '../theme';

/** Wide enough to keep the reader beside the page instead of over it. */
export const READER_DOCK = 900;
export const READER_WIDTH = 360;

function Face({ name, size = 30 }: { name: string; size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color: t.accentText, fontWeight: '700', fontSize: size * 0.45 }}>{name.slice(0, 1).toUpperCase()}</T>
    </View>
  );
}

function Bubble({ m, first, onWriteIt }: { m: ReaderMsg; first: boolean; onWriteIt: (m: ReaderMsg) => void }) {
  const t = useTheme();
  const mine = m.from === 'writer';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: first ? 10 : 3 }}>
      <View style={{ maxWidth: '86%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderTopRightRadius: mine && first ? 6 : 18, borderTopLeftRadius: !mine && first ? 6 : 18, backgroundColor: mine ? t.accent : t.surface2 }}>
        <T style={{ color: mine ? t.accentText : t.text, fontSize: 15, lineHeight: 21 }}>{m.text}</T>
      </View>
      {m.idea ? (
        <View style={{ maxWidth: '86%', marginTop: 4, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: m.used ? t.border : t.accent, gap: 6 }}>
          <Row gap={6}><Ionicons name="bulb-outline" size={14} color={m.used ? t.faint : t.accent} /><T v="small" style={{ flex: 1, color: m.used ? t.faint : t.text }}>{m.idea}</T></Row>
          {m.used ? <T v="faint">Sent to the writer.</T> : <Button small icon="create-outline" title="Write it" onPress={() => onWriteIt(m)} />}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Read with me: the reader's side of the story. Beside the page on a wide
 * screen; on a phone it slides in over it. The reader only knows what is on
 * the page, speaks up on its own now and then (unless told to keep quiet)
 * and answers whatever you say.
 */
export function ReaderPanel({ docked, onWriteIt }: { docked: boolean; onWriteIt: (idea: string) => void }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const r = useReader();
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const [who, setWho] = useState(false);
  const [menu, setMenu] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const persona = personaOf(r.data.persona, r.data.custom);
  const msgs = r.data.messages;

  useEffect(() => { const h = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(h); }, [msgs.length, r.typing, r.open]);

  const send = () => { const v = text; setText(''); void r.send(db, v); };
  const writeIt = (m: ReaderMsg) => { if (!m.idea) return; void r.used(db, m.id); onWriteIt(m.idea); if (!docked) r.setOpen(db, false); };

  const body = (
    <View style={{ flex: 1 }}>
      <Row between style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <Pressable onPress={() => setWho(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <Face name={persona.name} />
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }} numberOfLines={1}>{persona.name}</T>
            <T v="faint" numberOfLines={1}>{r.typing ? 'typing…' : r.data.quiet ? `${persona.label.toLowerCase()} · quiet` : persona.label.toLowerCase()}</T>
          </View>
        </Pressable>
        {r.data.on ? <IconButton name={r.data.quiet ? 'notifications-off-outline' : 'notifications-outline'} size={20} color={r.data.quiet ? t.faint : t.dim} onPress={() => void r.setQuiet(db, !r.data.quiet)} /> : null}
        {r.data.on ? <IconButton name="ellipsis-horizontal" size={20} onPress={() => setMenu(true)} /> : null}
        <IconButton name="close" size={20} color={t.dim} onPress={() => r.setOpen(db, false)} />
      </Row>

      {!r.data.on ? (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <T v="h">Read with me</T>
          <T v="dim">Someone reads along as you write and talks it over with you, the way a friend would over text: what grabbed them, what lost them, what they think happens next. They only see what is on the page; your notes, brief and world stay yours.</T>
          <T v="label">Who reads it</T>
          {READERS.map((p) => (
            <Pressable key={p.key} onPress={() => void r.setPersona(db, p.key)} style={{ flexDirection: 'row', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: r.data.persona === p.key ? t.accent : t.border }}>
              <Face name={p.name} size={28} />
              <View style={{ flex: 1, gap: 2 }}><T style={{ fontWeight: '600' }}>{p.name} · {p.label.toLowerCase()}</T><T v="small">{p.blurb}</T></View>
            </Pressable>
          ))}
          <Button kind="ghost" title={r.data.persona === 'custom' ? `Your reader: ${persona.name}` : 'Describe your own reader'} onPress={() => setWho(true)} />
          <Button icon="book-outline" title={`Start reading with ${persona.name}`} loading={r.typing} onPress={() => void r.start(db)} />
        </ScrollView>
      ) : (
        <ScrollView ref={scroll} contentContainerStyle={{ padding: space.md, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
          {msgs.length ? null : <T v="faint" style={{ textAlign: 'center', marginTop: space.lg }}>{persona.name} is reading. Say anything.</T>}
          {msgs.map((m, i) => <Bubble key={m.id} m={m} first={i === 0 || msgs[i - 1]!.from !== m.from} onWriteIt={writeIt} />)}
          {r.typing ? (
            <View style={{ alignItems: 'flex-start', marginTop: 8 }}>
              <View style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: t.surface2 }}><T v="dim" style={{ letterSpacing: 2 }}>•••</T></View>
            </View>
          ) : null}
          {r.error ? <View style={{ marginTop: 10 }}><Banner text={r.error} onClose={r.clearError} /></View> : null}
        </ScrollView>
      )}

      {r.data.on ? (
        <Row gap={6} style={{ padding: space.sm, borderTopWidth: 1, borderTopColor: t.border, alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Talk to ${persona.name}…`}
            placeholderTextColor={t.faint}
            multiline
            style={{ flex: 1, maxHeight: 120, color: t.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: t.surface2 }}
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          <IconButton name="arrow-up-circle" size={30} color={text.trim() ? t.accent : t.faint} disabled={!text.trim()} onPress={send} />
        </Row>
      ) : null}

      <WhoSheet open={who} onClose={() => setWho(false)} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={persona.name}>
        <MenuItem icon="people-outline" label="Change reader" onPress={() => { setMenu(false); setWho(true); }} />
        <MenuItem icon={r.data.quiet ? 'notifications-outline' : 'notifications-off-outline'} label={r.data.quiet ? 'Speak up again' : 'Keep quiet unless I ask'} hint={r.data.quiet ? 'Reacts to new pages now and then' : 'Only answers when you talk to them'} onPress={() => { setMenu(false); void r.setQuiet(db, !r.data.quiet); }} />
        <MenuItem icon="refresh-outline" label="Start the conversation over" hint="They keep reading from here" onPress={() => { setMenu(false); void r.restart(db); }} />
      </Sheet>
    </View>
  );

  if (docked) {
    return r.open ? <View style={{ width: READER_WIDTH, borderLeftWidth: 1, borderLeftColor: t.border, backgroundColor: t.surface }}>{body}</View> : null;
  }
  return (
    <Modal visible={r.open} transparent animationType="fade" onRequestClose={() => r.setOpen(db, false)}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable onPress={() => r.setOpen(db, false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
        <KeyboardShift style={{ width: Math.min(440, width * 0.92), backgroundColor: t.surface, borderTopLeftRadius: 18, borderBottomLeftRadius: 18, paddingTop: 40 }}>
          {body}
        </KeyboardShift>
      </View>
    </Modal>
  );
}

/** Choose who reads: one of the readers, or one you describe. */
function WhoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const r = useReader();
  const [name, setName] = useState(r.data.custom?.name ?? '');
  const [desc, setDesc] = useState(r.data.custom?.description ?? '');
  const pick = (k: ReaderKey) => { void r.setPersona(db, k); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Who reads it" full>
      {READERS.map((p) => (
        <Pressable key={p.key} onPress={() => pick(p.key)} style={{ flexDirection: 'row', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: r.data.persona === p.key ? t.accent : t.border }}>
          <Face name={p.name} size={28} />
          <View style={{ flex: 1, gap: 2 }}><T style={{ fontWeight: '600' }}>{p.name} · {p.label.toLowerCase()}</T><T v="small">{p.blurb}</T></View>
        </Pressable>
      ))}
      <T v="label" style={{ marginTop: space.sm }}>Or your own</T>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Gran" />
      <Field label="Who they are" value={desc} onChangeText={setDesc} multiline placeholder="My grandmother: reads Agatha Christie, trusts nobody, says exactly what she thinks." style={{ minHeight: 80, fontFamily: serif }} />
      <Button title="Read with them" icon="checkmark" disabled={!desc.trim()} onPress={() => { void r.setPersona(db, 'custom', { name: name.trim() || 'Reader', description: desc.trim() }); onClose(); }} />
    </Sheet>
  );
}

/** What the reader just said, while the panel was closed: a peek above the composer. */
export function ReaderPeek() {
  const db = useSQLiteContext();
  const t = useTheme();
  const r = useReader();
  const peek = r.peek;
  useEffect(() => { if (!peek) return; const h = setTimeout(() => useReader.getState().dismissPeek(), 12000); return () => clearTimeout(h); }, [peek]);
  if (!peek || r.open) return null;
  const persona = personaOf(r.data.persona, r.data.custom);
  return (
    <Pressable onPress={() => r.setOpen(db, true)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, paddingRight: 4, borderRadius: 18, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.8 : 1 })}>
      <Face name={persona.name} size={24} />
      <T numberOfLines={2} style={{ flex: 1, fontSize: 14 }}><T style={{ fontWeight: '700', fontSize: 14 }}>{persona.name} </T>{peek.text}</T>
      {r.data.unread > 1 ? <T v="faint">+{r.data.unread - 1}</T> : null}
      <IconButton name="close" size={16} color={t.faint} onPress={r.dismissPeek} style={{ padding: 4 }} />
    </Pressable>
  );
}
