import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Image, Platform, Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardShift } from '@/ui/keyboard';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import type { Beat, Illustration } from '@/core/types';
import type { CheckResult } from '@/core/world/types';
import { formatDuration, formatShort, formatTime } from '@/core/world/calendar';
import { RESOURCES, RESOURCE_INFO, parseEffects, parseInventory, sheetDiff } from '@/core/world/survival';
import { ATTRIBUTE_INFO, OUTCOME_LABEL } from '@/core/world/dice';
import { childrenOf } from '@/core/world/scan';
import { chronicleOn } from '@/state/world';
import { Bar, TimeEditor } from '@/ui/components/World';
import { Avatar, worldLine } from '@/ui/components/EntryImage';
import { LensDrawer } from '@/ui/components/Lens';
import { useLens } from '@/state/lens';
import { segments } from '@/core/lens';
import { entryTip, findMentions } from '@/core/world/mentions';
import { EntryTipCard } from '@/ui/components/EntryTip';
import { composePicture, entryImagePrompt } from '@/core/world/forge';
import { complete, paintReady } from '@/state/paint';
import { ForgeSheet } from '@/ui/components/Forge';
import { imageOf, namedIn } from '@/core/world/portraits';
import { excerptsFor, type Newcomer } from '@/core/world/forge';
import { KIND_NOUN, libraryDrafts, normName } from '@/core/world/drafts';
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
type Mode = 'write' | 'direct' | 'scene' | 'do' | 'say';
const POV_MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: 'do', label: 'Do', placeholder: 'What you do…' },
  { key: 'say', label: 'Say', placeholder: 'What you say…' },
];
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
  const imageBackend = useSettings((x) => x.defaults.imageBackend);
  const lensOn = useSettings((x) => x.defaults.lens);
  const tipsOn = useSettings((x) => x.defaults.entryTips);
  const lens = useLens();
  const [text, setText] = useState('');
  const [rawMode, setMode] = useState<Mode>('direct');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<'status' | 'inventory' | 'aims' | 'people'>('status');
  const [clockOpen, setClockOpen] = useState(false);
  const [travelOpen, setTravelOpen] = useState(false);
  const [canonOpen, setCanonOpen] = useState(false);
  const [adjMoney, setAdjMoney] = useState('');
  const [peek, setPeek] = useState(false);
  const [adjItem, setAdjItem] = useState('');
  const [canonize, setCanonize] = useState<Newcomer | null>(null);
  const [tip, setTip] = useState<{ id: string; beatId: string; y: number } | null>(null);
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
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const listRef = useRef<FlatList<Beat>>(null);
  const atBottom = useRef(true);
  /** False once the reader scrolls up; auto-scroll pauses until they return to the end or tap the button. */
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (id) void s.open(db, id);
    if (id) void useLens.getState().load(db, id);
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      const st = useSession.getState();
      if (st.session?.id === id && !st.streaming) void st.reload();
    }, [id]),
  );

  const session = s.session;
  const path = s.path;
  const world = s.world;
  const playing = session?.mode === 'pov' && !!s.wb.player;
  const mode: Mode = playing ? (rawMode === 'say' ? 'say' : 'do') : rawMode === 'do' || rawMode === 'say' ? 'direct' : rawMode;
  const calendar = s.bundle.universe?.data.calendar;
  const currency = s.bundle.universe?.data.currency || 'coins';
  const clockShown = !!session && chronicleOn(session);
  const sheet = world?.scene.pov;
  const quick = (text: string) => { void askNotificationPermission(); void s.act(text); };
  const lastProse = useMemo(() => [...path].reverse().find((b) => b.role === 'prose'), [path]);
  const drift = useMemo(() => {
    const prose = path.filter((b) => b.role === 'prose');
    const earlier = prose.slice(-6, -1).map((b) => b.text).join('\n');
    return voiceDrift(lastProse?.text ?? '', s.bundle.style, earlier);
  }, [lastProse, path, s.bundle.style]);
  const hasRedo = !!session && (s.index.children.get(session.currentBeatId)?.length ?? 0) > 0;
  const usedModels = useMemo(() => Array.from(new Set(s.beats.map((b) => b.model).filter((m): m is string => !!m))), [s.beats]);
  /** Everyone in the story or its world who has a portrait: shown beside the passages that name them. */
  const portraitPeople = useMemo(() => [...s.bundle.characters, ...s.wb.people, ...(s.wb.player ? [s.wb.player] : [])].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i && imageOf(c.data as Record<string, unknown>)), [s.bundle.characters, s.wb.people, s.wb.player]);
  /** What each passage did to the player's sheet, for the line under it. */
  const sheetChanges = useMemo(() => {
    const m = new Map<string, string[]>();
    if (session?.mode !== 'pov') return m;
    let prev = path.find((b) => b.state?.pov)?.state?.pov ?? null;
    let seen = false;
    for (const b of path) {
      const pov = b.state?.pov;
      if (!pov) continue;
      if (seen && b.role === 'prose') { const d = sheetDiff(prev, pov, currency); if (d.length) m.set(b.id, d); }
      prev = pov;
      seen = true;
    }
    return m;
  }, [path, session?.mode, currency]);
  const lastProseId = useMemo(() => [...path].reverse().find((b) => b.role === 'prose')?.id, [path]);
  const illustrationsByBeat = useMemo(() => {
    const m = new Map<string, Illustration[]>();
    for (const i of s.illustrations) if (i.beatId) m.set(i.beatId, [...(m.get(i.beatId) ?? []), i]);
    return m;
  }, [s.illustrations]);
  /** In play in a world of your own: the library entries a passage names become links to a quick card. */
  const tipsHere = tipsOn && session?.mode === 'pov' && !!session.universeId && !!s.bundle.universe && !s.bundle.universe.isDefault;
  const { bundle, wb } = s;
  const tipPool = useMemo(() => {
    if (!tipsHere) return [];
    const characters = [...bundle.characters, ...wb.people].filter((c, i, a) => c.id !== wb.player?.id && a.findIndex((x) => x.id === c.id) === i);
    return libraryDrafts({ universe: null, entities: wb.entities, characters, species: bundle.species, lore: bundle.lore });
  }, [tipsHere, bundle, wb]);
  const mentionsByBeat = useMemo(() => {
    const m = new Map<string, ReturnType<typeof findMentions>>();
    if (tipPool.length) for (const b of path) if (b.role === 'prose') m.set(b.id, findMentions(b.text, tipPool));
    return m;
  }, [path, tipPool]);

  useEffect(() => {
    if (pinned) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [path.length, s.streaming?.text.length, pinned]);
  const jumpToLatest = () => {
    setPinned(true);
    listRef.current?.scrollToEnd({ animated: true });
  };
  // A Diagnose step in the chain opens the clinic without asking.
  const refusalAuto = s.refusal?.auto;
  const sessionId = session?.id;
  useEffect(() => {
    if (refusalAuto && sessionId) {
      useSession.getState().ackClinic();
      router.push(`/session/${sessionId}/clinic`);
    }
  }, [refusalAuto, sessionId]);

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
    if (mode === 'do' || mode === 'say') {
      void askNotificationPermission();
      await s.act(mode === 'say' ? `You say: “${v.replace(/^["“]|["”]$/g, '')}”` : v);
      return;
    }
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
  /** A picture of something the Lens found: described from its card, with the world's art direction, then shown to paint or copy. */
  async function lensPicture(beatId: string, name: string, description: string) {
    if (!session) return;
    try {
      const subject = await complete({ model: session.models.helper, messages: entryImagePrompt({ draft: { id: 'lens', kind: 'item', name, fields: { summary: description } }, world: worldLine(s.bundle.universe) }), maxTokens: 2000, temperature: 0.7, spend: { db, note: 'lens picture', sessionId: session.id } });
      const prompt = composePicture('lore', subject.text.trim() || description, { art: s.bundle.universe?.data.artStyle?.trim() || useSettings.getState().defaults.artStyle.trim() });
      useSession.setState({ imagePrompt: { beatId, prompt, canPaint: paintReady().ok } });
    } catch (e) {
      s.setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  const downstreamOf = (b: Beat) => path.slice(path.findIndex((x) => x.id === b.id) + 1);

  if (!session) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const width = Dimensions.get('window').width;

  const renderBeat = ({ item: b }: { item: Beat }) => {
    const pos = siblingPosition(s.index, b.id);
    const sibs = pos.of > 1 ? siblings(s.index, b.id) : [];
    const multiModel = sibs.length > 1 && new Set(sibs.map((x) => x.model)).size > 1;
    const faces = b.role === 'prose' ? portraitPeople.filter((c) => namedIn(b.text, c.name)).slice(0, 5) : [];
    const changed = sheetChanges.get(b.id);
    const meta = b.role === 'prose' && (pos.of > 1 || b.model || faces.length || changed || lensOn);
    const pics = illustrationsByBeat.get(b.id) ?? [];
    return (
      <Pressable onPress={() => setBeatMenu(b)} style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}>
        {b.role === 'prose' ? (
          <T style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.6 }}>
            {(lensOn && lens.data[b.id]) || mentionsByBeat.get(b.id)?.length
              ? segments(b.text, lensOn ? lens.data[b.id]?.points ?? [] : [], mentionsByBeat.get(b.id) ?? []).map((seg, i) => (seg.link
                ? <T key={i} onPress={(e) => setTip({ id: seg.link!, beatId: b.id, y: e.nativeEvent.pageY })} style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.6, textDecorationLine: 'underline', textDecorationColor: t.faint }}>{seg.text}</T>
                : seg.point == null
                ? seg.text
                : <T key={i} onPress={() => void lens.show(b.id, [seg.point!])} style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.6, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: t.accent }}>{seg.text}</T>))
              : b.text}
          </T>
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
            {faces.length ? (
              <Row gap={4}>
                {faces.map((c) => <Pressable key={c.id} onPress={() => router.push(`/library/character/${c.id}`)} hitSlop={4}><Avatar data={c.data as Record<string, unknown>} name={c.name} size={22} /></Pressable>)}
              </Row>
            ) : null}
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
            {b.at != null && clockShown ? <T v="small" style={{ color: t.faint }}>{formatShort(calendar, b.at)}</T> : null}
            {b.state?.pov?.lastCheck ? <CheckChip c={b.state.pov.lastCheck} /> : null}
            {changed ? <T v="small" style={{ color: t.accent }}>{changed.join(' · ')}</T> : null}
            {lensOn ? (
              <Pressable onPress={() => void lens.show(b.id)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="scan-outline" size={14} color={lens.data[b.id] ? t.accent : t.faint} />
                <T v="small" style={{ color: lens.data[b.id] ? t.accent : t.faint }}>Lens</T>
              </Pressable>
            ) : null}
          </Row>
        ) : null}
      </Pressable>
    );
  };

  const phaseLabel = !streaming ? '' : streaming.phase === 'refereeing' ? 'The game master reads the turn' : streaming.phase === 'chronicling' ? 'Recording what changed' : streaming.phase === 'summarizing' ? 'Folding older beats into the summary' : streaming.phase === 'reweaving' ? 'Reweaving later passages' : streaming.phase === 'planning' ? 'Planning the passage' : streaming.phase === 'critiquing' ? 'Editor is reading' : streaming.phase === 'proposing' ? 'Planning the next scene' : streaming.phase === 'suggesting' ? 'Thinking of next moves' : streaming.phase === 'illustrating' ? (streaming.text ? `Painting with ${shortModel(streaming.model)}` : 'Describing the picture') : `${shortModel(streaming.model)}${streaming.attempt ? ` · attempt ${streaming.attempt + 1}${streaming.step ? ` · ${streaming.step.kind}` : ''}` : ''}`;
  const phaseIcon = !streaming ? 'pencil-outline' : streaming.phase === 'refereeing' ? 'dice-outline' : streaming.phase === 'chronicling' ? 'git-commit-outline' : streaming.phase === 'writing' ? 'pencil-outline' : streaming.phase === 'reweaving' ? 'git-merge-outline' : streaming.phase === 'planning' || streaming.phase === 'proposing' ? 'map-outline' : streaming.phase === 'critiquing' ? 'glasses-outline' : streaming.phase === 'suggesting' ? 'sparkles-outline' : streaming.phase === 'illustrating' ? 'image-outline' : 'albums-outline';

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
          <T v="dim">{shortModel(s.refusal.model)} refused.{s.clinic ? ' The clinic has its diagnosis open.' : ''}</T>
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
        {world && (clockShown || playing) ? (
          <Pressable onPress={() => (playing ? setSheetOpen(true) : setClockOpen(true))} style={{ gap: 6 }}>
            <Row gap={8}>
              {playing && s.wb.player && imageOf(s.wb.player.data as Record<string, unknown>) ? <Avatar data={s.wb.player.data as Record<string, unknown>} name={s.wb.player.name} size={22} /> : null}
              <Ionicons name="time-outline" size={13} color={t.dim} />
              <T v="small">{formatShort(calendar, world.now)}</T>
              {world.scene.locationName ? <><Ionicons name="location-outline" size={13} color={t.dim} /><T v="small" numberOfLines={1} style={{ flex: 1 }}>{world.scene.locationName}</T></> : <View style={{ flex: 1 }} />}
              {playing && sheet ? <T v="small" style={{ color: t.accent }}>{sheet.money} {currency}</T> : null}
            </Row>
            {playing && sheet ? (
              <Row gap={6}>
                {RESOURCES.map((r) => <Bar key={r} label={RESOURCE_INFO[r].label} value={sheet.resources[r]} />)}
              </Row>
            ) : null}
            {playing && sheet && (sheet.conditions.length || sheet.down) ? <T v="small" style={{ color: t.danger }} numberOfLines={1}>{[sheet.down ? 'down' : '', ...sheet.conditions].filter(Boolean).join(' · ')}</T> : null}
          </Pressable>
        ) : null}
        {playing ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip small label="Look around" onPress={() => quick('You look around, taking in the place and the people in it.')} />
            <Chip small label="Go to…" onPress={() => setTravelOpen(true)} />
            <Chip small label="Rest" onPress={() => quick('You find somewhere as safe as you can and rest, sleeping if you can.')} />
            <Chip small label="Wait an hour" onPress={() => quick('You wait for an hour, watching what happens around you.')} />
            <Chip small label="Inventory" onPress={() => { setSheetTab('inventory'); setSheetOpen(true); }} />
          </ScrollView>
        ) : null}
        {session.world.newcomers?.length && !streaming ? (
          <Pressable onPress={() => setCanonOpen(true)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
            <Ionicons name="person-add-outline" size={14} color={t.accent} />
            <T v="small" numberOfLines={1} style={{ flex: 1 }}>New in the story: {session.world.newcomers.map((n) => n.name).join(', ')}</T>
            <T v="small" style={{ color: t.accent }}>Canonize</T>
          </Pressable>
        ) : null}
        {s.suggestions.length ? (
          <Row style={{ flexWrap: 'wrap' }} gap={6}>
            {s.suggestions.map((sg) => <Chip key={sg} small label={sg} onPress={() => { setMode('direct'); setText(sg); }} />)}
            <IconButton name="close" size={16} color={t.faint} onPress={s.clearSuggestions} style={{ padding: 4 }} />
          </Row>
        ) : null}
        <Row>
          {(playing ? POV_MODES : MODES).map((m) => <Chip key={m.key} small label={m.label} selected={mode === m.key} onPress={() => setMode(m.key)} />)}
          <IconButton name="sparkles-outline" size={18} color={s.suggestions.length ? t.accent : t.dim} onPress={() => { void askNotificationPermission(); void s.suggest(); }} disabled={!!streaming} style={{ padding: 4 }} />
          <View style={{ flex: 1 }} />
          <IconButton name="arrow-undo-outline" size={20} onPress={s.undo} disabled={!path.length || !!streaming} />
          <IconButton name="arrow-redo-outline" size={20} onPress={s.redo} disabled={!hasRedo || !!streaming} />
        </Row>
        <Row style={{ alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={[...MODES, ...POV_MODES].find((m) => m.key === mode)!.placeholder}
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
        {lensOn && playing ? <MenuItem icon="search-outline" label={`Clue board${session.world.clues?.filter((c) => !c.solved).length ? ` · ${session.world.clues.filter((c) => !c.solved).length}` : ''}`} hint="Details the Lens turned up; connect them to work out what is going on" onPress={() => { setMenu(false); useLens.getState().showClues(); }} /> : null}
        {lensOn ? <MenuItem icon="git-network-outline" label="Story map" hint="Where everyone is and how they stand with each other" onPress={() => { setMenu(false); useLens.getState().showMap(); }} /> : null}
        {lensOn && session.world.pins?.length ? <MenuItem icon="pin-outline" label={`Pinned details · ${session.world.pins.length}`} hint="What the Lens made fact; open a passage's Lens to unpin" onPress={() => { setMenu(false); if (lastProse) void useLens.getState().show(lastProse.id); }} /> : null}
        <MenuItem icon="albums-outline" label="Summarize now" hint="Fold older beats into the summary" onPress={() => { setMenu(false); void s.summarizeNow(); }} />
        {session.universeId && !s.bundle.universe?.isDefault ? <MenuItem icon="planet-outline" label={`World · ${s.bundle.universe?.name ?? ''}`} hint="Places, people, factions, things, lore" onPress={() => { setMenu(false); router.push(`/library/universe/${session.universeId}`); }} /> : null}
        {session.instanceId && (session.world.continuity || clockShown) ? <MenuItem icon="git-commit-outline" label="Timeline" hint="What has happened in this version of the world" onPress={() => { setMenu(false); router.push(`/world/instance/${session.instanceId}`); }} /> : null}
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
            {beatMenu.role === 'prose' && imageBackend.kind !== 'prompt' ? <MenuItem icon="image-outline" label="Illustrate" hint="The helper describes the strongest moment; the image model paints it" onPress={() => { const b = beatMenu; setBeatMenu(null); void askNotificationPermission(); void s.illustrate(b.id); }} /> : null}
            {beatMenu.role === 'prose' ? <MenuItem icon="color-palette-outline" label="Picture prompt" hint="Only the image prompt, to paste into Perchance or any generator" onPress={() => { const b = beatMenu; setBeatMenu(null); void s.illustrate(b.id, { promptOnly: true }); }} /> : null}
            {beatMenu.role === 'prose' && beatMenu.id === lastProseId && chronicleOn(session) ? <MenuItem icon="git-commit-outline" label="Record again" hint="Run the chronicle for this passage again: time, place, events and the sheet" onPress={() => { const b = beatMenu; setBeatMenu(null); void s.rechronicle(b.id); }} /> : null}
            {beatMenu.role === 'prose' ? <MenuItem icon="person-add-outline" label="Find new names" hint="People, places, factions and things in this passage that the library lacks, to canonize" onPress={() => { const b = beatMenu; setBeatMenu(null); void s.findNewcomers(b.id); }} /> : null}
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

      {/* Image prompt to take elsewhere */}
      <Sheet open={canonOpen} onClose={() => setCanonOpen(false)} title="New in the story">
        <T v="faint">Names this story brought in that {s.bundle.universe?.isDefault ? 'your library' : s.bundle.universe?.name ?? 'the world'} does not have yet. Canonize one to forge its entry from what the story says, then edit or reforge any field before saving. New characters join this story’s cast.</T>
        {(session.world.newcomers ?? []).map((n) => (
          <View key={n.name} style={{ gap: 4, paddingVertical: 6 }}>
            <Row between>
              <T v="h" style={{ flex: 1 }}>{n.name}</T>
              <T v="small">{KIND_NOUN[n.kind].toLowerCase()}</T>
            </Row>
            {n.note ? <T v="dim">{n.note}</T> : null}
            <Row>
              <Button small icon="sparkles-outline" title="Canonize" onPress={() => { setCanonOpen(false); setCanonize(n); }} />
              <Button small kind="ghost" title="Not now" onPress={() => s.dismissNewcomer(n.name)} />
            </Row>
          </View>
        ))}
        {!session.world.newcomers?.length ? <T v="faint">Nothing waiting. With the chronicle on, new names are noticed after each passage; any passage’s menu has Find new names.</T> : null}
      </Sheet>
      {tip ? (() => {
        const d = tipPool.find((x) => x.id === tip.id);
        if (!d) return null;
        const row = d.kind === 'character' ? [...s.bundle.characters, ...s.wb.people].find((c) => c.id === d.id) : d.kind === 'species' ? s.bundle.species.find((x) => x.id === d.id) : s.wb.entities.find((e) => e.id === d.id);
        const points = lens.data[tip.beatId]?.points ?? [];
        const at = points.findIndex((p) => normName(p.ref || p.name) === normName(d.name));
        return (
          <EntryTipCard
            tip={entryTip(d, { pov: sheet, currency })}
            data={row?.data as Record<string, unknown> | undefined}
            at={{ y: tip.y }}
            onClose={() => setTip(null)}
            onOpen={() => { setTip(null); router.push(d.kind === 'character' ? `/library/character/${d.id}` : d.kind === 'species' || d.kind === 'lore' ? `/library/universe/${session.universeId}` : `/library/entity/${d.id}`); }}
            onLens={lensOn ? () => { setTip(null); void lens.show(tip.beatId, at >= 0 ? [at] : []); } : undefined}
          />
        );
      })() : null}
      {lensOn ? (
        <LensDrawer
          actions={{
            compose: (v) => { setMode(playing ? 'do' : 'direct'); setText(v); },
            canonize: (name, kind) => setCanonize({ name, kind, note: '' }),
            illustrate: (beatId, name, description) => void lensPicture(beatId, name, description),
          }}
        />
      ) : null}
      <ForgeSheet
        open={!!canonize}
        onClose={() => setCanonize(null)}
        kind={canonize?.kind ?? 'character'}
        universeId={session.universeId}
        canon={canonize ? { name: canonize.name, kind: canonize.kind, excerpts: excerptsFor(canonize.name, path.filter((b) => b.role === 'prose').map((b) => b.text)) } : null}
        onSaved={(plan, drafts) => {
          const name = canonize?.name;
          if (!name) return;
          const ids = drafts.filter((d) => d.kind === 'character').map((d) => d.id).filter((id) => { const c = plan.characters.find((x) => x.id === id); return !!c && (!session.explicit || c.adult); });
          void s.canonized(name, ids);
        }}
      />
      <Sheet open={!!s.imagePrompt} onClose={() => { s.clearImagePrompt(); setPromptDraft(null); }} title="Picture prompt" full>
        <Field multiline value={promptDraft ?? s.imagePrompt?.prompt ?? ''} onChangeText={setPromptDraft} style={{ fontFamily: serif, fontSize: 16, minHeight: 160 }} />
        <T v="faint">{s.imagePrompt?.canPaint ? 'Edit freely, then paint it here or take it to another generator. If the painter refuses, cut what it objects to and paint again; the story is untouched.' : 'Paste it into Perchance, Civitai, a local web UI or any other generator. Nothing was sent anywhere; this is just the description.'}</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {s.imagePrompt?.canPaint ? <Button icon="color-palette-outline" title="Paint" onPress={() => { const ip = s.imagePrompt; const p = (promptDraft ?? ip?.prompt ?? '').trim(); setPromptDraft(null); if (ip && p) { void askNotificationPermission(); void s.paint(ip.beatId, p); } }} /> : null}
          <Button kind={s.imagePrompt?.canPaint ? 'outline' : 'primary'} icon="copy-outline" title="Copy" onPress={async () => { const p = (promptDraft ?? s.imagePrompt?.prompt ?? '').trim(); if (p) { await Clipboard.setStringAsync(p); s.clearImagePrompt(); setPromptDraft(null); s.setNotice('Prompt copied.'); } }} />
          <Button kind="outline" icon="share-outline" title="Share" onPress={async () => { const p = (promptDraft ?? s.imagePrompt?.prompt ?? '').trim(); if (p) { s.clearImagePrompt(); setPromptDraft(null); await Share.share({ message: p }); } }} />
          <Button kind="ghost" icon="refresh-outline" title="Another" onPress={() => { const b = s.imagePrompt?.beatId; s.clearImagePrompt(); setPromptDraft(null); if (b) void s.illustrate(b, { promptOnly: true }); }} />
        </Row>
      </Sheet>

      {/* Illustration */}
      <Sheet open={!!viewing} onClose={() => setViewing(null)} full>
        {viewing ? (
          <>
            <Image source={{ uri: viewing.uri }} style={{ width: width - space.lg * 2, height: width - space.lg * 2, borderRadius: radius.lg, backgroundColor: t.surface }} resizeMode="contain" />
            <T v="faint">{viewing.prompt}</T>
            <T v="small">{shortModel(viewing.model)}</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Button kind="outline" icon="share-outline" title="Share" onPress={() => shareImage(viewing)} />
              <Button kind="outline" icon="copy-outline" title="Copy prompt" onPress={async () => { await Clipboard.setStringAsync(viewing.prompt); s.setNotice('Prompt copied.'); }} />
              <Button kind="outline" icon="refresh-outline" title="Another" onPress={() => { const v = viewing; setViewing(null); if (v.beatId) void s.illustrate(v.beatId); }} />
              <Button kind="danger" icon="trash-outline" title="Delete" onPress={() => { const v = viewing; setViewing(null); void s.removeIllustration(v.id); }} />
            </Row>
          </>
        ) : null}
      </Sheet>

      {/* Character sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={s.wb.player?.name ?? 'Character'} full>
        {sheet && world ? (
          <>
            <Row style={{ flexWrap: 'wrap' }}>
              {(['status', 'inventory', 'aims', 'people'] as const).map((k) => <Chip key={k} small label={k === 'status' ? 'Status' : k === 'inventory' ? `Inventory · ${sheet.inventory.reduce((n, i) => n + i.qty, 0)}` : k === 'aims' ? `Aims · ${sheet.objectives.filter((o) => !o.done).length}` : 'People'} selected={sheetTab === k} onPress={() => setSheetTab(k)} />)}
            </Row>
            {sheetTab === 'status' ? (
              <>
                <T v="dim">{formatTime(calendar, world.now)}{world.scene.locationName ? ` · ${world.scene.locationName}` : ''}</T>
                {RESOURCES.map((r) => (
                  <View key={r} style={{ gap: 2 }}>
                    <Row between><T>{RESOURCE_INFO[r].label}</T><T v="dim">{sheet.resources[r]}</T></Row>
                    <Bar label="" value={sheet.resources[r]} />
                  </View>
                ))}
                <T>Money: {sheet.money} {currency}</T>
                {sheet.conditions.length ? <T>Afflictions: {sheet.conditions.join(', ')}</T> : <T v="faint">No afflictions.</T>}
                {sheet.down ? <Banner text={session.pov?.difficulty === 'hardcore' ? 'Fallen. Undo to go back to an earlier moment, or play out the end.' : 'Down. The story goes on, at a cost.'} tone="warn" /> : null}
                <T v="label">Attributes</T>
                <T v="dim">{(Object.keys(ATTRIBUTE_INFO) as (keyof typeof ATTRIBUTE_INFO)[]).map((a) => `${ATTRIBUTE_INFO[a].label} ${s.wb.player?.data.attributes?.[a] ?? 2}`).join(' · ')}</T>
                <T v="faint">{session.pov?.difficulty === 'story' ? 'Story difficulty: needs do not run down with time.' : `${session.pov?.difficulty === 'hardcore' ? 'Hardcore' : 'Survival'}: food, water and energy run down as time passes; rest restores energy.`}</T>
              </>
            ) : sheetTab === 'inventory' ? (
              <>
                {sheet.inventory.length ? sheet.inventory.map((it) => {
                  const def = s.wb.entities.find((e) => e.kind === 'item' && e.name.toLowerCase() === it.name.toLowerCase());
                  const usable = Object.keys(parseEffects(def?.data.effects ?? it.note ?? '')).length > 0;
                  return (
                    <Row key={it.name} between>
                      <View style={{ flex: 1 }}><T>{it.qty > 1 ? `${it.qty} × ` : ''}{it.name}</T>{def?.summary ? <T v="faint" numberOfLines={1}>{def.summary}</T> : null}</View>
                      <Row gap={4}>
                        {usable ? <Button small title="Use" onPress={() => { setSheetOpen(false); void s.useItem(it.name); }} disabled={!!streaming} /> : <Button small kind="outline" title="Use" onPress={() => { setSheetOpen(false); quick(`You use the ${it.name}.`); }} disabled={!!streaming} />}
                        <Button small kind="ghost" title="Drop" onPress={() => { setSheetOpen(false); quick(`You drop the ${it.name}.`); }} disabled={!!streaming} />
                      </Row>
                    </Row>
                  );
                }) : <T v="faint">Carrying nothing.</T>}
                <T v="faint">Things with effects in the world’s Things list (food, medicine) apply them at once; anything else is acted out.</T>
                <View style={{ gap: 8, marginTop: 8 }}>
                  <T v="label">Correct the books</T>
                  <Row>
                    <View style={{ flex: 1 }}><Field value={adjMoney} onChangeText={setAdjMoney} placeholder={`Amount of ${currency}`} keyboardType="numeric" /></View>
                    <Button small title="Add" onPress={() => { const n = Math.round(Number(adjMoney)); if (n > 0) { void s.adjustSheet({ money: n }); setAdjMoney(''); } }} />
                    <Button small kind="outline" title="Take" onPress={() => { const n = Math.round(Number(adjMoney)); if (n > 0) { void s.adjustSheet({ money: -n }); setAdjMoney(''); } }} />
                  </Row>
                  <Row>
                    <View style={{ flex: 1 }}><Field value={adjItem} onChangeText={setAdjItem} placeholder="A thing, e.g. 2 × ration bar" /></View>
                    <Button small title="Add" onPress={() => { const items = parseInventory(adjItem); if (items.length) { void s.adjustSheet({ gained: items }); setAdjItem(''); } }} />
                    <Button small kind="outline" title="Remove" onPress={() => { const items = parseInventory(adjItem); if (items.length) { void s.adjustSheet({ lost: items }); setAdjItem(''); } }} />
                  </Row>
                  <T v="faint">For when the story and the sheet disagree. Changes sit on the latest passage, so undo takes them back too. The latest passage’s menu also has Record again.</T>
                </View>
              </>
            ) : sheetTab === 'aims' ? (
              <>
                {sheet.objectives.length ? sheet.objectives.map((o) => <T key={o.text} v={o.done ? 'faint' : 'body'} style={o.done ? { textDecorationLine: 'line-through' } : undefined}>• {o.text}</T>) : <T v="faint">No aims yet. They appear as the story gives you some.</T>}
                {sheet.threads?.length ? (
                  <View style={{ gap: 6, marginTop: 12 }}>
                    <Pressable onPress={() => setPeek((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name={peek ? 'eye-outline' : 'eye-off-outline'} size={14} color={t.dim} />
                      <T v="small">{peek ? 'Behind the screen' : 'Peek behind the screen (spoilers)'}</T>
                    </Pressable>
                    {peek ? sheet.threads.map((th) => (
                      <View key={th.name} style={{ gap: 2, opacity: th.status === 'open' ? 1 : 0.5 }}>
                        <T>{th.name} <T v="faint">· {th.kind} · {th.status === 'open' ? `${th.clock}/${th.size}` : th.status}{th.surfaced ? ' · seen' : ''}</T></T>
                        <T v="faint">{th.status === 'open' ? th.hook : th.outcome}</T>
                      </View>
                    )) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                {Object.keys(sheet.relations).length ? Object.entries(sheet.relations).map(([n, r]) => { const who = [...s.wb.people, ...s.bundle.characters].find((c) => c.name.toLowerCase() === n.toLowerCase()); return <Row key={n} between><Row gap={8}>{who ? <Avatar data={who.data as Record<string, unknown>} name={who.name} size={24} /> : null}<T>{n}</T></Row><T v="dim">{r.attitude > 0 ? `+${r.attitude}` : r.attitude}{r.note ? ` · ${r.note}` : ''}</T></Row>; }) : <T v="faint">Nobody has an opinion of you yet.</T>}
              </>
            )}
          </>
        ) : <T v="dim">Pick a played character in session settings.</T>}
      </Sheet>

      {/* Clock */}
      <Sheet open={clockOpen} onClose={() => setClockOpen(false)} title="Time and place" full>
        {world ? (
          <>
            <TimeEditor calendar={calendar} value={world.now} onChange={(m) => void s.setClock(m)} label={path.length ? 'Now, at the current passage' : 'The story opens at'} />
            <Row style={{ flexWrap: 'wrap' }}>
              {[60, 480, 1440].map((m) => <Chip key={m} small label={`+ ${formatDuration(m)}`} onPress={() => void s.setClock(world.now + m)} />)}
            </Row>
            <T v="label">Recorded in this story</T>
            {world.events.filter((e) => e.sessionId === session.id).slice().reverse().slice(0, 30).map((e) => (
              <View key={e.id} style={{ gap: 2 }}>
                <T v="small" style={{ color: t.accent }}>{formatShort(calendar, e.at)}{e.importance === 3 ? ' · major' : ''}</T>
                <T>{e.title}</T>
              </View>
            ))}
            {!world.events.some((e) => e.sessionId === session.id) ? <T v="faint">{clockShown ? 'Nothing yet. The chronicle records events as passages are written.' : 'Chronicle is off for this story.'}</T> : null}
            {session.instanceId ? <Button kind="outline" icon="git-commit-outline" title="Open the instance timeline" onPress={() => { setClockOpen(false); router.push(`/world/instance/${session.instanceId}`); }} /> : null}
          </>
        ) : null}
      </Sheet>

      {/* Travel */}
      <Sheet open={travelOpen} onClose={() => setTravelOpen(false)} title="Go to">
        {(() => {
          const here = world?.scene.locationId ? s.wb.entities.find((e) => e.id === world.scene.locationId) : undefined;
          const places = s.wb.entities.filter((e) => e.kind === 'location');
          const near = here ? [...childrenOf(here.id, places), ...(here.parentId ? [places.find((p) => p.id === here.parentId)!, ...childrenOf(here.parentId, places).filter((p) => p.id !== here.id)] : [])].filter(Boolean) : [];
          const rest = places.filter((p) => p.id !== here?.id && !near.includes(p));
          return (
            <>
              {near.length ? <T v="label">Nearby</T> : null}
              {near.map((p) => <MenuItem key={p.id} icon="navigate-outline" label={p.name} hint={p.summary} onPress={() => { setTravelOpen(false); quick(`You make your way to ${p.name}.`); }} />)}
              {rest.length ? <T v="label">Elsewhere</T> : null}
              {rest.map((p) => <MenuItem key={p.id} icon="map-outline" label={p.name} hint={p.summary} onPress={() => { setTravelOpen(false); quick(`You set out for ${p.name}.`); }} />)}
              {!places.length ? <T v="faint">This world has no places yet. Type where you go instead.</T> : null}
            </>
          );
        })()}
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

function CheckChip({ c }: { c: CheckResult }) {
  const t = useTheme();
  const good = c.outcome === 'success' || c.outcome === 'crit-success';
  const color = good ? t.ok : c.outcome === 'partial' ? t.warn : t.danger;
  return (
    <Row gap={4}>
      <Ionicons name="dice-outline" size={13} color={color} />
      <T v="small" style={{ color }}>{ATTRIBUTE_INFO[c.attribute].label} {c.total} vs {c.difficulty} · {OUTCOME_LABEL[c.outcome]}</T>
    </Row>
  );
}
