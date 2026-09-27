import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Image, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardShift } from '@/ui/keyboard';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import type { Beat, Illustration } from '@/core/types';
import { HEAT_LABELS } from '@/core/types';
import { leafOf, siblingPosition, siblings } from '@/core/beatTree';
import { voiceDrift } from '@/core/voiceDrift';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { reweave } from '@/state/reweave';
import { askNotificationPermission } from '@/state/foreground';
import { Banner, Button, Chip, Empty, Field, IconButton, Ionicons, MenuItem, Pill, Row, Sheet, T } from '@/ui/components';
import { ModelPicker } from '@/ui/components/ModelPicker';
import { radius, serif, space, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

const DIRECTIONS = ['Hotter', 'Softer', 'Slower', 'More dialogue', 'Less dialogue', 'A twist', "Another character's view", 'Shorter', 'Longer', 'Darker'];

/**
 * Composer modes. Write puts your own prose on the page. Direct tells the
 * writer what happens next and lets it write. Scene asks the helper for a
 * scene plan first, then writes from it.
 */
type Mode = 'write' | 'direct' | 'scene';
const MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: 'write', label: 'Write', placeholder: 'Write prose yourself…' },
  { key: 'direct', label: 'Direct', placeholder: 'What happens next; the writer writes it…' },
  { key: 'scene', label: 'Scene', placeholder: 'What the next scene should do, or leave empty…' },
];

export default function Manuscript() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSession();
  const fontSize = useSettings((x) => x.defaults.fontSize);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('direct');
  const [menu, setMenu] = useState(false);
  const [beatMenu, setBeatMenu] = useState<Beat | null>(null);
  const [edit, setEdit] = useState<{ beat: Beat; text: string } | null>(null);
  const [dir, setDir] = useState<{ regenerateId?: string } | null>(null);
  const [dirText, setDirText] = useState('');
  const [showReasoning, setShowReasoning] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftPicker, setDraftPicker] = useState(false);
  const [viewing, setViewing] = useState<Illustration | null>(null);
  const listRef = useRef<FlatList<Beat>>(null);
  const atBottom = useRef(true);
  /** False once the reader scrolls up; auto-scroll pauses until they return to the end or tap the button. */
  const [pinned, setPinned] = useState(true);

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
  const usedModels = useMemo(() => Array.from(new Set(s.beats.map((b) => b.model).filter((m): m is string => !!m))), [s.beats]);
  const illustrationsByBeat = useMemo(() => {
    const m = new Map<string, Illustration[]>();
    for (const i of s.illustrations) if (i.beatId) m.set(i.beatId, [...(m.get(i.beatId) ?? []), i]);
    return m;
  }, [s.illustrations]);

  useEffect(() => {
    if (pinned) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [path.length, s.streaming?.text.length, pinned]);
  const jumpToLatest = () => {
    setPinned(true);
    listRef.current?.scrollToEnd({ animated: true });
  };
  // A Diagnose step in the chain opens the clinic without asking.
  const refusalAuto = s.refusal?.auto;
  useEffect(() => {
    if (refusalAuto && session) router.push(`/session/${session.id}/clinic`);
  }, [refusalAuto, session]);

  const streaming = s.streaming;
  const canSend = mode === 'scene' ? !streaming : !!text.trim() && !streaming;

  const send = useCallback(async () => {
    const v = text.trim();
    if (!session || streaming) return;
    if (mode === 'scene') {
      setText('');
      void askNotificationPermission();
      await s.proposeScene(v);
      return;
    }
    if (!v) return;
    setText('');
    s.clearSuggestions();
    await s.addBeat(mode === 'write' ? 'prose' : 'instruction', v);
    if (mode === 'direct') {
      void askNotificationPermission();
      void s.generate();
    }
  }, [text, mode, session, streaming, s]);

  function openDirection(regenerateId?: string) {
    setBeatMenu(null);
    setDirText('');
    setDir({ regenerateId });
  }
  async function go() {
    const d = dir;
    setDir(null);
    void askNotificationPermission();
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
  async function writeScene(asNote: boolean) {
    const plan = s.sceneProposal;
    if (!plan) return;
    s.clearScene();
    await s.addBeat(asNote ? 'note' : 'instruction', plan);
    if (!asNote) {
      void askNotificationPermission();
      void s.generate();
    }
  }
  async function shareImage(i: Illustration) {
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(i.uri);
      else s.setNotice('Sharing is not available here.');
    } catch (e) {
      s.setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  const toggleDraft = (m: string) => {
    if (!session || m === session.models.writer) return;
    const has = session.draftModels.includes(m);
    if (!has && session.draftModels.length >= 2) return;
    void s.patch({ draftModels: has ? session.draftModels.filter((x) => x !== m) : [...session.draftModels, m] });
  };
  const downstreamOf = (b: Beat) => path.slice(path.findIndex((x) => x.id === b.id) + 1);

  if (!session) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const width = Dimensions.get('window').width;

  const renderBeat = ({ item: b }: { item: Beat }) => {
    const pos = siblingPosition(s.index, b.id);
    const sibs = pos.of > 1 ? siblings(s.index, b.id) : [];
    const multiModel = sibs.length > 1 && new Set(sibs.map((x) => x.model)).size > 1;
    const meta = b.role === 'prose' && (pos.of > 1 || b.model);
    const pics = illustrationsByBeat.get(b.id) ?? [];
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
        {pics.length ? (
          <Row style={{ marginTop: 8, flexWrap: 'wrap' }} gap={6}>
            {pics.map((i) => (
              <Pressable key={i.id} onPress={() => setViewing(i)}>
                <Image source={{ uri: i.uri }} style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: t.surface }} />
              </Pressable>
            ))}
          </Row>
        ) : null}
        {meta ? (
          <Row style={{ marginTop: 6, flexWrap: 'wrap' }} gap={10}>
            {pos.of > 1 ? (
              <Row gap={2}>
                <IconButton name="chevron-back" size={16} color={t.dim} onPress={() => s.swipe(b.id, -1)} style={{ padding: 2 }} />
                <T v="small">{pos.at} / {pos.of}</T>
                <IconButton name="chevron-forward" size={16} color={t.dim} onPress={() => s.swipe(b.id, 1)} style={{ padding: 2 }} />
              </Row>
            ) : null}
            {multiModel ? (
              <Row gap={4} style={{ flexWrap: 'wrap' }}>
                {sibs.map((x) => <Chip key={x.id} small label={shortModel(x.model ?? 'you')} selected={x.id === b.id} onPress={() => s.setCurrent(leafOf(s.index, x.id).id)} />)}
              </Row>
            ) : b.model ? <T v="small">{shortModel(b.model)}{b.direction ? ` · ${b.direction}` : ''}</T> : null}
          </Row>
        ) : null}
      </Pressable>
    );
  };

  const phaseLabel = !streaming ? '' : streaming.phase === 'summarizing' ? 'Folding older beats into the summary' : streaming.phase === 'reweaving' ? 'Reweaving later passages' : streaming.phase === 'planning' ? 'Planning the passage' : streaming.phase === 'critiquing' ? 'Editor is reading' : streaming.phase === 'proposing' ? 'Planning the next scene' : streaming.phase === 'suggesting' ? 'Thinking of next moves' : streaming.phase === 'illustrating' ? (streaming.text ? `Painting with ${shortModel(streaming.model)}` : 'Describing the picture') : `${shortModel(streaming.model)}${streaming.attempt ? ` · attempt ${streaming.attempt + 1}${streaming.step ? ` · ${streaming.step.kind}` : ''}` : ''}`;
  const phaseIcon = !streaming ? 'pencil-outline' : streaming.phase === 'writing' ? 'pencil-outline' : streaming.phase === 'reweaving' ? 'git-merge-outline' : streaming.phase === 'planning' || streaming.phase === 'proposing' ? 'map-outline' : streaming.phase === 'critiquing' ? 'glasses-outline' : streaming.phase === 'suggesting' ? 'sparkles-outline' : streaming.phase === 'illustrating' ? 'image-outline' : 'albums-outline';

  return (
    <KeyboardShift style={{ flex: 1, backgroundColor: t.bg }} offset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
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
      {s.refusal && !streaming ? (
        <View style={{ marginHorizontal: space.md, marginBottom: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: t.surface, gap: 8 }}>
          <T v="dim">{shortModel(s.refusal.model)} refused{s.refusal.auto ? '; the chain stopped for diagnosis' : ''}.</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small icon="medkit-outline" title="Open the clinic" onPress={() => router.push(`/session/${session.id}/clinic`)} />
            <Button small kind="outline" icon="refresh-outline" title="Retry" onPress={() => { void s.retryRefusal(); }} />
            <Button small kind="ghost" title="Dismiss" onPress={s.clearRefusal} />
          </Row>
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        data={path}
        keyExtractor={(b) => b.id}
        renderItem={renderBeat}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const nowAtBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
          if (nowAtBottom !== atBottom.current) {
            atBottom.current = nowAtBottom;
            // Back at the end by hand: resume following. Auto-scroll itself never unpins.
            if (nowAtBottom) setPinned(true);
          }
        }}
        onScrollBeginDrag={() => setPinned(false)}
        scrollEventThrottle={100}
        contentContainerStyle={{ paddingVertical: space.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !streaming ? (
            <Empty icon="create-outline" title="Blank page" hint={session.brief ? 'Tap Continue to open from the brief, Direct the writer, ask for a Scene, or Write the opening yourself.' : 'Write the opening yourself, Direct the writer, or tap Continue and let it open. Set a brief in session settings so the writer knows what the story is.'} />
          ) : null
        }
        ListFooterComponent={
          streaming ? (
            <View style={{ paddingHorizontal: space.lg, paddingVertical: 8, gap: 8 }}>
              <Row between>
                <Row>
                  <Ionicons name={phaseIcon} size={14} color={t.accent} />
                  <T v="small">{phaseLabel}</T>
                </Row>
                <Row gap={6}>
                  {streaming.phase === 'writing' && streaming.attempt > 0 ? <Button small icon="medkit-outline" title="Diagnose instead" onPress={s.diagnoseNow} /> : null}
                  <Button small kind="outline" title="Stop" onPress={s.stop} />
                </Row>
              </Row>
              {streaming.phase === 'writing' && streaming.attempt > 0 ? <T v="faint">Attempt {streaming.attempt} came back as a refusal. Retrying{streaming.step ? ` via ${streaming.step.kind}` : ''}; or stop and take it to the clinic.</T> : null}
              {streaming.reasoning ? (
                <Pressable onPress={() => setShowReasoning(!showReasoning)}>
                  <T v="faint">{showReasoning ? '▾ thinking' : '▸ thinking…'}</T>
                  {showReasoning ? <T v="mono" style={{ color: t.dim, marginTop: 4 }}>{streaming.reasoning}</T> : null}
                </Pressable>
              ) : null}
              <T style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.6, color: streaming.phase === 'writing' ? t.text : t.dim }}>{streaming.text}{streaming.text ? '▍' : ''}</T>
              {!streaming.text && !streaming.reasoning ? <T v="faint">…</T> : null}
              {s.drafts.map((d) => (
                <Row key={d.model} style={{ alignItems: 'flex-start' }}>
                  <Ionicons name={d.done ? (d.error ? 'alert-circle-outline' : 'checkmark-circle-outline') : 'ellipse-outline'} size={14} color={d.error ? t.danger : t.dim} style={{ marginTop: 2 }} />
                  <T v="small" style={{ flex: 1 }}>{shortModel(d.model)}: {d.error ? d.error : d.done ? `${d.text.split(/\s+/).filter(Boolean).length} words, kept as a sibling` : `${d.text.split(/\s+/).filter(Boolean).length} words…`}</T>
                </Row>
              ))}
            </View>
          ) : (
            <View style={{ height: 24 }} />
          )
        }
      />

      {!pinned ? (
        <View style={{ alignItems: 'center', marginTop: -44, marginBottom: 8 }} pointerEvents="box-none">
          <Pressable onPress={jumpToLatest} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, opacity: pressed ? 0.7 : 1 })}>
            <Ionicons name="arrow-down" size={14} color={t.text} />
            <T v="small" style={{ color: t.text }}>{streaming ? 'Follow the writing' : 'Latest'}</T>
          </Pressable>
        </View>
      ) : null}

      {/* Composer */}
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.bg, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Platform.OS === 'ios' ? space.xl : space.md, gap: space.sm }}>
        {s.suggestions.length ? (
          <Row style={{ flexWrap: 'wrap' }} gap={6}>
            {s.suggestions.map((sg) => <Chip key={sg} small label={sg} onPress={() => { setMode('direct'); setText(sg); }} />)}
            <IconButton name="close" size={16} color={t.faint} onPress={s.clearSuggestions} style={{ padding: 4 }} />
          </Row>
        ) : null}
        <Row>
          {MODES.map((m) => <Chip key={m.key} small label={m.label} selected={mode === m.key} onPress={() => setMode(m.key)} />)}
          <IconButton name="sparkles-outline" size={18} color={s.suggestions.length ? t.accent : t.dim} onPress={() => { void askNotificationPermission(); void s.suggest(); }} disabled={!!streaming} style={{ padding: 4 }} />
          <View style={{ flex: 1 }} />
          <IconButton name="arrow-undo-outline" size={20} onPress={s.undo} disabled={!path.length || !!streaming} />
          <IconButton name="arrow-redo-outline" size={20} onPress={s.redo} disabled={!hasRedo || !!streaming} />
        </Row>
        <Row style={{ alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={MODES.find((m) => m.key === mode)!.placeholder}
            placeholderTextColor={t.faint}
            multiline
            style={{ flex: 1, backgroundColor: t.surface, color: t.text, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140, fontFamily: mode === 'write' ? serif : undefined }}
          />
          <IconButton name={mode === 'scene' ? 'film-outline' : 'arrow-up-circle'} size={mode === 'scene' ? 26 : 30} color={canSend ? t.accent : t.faint} onPress={send} disabled={!canSend} />
        </Row>
        <Row between>
          <Row gap={6} style={{ flexWrap: 'wrap', flex: 1 }}>
            <Pill onPress={() => router.push(`/models?target=session:${session.id}:writer&current=${encodeURIComponent(session.models.writer)}`)}>
              <Ionicons name="hardware-chip-outline" size={13} color={t.dim} />
              <T v="small">{shortModel(session.models.writer)}</T>
            </Pill>
            <Pill onPress={() => setDraftsOpen(true)}>
              <Ionicons name="git-compare-outline" size={13} color={session.draftModels.length ? t.accent : t.dim} />
              <T v="small">{session.draftModels.length ? `+${session.draftModels.length} draft${session.draftModels.length > 1 ? 's' : ''}` : 'drafts'}</T>
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
          <Pressable onPress={() => { void askNotificationPermission(); void s.generate(); }} onLongPress={() => openDirection()} disabled={!!streaming} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accent, paddingVertical: 9, paddingLeft: 16, paddingRight: 10, borderRadius: radius.pill, opacity: streaming ? 0.4 : pressed ? 0.8 : 1 })}>
            <T style={{ color: t.accentText, fontWeight: '700' }}>Continue</T>
            <Pressable hitSlop={8} onPress={() => openDirection()} disabled={!!streaming}>
              <Ionicons name="chevron-up" size={16} color={t.accentText} />
            </Pressable>
          </Pressable>
        </Row>
      </View>

      {/* Story menu */}
      <Sheet open={menu} onClose={() => setMenu(false)} title={session.title}>
        <MenuItem icon="options-outline" label="Session settings" hint="Brief, models, voice, world, characters, budgets" onPress={() => { setMenu(false); router.push(`/session/${session.id}/settings`); }} />
        <MenuItem icon="text-outline" label={s.bundle.style ? `Voice · ${s.bundle.style.name}` : 'Voice'} hint={s.bundle.style ? 'Writer prompt, persistence chain and card. Shared across stories.' : 'No voice attached; pick one in session settings'} onPress={() => { setMenu(false); router.push(session.styleId ? `/library/style/${session.styleId}` : `/session/${session.id}/settings`); }} />
        <MenuItem icon="flask-outline" label="Prompt lab" hint="A strong model revises the voice or brief against a goal; test, then override or save as new" onPress={() => { setMenu(false); router.push(`/lab?session=${session.id}`); }} />
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
            {beatMenu.role === 'prose' && beatMenu.model ? <MenuItem icon="glasses-outline" label="Critique and redo" hint="The helper marks up this passage; the writer rewrites it against the notes" onPress={() => { const b = beatMenu; setBeatMenu(null); void s.critiqueAndRedo(b.id); }} /> : null}
            {beatMenu.role === 'prose' ? <MenuItem icon="image-outline" label="Illustrate" hint="The helper describes the strongest moment; the image model paints it" onPress={() => { const b = beatMenu; setBeatMenu(null); void askNotificationPermission(); void s.illustrate(b.id); }} /> : null}
            {beatMenu.plan ? <MenuItem icon="map-outline" label="Show the plan it followed" onPress={() => { const b = beatMenu; setBeatMenu(null); s.setNotice(`Plan: ${b.plan}`); }} /> : null}
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

      {/* Scene proposal */}
      <Sheet open={!!s.sceneProposal} onClose={s.clearScene} title="Next scene" full>
        <T selectable>{s.sceneProposal}</T>
        <Button title="Write it" icon="play" onPress={() => writeScene(false)} />
        <Row>
          <Button kind="outline" title="Another" icon="refresh-outline" onPress={() => { void s.proposeScene(''); }} />
          <Button kind="ghost" title="Keep as a note" onPress={() => writeScene(true)} />
        </Row>
      </Sheet>

      {/* Extra drafts */}
      <Sheet open={draftsOpen} onClose={() => setDraftsOpen(false)} title="Extra drafts">
        <T v="dim">Up to two more models write every passage alongside {shortModel(session.models.writer)}. They land as siblings you can swipe between in place; keep the one you like.</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {Array.from(new Set([...session.draftModels, ...usedModels])).filter((m) => m !== session.models.writer).map((m) => <Chip key={m} label={shortModel(m)} selected={session.draftModels.includes(m)} onPress={() => toggleDraft(m)} />)}
          <Chip label="Add a model" onPress={() => setDraftPicker(true)} />
        </Row>
        {session.draftModels.length ? <Button kind="ghost" title="Turn off extra drafts" onPress={() => s.patch({ draftModels: [] })} /> : null}
      </Sheet>
      <ModelPicker open={draftPicker} onClose={() => setDraftPicker(false)} onSelect={(m) => toggleDraft(m)} pinned={usedModels} title="Extra draft model" />

      {/* Illustration */}
      <Sheet open={!!viewing} onClose={() => setViewing(null)} full>
        {viewing ? (
          <>
            <Image source={{ uri: viewing.uri }} style={{ width: width - space.lg * 2, height: width - space.lg * 2, borderRadius: radius.lg, backgroundColor: t.surface }} resizeMode="contain" />
            <T v="faint">{viewing.prompt}</T>
            <T v="small">{shortModel(viewing.model)}</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Button kind="outline" icon="share-outline" title="Share" onPress={() => shareImage(viewing)} />
              <Button kind="outline" icon="refresh-outline" title="Another" onPress={() => { const v = viewing; setViewing(null); if (v.beatId) void s.illustrate(v.beatId); }} />
              <Button kind="danger" icon="trash-outline" title="Delete" onPress={() => { const v = viewing; setViewing(null); void s.removeIllustration(v.id); }} />
            </Row>
          </>
        ) : null}
      </Sheet>

      {/* Drift */}
      <Sheet open={driftOpen} onClose={() => setDriftOpen(false)} title="Voice check">
        <T v="dim">Local heuristics against the voice card. Informational only.</T>
        {drift.notes.map((n) => <T key={n}>• {n}</T>)}
        <Button kind="outline" title="Regenerate with 'stay on voice'" onPress={() => { setDriftOpen(false); if (lastProse) { setDirText('stay strictly in the established voice; avoid stock phrases'); setDir({ regenerateId: lastProse.id }); } }} />
      </Sheet>
    </KeyboardShift>
  );
}
