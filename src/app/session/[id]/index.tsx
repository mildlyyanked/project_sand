import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import type { Beat, BeatRole } from '@/core/types';
import { HEAT_LABELS } from '@/core/types';
import { siblingPosition } from '@/core/beatTree';
import { voiceDrift } from '@/core/voiceDrift';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { reweave } from '@/state/reweave';
import { Banner, Button, Chip, Empty, Field, IconButton, Ionicons, MenuItem, Pill, Row, Sheet, T } from '@/ui/components';
import { radius, serif, space, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

const DIRECTIONS = ['Hotter', 'Softer', 'Slower', 'More dialogue', 'Less dialogue', 'A twist', "Another character's view", 'Shorter', 'Longer', 'Darker'];

export default function Manuscript() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const s = useSession();
  const fontSize = useSettings((x) => x.defaults.fontSize);
  const [text, setText] = useState('');
  const [role, setRole] = useState<BeatRole>('prose');
  const [menu, setMenu] = useState(false);
  const [beatMenu, setBeatMenu] = useState<Beat | null>(null);
  const [edit, setEdit] = useState<{ beat: Beat; text: string } | null>(null);
  const [dir, setDir] = useState<{ regenerateId?: string } | null>(null);
  const [dirText, setDirText] = useState('');
  const [showReasoning, setShowReasoning] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const listRef = useRef<FlatList<Beat>>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    if (id) void s.open(db, id);
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      const st = useSession.getState();
      if (st.session?.id === id && !st.streaming) void st.reload();
    }, [id]),
  );

  const session = s.session;
  const path = s.path;
  const lastProse = useMemo(() => [...path].reverse().find((b) => b.role === 'prose'), [path]);
  const drift = useMemo(() => {
    const prose = path.filter((b) => b.role === 'prose');
    const earlier = prose.slice(-6, -1).map((b) => b.text).join('\n');
    return voiceDrift(lastProse?.text ?? '', s.bundle.style, earlier);
  }, [lastProse, path, s.bundle.style]);
  const hasRedo = !!session && (s.index.children.get(session.currentBeatId)?.length ?? 0) > 0;

  useEffect(() => {
    if (atBottom.current) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [path.length, s.streaming?.text.length]);

  const send = useCallback(async () => {
    const v = text.trim();
    if (!v || !session) return;
    setText('');
    await s.addBeat(role, v);
    if (role === 'instruction') void s.generate();
    if (role !== 'prose') setRole('prose');
  }, [text, role, session, s]);

  function openDirection(regenerateId?: string) {
    setBeatMenu(null);
    setDirText('');
    setDir({ regenerateId });
  }
  async function go() {
    const d = dir;
    setDir(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await s.generate({ direction: dirText.trim() || undefined, regenerateId: d?.regenerateId });
  }
  async function saveEdit(withReweave: boolean) {
    if (!edit) return;
    const { beat, text: v } = edit;
    setEdit(null);
    if (v.trim() === beat.text.trim()) return;
    if (withReweave) await reweave(beat.id, v.trim());
    else await s.editBeat(beat.id, v.trim());
  }
  const downstreamOf = (b: Beat) => path.slice(path.findIndex((x) => x.id === b.id) + 1);

  if (!session) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const renderBeat = ({ item: b }: { item: Beat }) => {
    const pos = siblingPosition(s.index, b.id);
    const meta = b.role === 'prose' && (pos.of > 1 || b.model);
    return (
      <Pressable onPress={() => setBeatMenu(b)} style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}>
        {b.role === 'prose' ? (
          <T style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.6 }}>{b.text}</T>
        ) : b.role === 'instruction' ? (
          <Row style={{ alignItems: 'flex-start' }}>
            <Ionicons name="return-down-forward-outline" size={16} color={t.accent} style={{ marginTop: 3 }} />
            <T v="dim" style={{ flex: 1, fontStyle: 'italic' }}>{b.text}</T>
          </Row>
        ) : (
          <T v="faint" style={{ fontStyle: 'italic' }}>{b.text}</T>
        )}
        {meta ? (
          <Row style={{ marginTop: 6 }} gap={10}>
            {pos.of > 1 ? (
              <Row gap={2}>
                <IconButton name="chevron-back" size={16} color={t.dim} onPress={() => s.swipe(b.id, -1)} style={{ padding: 2 }} />
                <T v="small">{pos.at} / {pos.of}</T>
                <IconButton name="chevron-forward" size={16} color={t.dim} onPress={() => s.swipe(b.id, 1)} style={{ padding: 2 }} />
              </Row>
            ) : null}
            {b.model ? <T v="small">{shortModel(b.model)}{b.direction ? ` · ${b.direction}` : ''}</T> : null}
          </Row>
        ) : null}
      </Pressable>
    );
  };

  const streaming = s.streaming;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: session.title,
          headerRight: () => (
            <Row gap={0}>
              <IconButton name="layers-outline" onPress={() => router.push(`/session/${session.id}/context`)} />
              <IconButton name="ellipsis-horizontal" onPress={() => setMenu(true)} />
            </Row>
          ),
        }}
      />
      {s.error ? <View style={{ padding: space.md }}><Banner text={s.error} onClose={s.clearError} /></View> : null}
      {s.notice ? <View style={{ padding: space.md }}><Banner text={s.notice} tone="info" onClose={() => s.setNotice(null)} /></View> : null}
      <FlatList
        ref={listRef}
        data={path}
        keyExtractor={(b) => b.id}
        renderItem={renderBeat}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
        }}
        scrollEventThrottle={100}
        contentContainerStyle={{ paddingVertical: space.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !streaming ? (
            <Empty icon="create-outline" title="Blank page" hint="Write the opening yourself, add an instruction, or tap Continue and let the writer open. The scene generator lives under the menu." />
          ) : null
        }
        ListFooterComponent={
          streaming ? (
            <View style={{ paddingHorizontal: space.lg, paddingVertical: 8, gap: 8 }}>
              <Row between>
                <Row>
                  <Ionicons name={streaming.phase === 'writing' ? 'pencil-outline' : streaming.phase === 'reweaving' ? 'git-merge-outline' : 'albums-outline'} size={14} color={t.accent} />
                  <T v="small">
                    {streaming.phase === 'summarizing' ? 'Folding older beats into the summary' : streaming.phase === 'reweaving' ? 'Reweaving later passages' : `${shortModel(streaming.model)}${streaming.attempt ? ` · attempt ${streaming.attempt + 1}${streaming.step ? ` · ${streaming.step.kind}` : ''}` : ''}`}
                  </T>
                </Row>
                <Button small kind="outline" title="Stop" onPress={s.stop} />
              </Row>
              {streaming.reasoning ? (
                <Pressable onPress={() => setShowReasoning(!showReasoning)}>
                  <T v="faint">{showReasoning ? '▾ thinking' : '▸ thinking…'}</T>
                  {showReasoning ? <T v="mono" style={{ color: t.dim, marginTop: 4 }}>{streaming.reasoning}</T> : null}
                </Pressable>
              ) : null}
              <T style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.6, color: streaming.phase === 'writing' ? t.text : t.dim }}>{streaming.text}{streaming.text ? '▍' : ''}</T>
              {!streaming.text && !streaming.reasoning ? <T v="faint">…</T> : null}
            </View>
          ) : (
            <View style={{ height: 24 }} />
          )
        }
      />

      {/* Composer */}
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.bg, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Platform.OS === 'ios' ? space.xl : space.md, gap: space.sm }}>
        <Row>
          {(['prose', 'instruction', 'note'] as const).map((r) => (
            <Chip key={r} small label={r === 'prose' ? 'Prose' : r === 'instruction' ? 'Instruction' : 'Note'} selected={role === r} onPress={() => setRole(r)} />
          ))}
          <View style={{ flex: 1 }} />
          <IconButton name="arrow-undo-outline" size={20} onPress={s.undo} disabled={!path.length || !!streaming} />
          <IconButton name="arrow-redo-outline" size={20} onPress={s.redo} disabled={!hasRedo || !!streaming} />
        </Row>
        <Row style={{ alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={role === 'prose' ? 'Write prose…' : role === 'instruction' ? 'Steer the writer, then it continues…' : 'A note to yourself…'}
            placeholderTextColor={t.faint}
            multiline
            style={{ flex: 1, backgroundColor: t.surface, color: t.text, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140, fontFamily: role === 'prose' ? serif : undefined }}
          />
          <IconButton name="arrow-up-circle" size={30} color={text.trim() ? t.accent : t.faint} onPress={send} disabled={!text.trim() || !!streaming} />
        </Row>
        <Row between>
          <Row gap={6}>
            <Pill onPress={() => router.push(`/models?target=session:${session.id}:writer&current=${encodeURIComponent(session.models.writer)}`)}>
              <Ionicons name="hardware-chip-outline" size={13} color={t.dim} />
              <T v="small">{shortModel(session.models.writer)}</T>
            </Pill>
            {session.explicit ? (
              <Pill onPress={() => s.patch({ heat: (session.heat + 1) % 5 })}>
                <Ionicons name="flame-outline" size={13} color={t.warn} />
                <T v="small">{HEAT_LABELS[session.heat]}</T>
              </Pill>
            ) : null}
            {drift.notes.length ? (
              <Pill onPress={() => setDriftOpen(true)}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: drift.score > 0.5 ? t.danger : t.warn }} />
                <T v="small">voice</T>
              </Pill>
            ) : null}
          </Row>
          <Pressable onPress={() => s.generate()} onLongPress={() => openDirection()} disabled={!!streaming} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accent, paddingVertical: 9, paddingLeft: 16, paddingRight: 10, borderRadius: radius.pill, opacity: streaming ? 0.4 : pressed ? 0.8 : 1 })}>
            <T style={{ color: t.accentText, fontWeight: '700' }}>Continue</T>
            <Pressable hitSlop={8} onPress={() => openDirection()} disabled={!!streaming}>
              <Ionicons name="chevron-up" size={16} color={t.accentText} />
            </Pressable>
          </Pressable>
        </Row>
      </View>

      {/* Story menu */}
      <Sheet open={menu} onClose={() => setMenu(false)} title={session.title}>
        <MenuItem icon="options-outline" label="Session settings" hint="Models, cards, preset, style, world, budgets" onPress={() => { setMenu(false); router.push(`/session/${session.id}/settings`); }} />
        <MenuItem icon="layers-outline" label="Context inspector" hint="Exactly what the next request sends" onPress={() => { setMenu(false); router.push(`/session/${session.id}/context`); }} />
        <MenuItem icon="film-outline" label="Next scene" hint="Ask the helper for a scene plan" onPress={() => { setMenu(false); router.push(`/session/${session.id}/scene`); }} />
        <MenuItem icon="git-compare-outline" label="Draft race" hint="Same passage from several models, pick one" onPress={() => { setMenu(false); router.push(`/session/${session.id}/race`); }} />
        <MenuItem icon="albums-outline" label="Summarize now" hint="Fold older beats into the summary" onPress={() => { setMenu(false); void s.summarizeNow(); }} />
      </Sheet>

      {/* Beat menu */}
      <Sheet open={!!beatMenu} onClose={() => setBeatMenu(null)}>
        {beatMenu ? (
          <>
            <T v="faint" numberOfLines={2}>{beatMenu.text}</T>
            <MenuItem icon="create-outline" label="Edit" onPress={() => { setEdit({ beat: beatMenu, text: beatMenu.text }); setBeatMenu(null); }} />
            {beatMenu.role === 'prose' ? <MenuItem icon="refresh-outline" label="Regenerate" hint="A new version as a sibling; the old one stays" onPress={() => { const b = beatMenu; setBeatMenu(null); void s.generate({ regenerateId: b.id }); }} /> : null}
            {beatMenu.role === 'prose' ? <MenuItem icon="compass-outline" label="Regenerate with direction" onPress={() => openDirection(beatMenu.id)} /> : null}
            {beatMenu.id !== session.currentBeatId ? <MenuItem icon="cut-outline" label="Continue from here" hint="Later beats stay on their branch" onPress={() => { const b = beatMenu; setBeatMenu(null); void s.setCurrent(b.id); }} /> : null}
            <MenuItem icon="copy-outline" label="Copy text" onPress={async () => { await Clipboard.setStringAsync(beatMenu.text); setBeatMenu(null); }} />
            <MenuItem icon="trash-outline" label="Delete from here" hint="This beat and everything after it, on every branch" danger onPress={() => { const b = beatMenu; setBeatMenu(null); void s.deleteFrom(b.id); }} />
          </>
        ) : null}
      </Sheet>

      {/* Edit */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Edit" full>
        {edit ? (
          <>
            <Field multiline value={edit.text} onChangeText={(v) => setEdit({ ...edit, text: v })} style={{ minHeight: 220, fontFamily: edit.beat.role === 'prose' ? serif : undefined, fontSize: 16 }} autoFocus />
            <Button title="Save" onPress={() => saveEdit(false)} />
            {edit.beat.role === 'prose' && downstreamOf(edit.beat).some((b) => b.role === 'prose') ? (
              <Button kind="outline" icon="git-merge-outline" title="Save and reweave later passages" onPress={() => saveEdit(true)} />
            ) : null}
            <T v="faint">Reweave puts the edit and rewritten later passages on a new branch. The original stays one swipe away.</T>
          </>
        ) : null}
      </Sheet>

      {/* Direction */}
      <Sheet open={!!dir} onClose={() => setDir(null)} title={dir?.regenerateId ? 'Regenerate with direction' : 'Continue with direction'}>
        <Field value={dirText} onChangeText={setDirText} placeholder="Anything: 'end on the knock at the door'" autoFocus multiline style={{ minHeight: 64 }} />
        <Row style={{ flexWrap: 'wrap' }}>
          {DIRECTIONS.map((d) => <Chip key={d} small label={d} selected={dirText.includes(d.toLowerCase())} onPress={() => setDirText((v) => (v.trim() ? `${v.trim()}, ${d.toLowerCase()}` : d.toLowerCase()))} />)}
        </Row>
        <Button title="Go" icon="play" onPress={go} />
      </Sheet>

      {/* Drift */}
      <Sheet open={driftOpen} onClose={() => setDriftOpen(false)} title="Voice check">
        <T v="dim">Local heuristics against the style card. Informational only.</T>
        {drift.notes.map((n) => <T key={n}>• {n}</T>)}
        <Button kind="outline" title="Regenerate with 'stay on voice'" onPress={() => { setDriftOpen(false); if (lastProse) { setDirText('stay strictly in the established voice; avoid stock phrases'); setDir({ regenerateId: lastProse.id }); } }} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
