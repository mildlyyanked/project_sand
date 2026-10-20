import React, { useMemo, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, View } from 'react-native';
import type { Character } from '@/core/types';
import type { LensPoint, PointKind } from '@/core/lens';
import { normName } from '@/core/world/drafts';
import { namedIn } from '@/core/world/portraits';
import { formatShort } from '@/core/world/calendar';
import { useSession } from '@/state/session';
import { pointAt, useLens } from '@/state/lens';
import { Banner, Button, Chip, Field, Ionicons, Row, T } from './index';
import { Avatar } from './EntryImage';
import { MapPanel } from './StoryMap';
import { radius, space, useTheme } from '../theme';

const ICON: Record<PointKind, 'person-outline' | 'location-outline' | 'cube-outline' | 'flag-outline' | 'eye-outline'> = { person: 'person-outline', place: 'location-outline', thing: 'cube-outline', faction: 'flag-outline', detail: 'eye-outline' };
const GROUPS: { kind: PointKind; label: string }[] = [{ kind: 'person', label: 'People' }, { kind: 'place', label: 'Places' }, { kind: 'thing', label: 'Things' }, { kind: 'faction', label: 'Factions' }, { kind: 'detail', label: 'Details' }];

/** What the drawer can ask the story screen to do: put words in the composer, canonize, illustrate. */
export interface LensActions {
  compose: (text: string) => void;
  canonize: (name: string, kind: 'character' | 'location' | 'organization' | 'item') => void;
  illustrate: (beatId: string, name: string, description: string) => void;
}

const CANON_KIND: Record<PointKind, 'character' | 'location' | 'organization' | 'item'> = { person: 'character', place: 'location', thing: 'item', faction: 'organization', detail: 'item' };

/**
 * The Lens drawer: a passage's points of interest, the people in the scene and
 * what has happened here, a card per point with "look closer", and in play the
 * clue board. Slides in from the right over the story.
 */
export function LensDrawer({ actions }: { actions: LensActions }) {
  const t = useTheme();
  const lens = useLens();
  const s = useSession();
  const width = Math.min(440, Dimensions.get('window').width * 0.9);
  const playing = s.session?.mode === 'pov' && !!s.wb.player;
  const data = lens.beatId ? lens.data[lens.beatId] : undefined;
  const point = pointAt(data, lens.path);
  const beat = lens.beatId ? s.index.byId.get(lens.beatId) : undefined;

  return (
    <Modal visible={lens.open} transparent animationType="fade" onRequestClose={() => (lens.path.length ? lens.go(lens.path.slice(0, -1)) : lens.close())}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable onPress={lens.close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <View style={{ width, backgroundColor: t.surface, borderTopLeftRadius: 18, borderBottomLeftRadius: 18, paddingTop: 44 }}>
          <Row between style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <Row gap={8}>
              <Ionicons name="scan-outline" size={18} color={t.accent} />
              <T v="h">Lens</T>
            </Row>
            <Row gap={6}>
              <Chip small label="Scene" selected={lens.tab === 'scene'} onPress={() => lens.setTab('scene')} />
              <Chip small label="Map" selected={lens.tab === 'map'} onPress={() => lens.setTab('map')} />
              {playing ? <Chip small label={`Clues${s.session?.world.clues?.filter((c) => !c.solved).length ? ` · ${s.session.world.clues.filter((c) => !c.solved).length}` : ''}`} selected={lens.tab === 'clues'} onPress={() => lens.setTab('clues')} /> : null}
              <Pressable onPress={lens.close} hitSlop={10}><Ionicons name="close" size={20} color={t.dim} /></Pressable>
            </Row>
          </Row>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 4, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            {lens.error ? <Banner text={lens.error} onClose={lens.clearError} /> : null}
            {lens.tab === 'map' ? <MapPanel width={width - space.lg * 2} /> : lens.tab === 'clues' && playing ? <ClueBoard /> : point ? <CardView point={point} actions={actions} playing={playing} /> : <SceneView actions={actions} playing={playing} />}
            {lens.tab === 'scene' && !point && beat && data ? <Button small kind="ghost" icon="refresh-outline" title="Look again" onPress={() => lens.scan(beat.id)} loading={lens.busy === 'scan'} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SceneView({ playing }: { actions: LensActions; playing: boolean }) {
  const t = useTheme();
  const lens = useLens();
  const s = useSession();
  const data = lens.beatId ? lens.data[lens.beatId] : undefined;
  const beat = lens.beatId ? s.index.byId.get(lens.beatId) : undefined;
  const pins = s.session?.world.pins ?? [];

  // Who is here: people the passage names, from the cast and the world, with how they stand.
  const people = useMemo(() => {
    if (!beat) return [] as Character[];
    const pool = [...s.bundle.characters, ...s.wb.people].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i && c.id !== s.wb.player?.id);
    return pool.filter((c) => namedIn(beat.text, c.name) || data?.points.some((p) => p.kind === 'person' && p.ref && normName(p.ref) === normName(c.name)));
  }, [beat, data, s.bundle.characters, s.wb.people, s.wb.player]);
  const scene = beat?.state ?? s.world?.scene;
  const placeId = scene?.locationId ?? null;
  const history = useMemo(() => {
    const ids = new Set([...(placeId ? [placeId] : []), ...people.map((p) => p.id)]);
    return (s.world?.events ?? []).filter((e) => e.entities.some((r) => r.id && ids.has(r.id))).slice(-6).reverse();
  }, [s.world?.events, people, placeId]);
  const relations = playing ? s.world?.scene.pov?.relations ?? {} : {};
  const orgName = (c: Character) => { const m = c.data.memberships?.[0]; const o = m ? s.wb.entities.find((e) => e.id === m.orgId) : undefined; return o ? `${o.name}${m!.role ? `, ${m!.role}` : ''}` : ''; };

  if (!beat) return <T v="faint">Open the Lens from a passage.</T>;
  if (!data) return lens.busy === 'scan' ? <T v="faint">Looking over the passage…</T> : <Button icon="scan-outline" title="Look over this passage" onPress={() => lens.scan(beat.id)} />;

  return (
    <>
      {people.length ? (
        <View style={{ gap: 8 }}>
          <T v="label">Who’s here</T>
          {people.map((c) => {
            const rel = relations[c.name];
            const point = data.points.findIndex((p) => p.kind === 'person' && (normName(p.ref || p.name) === normName(c.name) || namedIn(c.name, p.name)));
            return (
              <Pressable key={c.id} onPress={() => (point >= 0 ? lens.go([point]) : undefined)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Avatar data={c.data as Record<string, unknown>} name={c.name} size={34} />
                <View style={{ flex: 1 }}>
                  <T numberOfLines={1}>{c.name}{rel ? <T v="small" style={{ color: rel.attitude > 0 ? t.ok : rel.attitude < 0 ? t.danger : t.dim }}>{`  ${rel.attitude > 0 ? '+' : ''}${rel.attitude} toward you`}</T> : null}</T>
                  <T v="faint" numberOfLines={2}>{[c.data.occupation, orgName(c), rel?.note || c.summary].filter(Boolean).join(' · ')}</T>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {GROUPS.map((g) => {
        const items = data.points.map((p, i) => ({ p, i })).filter((x) => x.p.kind === g.kind);
        if (!items.length) return null;
        return (
          <View key={g.kind} style={{ gap: 6 }}>
            <T v="label">{g.label}</T>
            {items.map(({ p, i }) => <PointRow key={i} point={p} onPress={() => lens.go([i])} />)}
          </View>
        );
      })}
      {history.length ? (
        <View style={{ gap: 6 }}>
          <T v="label">History here</T>
          {history.map((e) => <T key={e.id} v="dim"><T v="small" style={{ color: t.faint }}>{formatShort(s.bundle.universe?.data.calendar, e.at)}  </T>{e.title}</T>)}
        </View>
      ) : null}
      {pins.length ? (
        <View style={{ gap: 6 }}>
          <T v="label">Pinned in this story</T>
          {pins.map((p) => (
            <Row key={p.id} style={{ alignItems: 'flex-start' }}>
              <Ionicons name="pin" size={14} color={t.accent} style={{ marginTop: 3 }} />
              <T v="dim" style={{ flex: 1 }}>{p.name}: {p.text}</T>
              <Pressable onPress={() => lens.unpin(p.id)} hitSlop={8}><Ionicons name="close" size={14} color={t.faint} /></Pressable>
            </Row>
          ))}
        </View>
      ) : null}
      <T v="faint">{playing ? 'What your character can see and knows. Pinned details become fact for the game master; Examine and Ask put an action in your hands.' : 'Tap anything to look closer. What the Lens says is a suggestion until you pin it; pinned details become fact for the writer.'}</T>
    </>
  );
}

function PointRow({ point, onPress }: { point: LensPoint; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={ICON[point.kind]} size={16} color={point.card ? t.accent : t.dim} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <T>{point.name}{point.ref ? <T v="small" style={{ color: t.faint }}>  in your library</T> : null}</T>
        {point.blurb ? <T v="faint" numberOfLines={2}>{point.blurb}</T> : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color={t.faint} style={{ marginTop: 3 }} />
    </Pressable>
  );
}

function CardView({ point, actions, playing }: { point: LensPoint; actions: LensActions; playing: boolean }) {
  const t = useTheme();
  const lens = useLens();
  const s = useSession();
  const data = lens.beatId ? lens.data[lens.beatId] : undefined;
  const pinned = new Set((s.session?.world.pins ?? []).map((p) => normName(p.text)));
  const crumbs = lens.path.map((_, i) => pointAt(data, lens.path.slice(0, i + 1))?.name ?? '');
  const card = point.card;
  const say = (text: string) => { actions.compose(text); lens.close(); };
  const kind = point.kind;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>
        <Pressable onPress={() => lens.go([])} hitSlop={6}><T v="small" style={{ color: t.accent }}>Scene</T></Pressable>
        {crumbs.map((c, i) => (
          <Row key={i} gap={4}>
            <Ionicons name="chevron-forward" size={12} color={t.faint} />
            <Pressable onPress={() => lens.go(lens.path.slice(0, i + 1))} disabled={i === crumbs.length - 1} hitSlop={6}><T v="small" style={{ color: i === crumbs.length - 1 ? t.text : t.accent }}>{c}</T></Pressable>
          </Row>
        ))}
      </ScrollView>
      <Row gap={8}>
        <Ionicons name={ICON[kind]} size={20} color={t.accent} />
        <T v="h" style={{ flex: 1 }}>{point.name}</T>
      </Row>
      {!card ? (
        <T v="faint">{lens.busy === 'card' ? 'Looking closer…' : point.blurb}</T>
      ) : (
        <>
          <T style={{ lineHeight: 22 }}>{card.text}</T>
          {card.facts.length ? (
            <View style={{ gap: 6 }}>
              <T v="label">{playing ? 'What you can tell' : 'Details'}</T>
              {card.facts.map((f) => (
                <Pressable key={f} onPress={() => lens.pin(point.name, f)} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Ionicons name={pinned.has(normName(f)) ? 'pin' : 'pin-outline'} size={15} color={pinned.has(normName(f)) ? t.accent : t.faint} style={{ marginTop: 2 }} />
                  <T v="dim" style={{ flex: 1 }}>{f}</T>
                </Pressable>
              ))}
              <T v="faint">Tap a detail to pin it: pinned details are fact from the next passage on.</T>
            </View>
          ) : null}
          {playing && card.unknown ? <View style={{ gap: 4 }}><T v="label">Not yet known</T><T v="dim">{card.unknown}</T></View> : null}
          {playing && card.clue ? <Row style={{ alignItems: 'flex-start' }}><Ionicons name="search-outline" size={14} color={t.warn} style={{ marginTop: 3 }} /><T v="small" style={{ flex: 1, color: t.warn }}>Something here feels like it matters. It is on your clue board.</T></Row> : null}
          {card.closer.length ? (
            <View style={{ gap: 4 }}>
              <T v="label">Look closer</T>
              {card.closer.map((c, i) => <PointRow key={i} point={c} onPress={() => lens.go([...lens.path, i])} />)}
            </View>
          ) : null}
        </>
      )}
      <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.border, paddingTop: space.md }}>
        {playing ? (
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small icon="search-outline" title="Examine" onPress={() => say(`You examine ${point.name} closely.`)} />
            {kind === 'person' ? <Button small kind="outline" icon="chatbubble-outline" title="Talk" onPress={() => say(`You speak to ${point.name}.`)} /> : <Button small kind="outline" icon="help-outline" title="Ask about it" onPress={() => say(`You ask about ${point.name}.`)} />}
            {kind === 'thing' || kind === 'detail' ? <Button small kind="outline" icon="hand-left-outline" title="Take" onPress={() => say(`You take ${point.name}.`)} /> : null}
            {kind === 'place' ? <Button small kind="outline" icon="navigate-outline" title="Go there" onPress={() => say(`You make your way to ${point.name}.`)} /> : null}
          </Row>
        ) : (
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small icon="compass-outline" title="Steer" onPress={() => say(`Bring ${point.name} to the fore in the next passage.`)} />
            <Button small kind="outline" icon="expand-outline" title="Expand into a scene" onPress={() => say(`Write a scene that centres on ${point.name}.`)} />
          </Row>
        )}
        <Row style={{ flexWrap: 'wrap' }}>
          {card && lens.beatId ? <Button small kind="ghost" icon="image-outline" title="Picture" onPress={() => { actions.illustrate(lens.beatId!, point.name, card.text); lens.close(); }} /> : null}
          {!point.ref && kind !== 'detail' ? <Button small kind="ghost" icon="sparkles-outline" title="Canonize" onPress={() => { actions.canonize(point.name, CANON_KIND[kind]); lens.close(); }} /> : null}
        </Row>
      </View>
    </>
  );
}

function ClueBoard() {
  const t = useTheme();
  const lens = useLens();
  const s = useSession();
  const clues = s.session?.world.clues ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [theory, setTheory] = useState('');
  const open = clues.filter((c) => !c.solved);
  const solved = clues.filter((c) => c.solved);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <T v="faint">Details that felt like they mattered gather here as you look around with the Lens. Connect the ones you think belong together and say what you think is going on. Get it right and your character acts on what they know; the world notices.</T>
      {open.length ? open.map((c) => (
        <Pressable key={c.id} onPress={() => toggle(c.id)} style={{ flexDirection: 'row', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: picked.has(c.id) ? t.accent : t.border, backgroundColor: picked.has(c.id) ? t.surface2 : 'transparent' }}>
          <Ionicons name={picked.has(c.id) ? 'link' : 'search-outline'} size={16} color={picked.has(c.id) ? t.accent : t.dim} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}><T>{c.name}</T><T v="dim">{c.text}</T></View>
        </Pressable>
      )) : <T v="faint">No clues yet. Open the Lens on passages and look closer at what catches your eye.</T>}
      {open.length ? (
        <>
          <Field value={theory} onChangeText={setTheory} placeholder="What do you think is going on?" multiline style={{ minHeight: 70 }} />
          <Button icon="git-merge-outline" title={picked.size ? `Connect ${picked.size} clue${picked.size === 1 ? '' : 's'}` : 'Pick clues to connect'} onPress={() => lens.guess([...picked], theory)} loading={lens.busy === 'guess'} disabled={!picked.size} />
        </>
      ) : null}
      {lens.verdict ? (
        <View style={{ gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: t.surface2 }}>
          <T v="label" style={{ color: lens.verdict.verdict === 'hit' ? t.ok : lens.verdict.verdict === 'close' ? t.warn : t.dim }}>{lens.verdict.verdict === 'hit' ? 'It clicks' : lens.verdict.verdict === 'close' ? 'Close' : 'Not quite'}</T>
          <T>{lens.verdict.nudge}</T>
        </View>
      ) : null}
      {solved.length ? (
        <View style={{ gap: 4 }}>
          <T v="label">Pieced together</T>
          {solved.map((c) => <T key={c.id} v="faint">✓ {c.name}: {c.text}</T>)}
        </View>
      ) : null}
    </>
  );
}
