import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import type { LensActions } from './Lens';
import type { Character } from '@/core/types';
import { line, placeTree, ring, tiesOf, unplaced, webOrder, type MapPerson, type PlaceNode, type Presence, type StoryMap, type TieKind } from '@/core/storymap';
import { normName } from '@/core/world/drafts';
import { useSession } from '@/state/session';
import { currentBaseMap, useLens } from '@/state/lens';
import { Button, Chip, Ionicons, Row, T } from './index';
import { Avatar } from './EntryImage';
import { radius, useTheme, type Theme } from '../theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
const TIE_ICON: Record<TieKind, Icon> = { family: 'home-outline', romance: 'heart-outline', friend: 'happy-outline', ally: 'shield-outline', work: 'briefcase-outline', rival: 'flash-outline', enemy: 'skull-outline', debt: 'cash-outline', other: 'ellipse-outline' };

const presenceLabel = (p: Presence, playing: boolean) => ({ here: playing ? 'with you' : 'in the scene', near: 'close by', away: 'away', unknown: 'whereabouts unknown', gone: 'gone' })[p];
const presenceColor = (p: Presence, t: Theme) => ({ here: t.accent, near: t.ok, away: t.dim, unknown: t.faint, gone: t.danger })[p];
const toneColor = (tone: number, t: Theme) => (tone > 0 ? t.ok : tone < 0 ? t.danger : t.faint);

/**
 * The Lens's map of the whole story: Places, a schematic of where the scene
 * is and who is in each place, nested the way the places are; and People, a
 * web of how everyone stands with whoever is in the middle (you, in play).
 * Drawn from the library at once; "Read the story" has the helper redraw it as
 * things stand now.
 */
/** What a tap on the map can lead to: an entry's page, or an action for the story. */
interface MapActs {
  playing: boolean;
  open: (name: string) => (() => void) | undefined;
  actions: LensActions;
  close: () => void;
}

export function MapPanel({ width, actions }: { width: number; actions: LensActions }) {
  const t = useTheme();
  const lens = useLens();
  const s = useSession();
  const playing = s.session?.mode === 'pov' && !!s.wb.player;
  const saved = s.session?.world.map;
  const { path, world, wb, bundle } = s;
  const base = useMemo(() => currentBaseMap(), [path, world, wb, bundle]); // eslint-disable-line react-hooks/exhaustive-deps
  const map = saved ?? base;
  const lastProse = useMemo(() => [...path].reverse().find((b) => b.role === 'prose')?.id ?? null, [path]);
  const stale = !!saved && saved.beatId !== lastProse;
  const people = useMemo(() => {
    const all = [...bundle.characters, ...wb.people, ...(wb.player ? [wb.player] : [])];
    return (name: string): Character | undefined => all.find((c) => normName(c.name) === normName(name));
  }, [bundle.characters, wb.people, wb.player]);
  const acts: MapActs = {
    playing,
    actions,
    close: lens.close,
    open: (name) => {
      const c = people(name);
      const e = wb.entities.find((x) => normName(x.name) === normName(name));
      const to = c ? `/library/character/${c.id}` : e ? `/library/entity/${e.id}` : null;
      return to ? () => { lens.close(); router.push(to); } : undefined;
    },
  };

  return (
    <View style={{ gap: 12 }}>
      <Row between>
        <Row gap={6}>
          <Chip small label="Places" selected={lens.mapView === 'places'} onPress={() => lens.setMapView('places')} />
          <Chip small label="People" selected={lens.mapView === 'people'} onPress={() => lens.setMapView('people')} />
        </Row>
        <Button small kind={saved && !stale ? 'ghost' : 'outline'} icon="book-outline" title={saved ? 'Update' : 'Read the story'} loading={lens.busy === 'map'} onPress={() => void lens.readMap()} />
      </Row>
      <T v="faint">
        {!saved
          ? `From the library${playing ? ' and your sheet' : ''}: people at home unless the latest passages name them. Read the story to place everyone where it has them now${playing ? ', as far as you know' : ''}.`
          : stale ? 'Drawn a few passages back. Update to catch up.' : `As of the latest passage${playing ? ', as far as you know' : ''}.`}
      </T>
      {lens.mapView === 'places'
        ? <Places map={map} face={people} playing={playing} acts={acts} onPerson={(n) => lens.setMapView('people', n)} />
        : <Web map={map} face={people} playing={playing} acts={acts} width={width} focus={lens.mapFocus ?? (playing ? wb.player!.name : map.people[0]?.name ?? '')} onFocus={(n) => lens.setMapView('people', n)} />}
      {!map.people.length && !map.places.length ? <T v="faint">Nothing on the map yet. Write a passage or two, then read the story.</T> : null}
      <T v="faint" style={{ color: t.faint }}>{lens.mapView === 'places' ? 'Tap someone to see how they stand with everyone.' : 'Tap anyone to put them in the middle.'}</T>
    </View>
  );
}

function PersonChip({ p, face, playing, onPress }: { p: MapPerson; face: (n: string) => Character | undefined; playing: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = face(p.name);
  return (
    <Pressable onPress={onPress} hitSlop={4} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 150 }}>
      <View>
        <Avatar data={c?.data as Record<string, unknown> | undefined} name={p.name} size={24} />
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: 8, height: 8, borderRadius: 4, backgroundColor: presenceColor(p.presence, t), borderWidth: 1, borderColor: t.surface }} />
      </View>
      <T v="small" numberOfLines={1} style={{ flexShrink: 1, color: t.text }}>{playing && p.presence === 'here' && c?.id === useSession.getState().wb.player?.id ? 'You' : p.name.split(/\s+/)[0]}</T>
    </Pressable>
  );
}

function Places({ map, face, playing, acts, onPerson }: { map: StoryMap; face: (n: string) => Character | undefined; playing: boolean; acts: MapActs; onPerson: (n: string) => void }) {
  const t = useTheme();
  const tree = useMemo(() => placeTree(map), [map]);
  const loose = useMemo(() => unplaced(map), [map]);
  return (
    <View style={{ gap: 8 }}>
      {tree.map((n) => <PlaceBox key={n.place.name} node={n} here={map.here} face={face} playing={playing} acts={acts} onPerson={onPerson} />)}
      {loose.length ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <T v="label">Elsewhere</T>
          {loose.map((p) => (
            <Pressable key={p.name} onPress={() => onPerson(p.name)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Avatar data={face(p.name)?.data as Record<string, unknown> | undefined} name={p.name} size={26} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>{p.name}<T v="small" style={{ color: presenceColor(p.presence, t) }}>{`  ${p.at && p.presence !== 'unknown' && p.presence !== 'gone' ? p.at : presenceLabel(p.presence, playing)}`}</T></T>
                {p.doing ? <T v="faint" numberOfLines={2}>{p.doing}</T> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PlaceBox({ node, here, face, playing, acts, onPerson }: { node: PlaceNode; here: string; face: (n: string) => Character | undefined; playing: boolean; acts: MapActs; onPerson: (n: string) => void }) {
  const t = useTheme();
  const s = useSession();
  const [open, setOpen] = useState(false);
  const isHere = normName(node.place.name) === normName(here);
  const wide = node.depth >= 1;
  const entry = s.wb.entities.find((e) => normName(e.name) === normName(node.place.name));
  const openEntry = acts.open(node.place.name);
  const name = node.place.name;
  return (
    <Pressable onPress={() => setOpen(!open)} style={({ pressed }) => ({ borderWidth: isHere || open ? 1.5 : 1, borderColor: isHere || open ? t.accent : t.border, borderStyle: node.depth === 0 && !isHere && !open ? 'dashed' : 'solid', borderRadius: radius.md, padding: 8, gap: 6, backgroundColor: node.depth % 2 ? t.surface : t.surface2, opacity: pressed ? 0.85 : 1 })}>
      <Row gap={6}>
        <Ionicons name={isHere ? 'navigate' : node.children.length ? 'map-outline' : 'location-outline'} size={13} color={isHere ? t.accent : t.dim} />
        <T v="small" numberOfLines={open ? undefined : 1} style={{ flex: 1, fontWeight: '600', color: t.text }}>{name}</T>
        {isHere ? <T v="small" style={{ color: t.accent }}>{playing ? 'you are here' : 'the scene'}</T> : <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={t.faint} />}
      </Row>
      {node.place.note ? <T v="faint" numberOfLines={open ? undefined : 2}>{node.place.note}</T> : null}
      {open && entry ? <T v="small">{[entry.data.type ? String(entry.data.type) : '', entry.summary || String(entry.data.description ?? '').slice(0, 200)].filter(Boolean).join(' · ')}</T> : null}
      {open ? (
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          {openEntry ? <Button small kind="ghost" icon="open-outline" title="Open entry" onPress={openEntry} /> : null}
          {!isHere && playing ? <Button small kind="outline" icon="navigate-outline" title="Go there" onPress={() => { acts.close(); acts.actions.compose(`You make your way to ${name}.`); }} /> : null}
          {!playing ? <Button small kind="outline" icon="film-outline" title="Set a scene here" onPress={() => { acts.close(); acts.actions.expand(`A scene at ${name}.`); }} /> : null}
        </Row>
      ) : null}
      {node.people.length ? (
        <Row gap={10} style={{ flexWrap: 'wrap' }}>
          {node.people.map((p) => <PersonChip key={p.name} p={p} face={face} playing={playing} onPress={() => onPerson(p.name)} />)}
        </Row>
      ) : null}
      {open ? node.people.filter((p) => p.doing).map((p) => <T key={p.name} v="small"><T v="small" style={{ color: t.text }}>{p.name}: </T>{p.doing}</T>) : null}
      {node.children.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {node.children.map((c) => (
            <View key={c.place.name} style={{ flexGrow: 1, flexBasis: wide || normName(c.place.name) === normName(here) ? '100%' : '46%' }}>
              <PlaceBox node={c} here={here} face={face} playing={playing} acts={acts} onPerson={onPerson} />
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function Web({ map, face, playing, acts, width, focus, onFocus }: { map: StoryMap; face: (n: string) => Character | undefined; playing: boolean; acts: MapActs; width: number; focus: string; onFocus: (n: string) => void }) {
  const t = useTheme();
  const size = Math.max(220, width);
  const others = useMemo(() => webOrder(map, focus, 10), [map, focus]);
  const pts = ring(others.length, size / 2, size / 2, size / 2 - 40);
  const at = (n: string) => { const i = others.findIndex((x) => normName(x) === normName(n)); return i >= 0 ? pts[i]! : normName(n) === normName(focus) ? { x: size / 2, y: size / 2 } : null; };
  const me = map.people.find((p) => normName(p.name) === normName(focus));
  const ties = tiesOf(map, focus).sort((a, b) => b.tie.tone - a.tie.tone);
  const meName = playing ? useSession.getState().wb.player?.name : undefined;
  const label = (n: string) => (meName && normName(n) === normName(meName) ? 'You' : n.split(/\s+/)[0]!);
  if (!focus) return <T v="faint">No one on the map yet.</T>;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ width: size, height: size, alignSelf: 'center' }}>
        <View style={{ position: 'absolute', left: 40, top: 40, width: size - 80, height: size - 80, borderRadius: size, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' }} />
        {map.ties.map((tie, i) => {
          const a = at(tie.a);
          const b = at(tie.b);
          if (!a || !b) return null;
          const mine = normName(tie.a) === normName(focus) || normName(tie.b) === normName(focus);
          const th = mine ? 2 + Math.abs(tie.tone) * 0.7 : 1;
          const l = line(a.x, a.y, b.x, b.y, th);
          return <View key={i} style={{ position: 'absolute', left: l.left, top: l.top, width: l.width, height: th, borderRadius: th, backgroundColor: toneColor(tie.tone, t), opacity: mine ? 0.45 + Math.abs(tie.tone) * 0.18 : 0.25, transform: [{ rotate: `${l.angle}rad` }] }} />;
        })}
        {[focus, ...others].map((n, i) => {
          const p = i === 0 ? { x: size / 2, y: size / 2 } : pts[i - 1]!;
          const person = map.people.find((x) => normName(x.name) === normName(n));
          const big = i === 0 ? 56 : 38;
          return (
            <Pressable key={n} onPress={() => onFocus(n)} style={{ position: 'absolute', left: p.x - 40, top: p.y - big / 2, width: 80, alignItems: 'center' }}>
              <View style={{ borderRadius: big, borderWidth: 2, borderColor: person ? presenceColor(person.presence, t) : t.border, opacity: person?.presence === 'gone' ? 0.5 : 1 }}>
                <Avatar data={face(n)?.data as Record<string, unknown> | undefined} name={n} size={big - 4} />
              </View>
              <T v="small" numberOfLines={1} style={{ color: i === 0 ? t.text : t.dim, fontWeight: i === 0 ? '600' : '400', marginTop: 2, backgroundColor: t.surface, paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' }}>{label(n)}</T>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 4 }}>
        <T v="h">{meName && normName(focus) === normName(meName) ? `You (${focus})` : focus}</T>
        {me ? <T v="small" style={{ color: presenceColor(me.presence, t) }}>{[presenceLabel(me.presence, playing), me.presence !== 'unknown' && me.presence !== 'here' ? me.at : ''].filter(Boolean).join(' · ')}</T> : null}
        {me?.doing ? <T v="dim">{me.doing}</T> : null}
        {!(meName && normName(focus) === normName(meName)) ? (
          <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 4 }}>
            {acts.open(focus) ? <Button small kind="ghost" icon="open-outline" title="Open entry" onPress={acts.open(focus)!} /> : null}
            {playing && me?.presence === 'here' ? <Button small kind="outline" icon="chatbubble-outline" title="Talk" onPress={() => { acts.close(); acts.actions.compose(`You speak to ${focus}.`); }} /> : null}
            {playing && me && me.presence !== 'here' && me.presence !== 'gone' && me.at ? <Button small kind="outline" icon="navigate-outline" title="Find them" onPress={() => { acts.close(); acts.actions.compose(`You go looking for ${focus}${me.presence === 'unknown' ? '' : ` at ${me.at}`}.`); }} /> : null}
            {!playing ? <Button small kind="outline" icon="compass-outline" title="Steer" onPress={() => { acts.close(); acts.actions.steer(`Bring ${focus} to the fore in this passage.`); }} /> : null}
          </Row>
        ) : null}
      </View>
      {ties.length ? (
        <View style={{ gap: 8 }}>
          <T v="label">Ties</T>
          {ties.map(({ other, tie }, i) => (
            <Pressable key={i} onPress={() => onFocus(other)} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name={TIE_ICON[tie.kind]} size={15} color={toneColor(tie.tone, t)} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <T>{label(other) === 'You' ? 'You' : other}<T v="small" style={{ color: toneColor(tie.tone, t) }}>{`  ${tie.kind === 'other' ? '' : tie.kind}${tie.tone ? ` ${tie.tone > 0 ? '+' : ''}${tie.tone}` : ''}`}</T></T>
                {tie.label ? <T v="faint">{tie.label}</T> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : <T v="faint">No ties known{playing ? ' to you' : ''} yet.</T>}
    </View>
  );
}
