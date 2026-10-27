import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, TextInput, View, type GestureResponderEvent } from 'react-native';
import { formatDuration, formatShort, timeOfDay } from '@/core/world/calendar';
import { RESOURCES } from '@/core/world/survival';
import { normName } from '@/core/world/drafts';
import { imageOf } from '@/core/world/portraits';
import { SCALES, at, findPath, passCost, positions, spotAt, spotsOf, terrainName, upScale, walkMinutes, type Level } from '@/core/sim/grid';
import { crowdAt, facesAt, peopleAt } from '@/core/sim/crowd';
import { services } from '@/core/sim/actions';
import { placeChain } from '@/core/sim/narrate';
import type { Actor, Face, Place, SimState } from '@/core/sim/types';
import { useSession } from '@/state/session';
import { askNotificationPermission } from '@/state/foreground';
import { Banner, Button, Chip, IconButton, Ionicons, Row, T } from './index';
import { Avatar } from './EntryImage';
import { AtlasSheet, PersonSheet, ShopSheet, attColor, useSimNow, venueIcon, type SimHandlers, type Who } from './Sim';
import { radius, serif, space, useScheme, useTheme } from '../theme';

/**
 * Play, map first. The map of where you are fills the screen: terrain, the
 * places you can go into, things to deal with, and the people about. Tap to
 * walk; go in to zoom in a scale, come out to zoom out. Talk and anything
 * that matters happens in the interaction panel, which slides up over the
 * map and holds this stretch of the story and the composer. The full story
 * is in the Journal.
 */
const DARK: Record<string, string> = { '.': '#2b2722', '#': '#0b0b0d', '+': '#6b4f2a', '=': '#3d3a35', ':': '#34312b', ',': '#22331f', T: '#162818', '"': '#3a3a22', '~': '#1c3346', W: '#10243a', '^': '#4a4540', s: '#5a4e32', '%': '#253425', '*': '#6f7a82', B: '#2a2a32', ' ': '#06070c', x: '#3b352f', d: '#2c3138' };
const LIGHT: Record<string, string> = { '.': '#e8dfcf', '#': '#8f877d', '+': '#b88a4a', '=': '#d6d1c4', ':': '#e3ddd0', ',': '#cfe0c0', T: '#a3c296', '"': '#e6dfb0', '~': '#b9d4e8', W: '#93b6d6', '^': '#b9b0a6', s: '#efdcae', '%': '#b7c9a9', '*': '#f4f6f8', B: '#c4c1cb', ' ': '#1a1d29', x: '#cbbfae', d: '#cfd5dc' };

type Sel = { x: number; y: number } | null;

export function PlayScreen({ onJournal, onSheet, canonize }: { onJournal: () => void; onSheet: (tab: 'status' | 'inventory' | 'aims' | 'people') => void; canonize: (name: string, kind: 'character' | 'location') => void }) {
  const t = useTheme();
  const s = useSession();
  const now = useSimNow();
  const [sel, setSel] = useState<Sel>(null);
  const [who, setWho] = useState<Who | null>(null);
  const [shop, setShop] = useState(false);
  const [atlas, setAtlas] = useState(false);
  const [panel, setPanel] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; mode: 'do' | 'say'; n: number }>({ text: '', mode: 'do', n: 0 });
  const [hidden, setHidden] = useState<number | null>(null);
  /** The newest passage the player has put away: a newer one brings the panel up so it can be read. */
  const [readUpTo, setReadUpTo] = useState<string | null>(() => [...useSession.getState().path].reverse().find((b) => b.role === 'prose')?.id ?? null);
  const tried = useRef(new Set<string>());
  const streaming = s.streaming;
  const busy = !!streaming;

  // A place with no map yet gets one as soon as you are there (and the opening is told).
  const here = now?.sim.places[now.sim.here];
  useEffect(() => {
    if (!now || !here || busy || here.level) return;
    const key = `${s.session?.id}:${here.id}`;
    if (tried.current.has(key)) return;
    tried.current.add(key);
    void s.mapAct({ kind: 'look' });
  }, [now, here, busy, s]);
  // Whenever the story is being told, the panel comes up to show it (unless put away for this telling).
  const telling = !!streaming && streaming.phase !== 'mapping';
  const newestBeat = [...s.path].reverse().find((b) => b.role === 'prose');
  const newest = newestBeat?.id ?? null;
  // Put away while it was being told: the passage that came of it stays put away too.
  const putAway = hidden != null && !!newestBeat && newestBeat.createdAt >= hidden;
  const showPanel = panel || (telling && hidden !== streaming?.startedAt) || (!!newest && newest !== readUpTo && !telling && !putAway);

  if (!now || !now.pov || !here) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  const { sim, pov, ctx } = now;
  const lib = (a: Actor) => (a.libId ? [...s.bundle.characters, ...s.wb.people].find((c) => c.id === a.libId) : undefined);
  const h: SimHandlers = {
    talkTo: (name) => { setTarget(name); setDraft((d) => ({ text: '', mode: 'say', n: d.n + 1 })); setPanel(true); },
    compose: (text) => { setTarget(null); setDraft((d) => ({ text, mode: 'do', n: d.n + 1 })); setPanel(true); },
    act: (text) => { void askNotificationPermission(); void s.act(text); },
    canonize,
  };
  const chain = placeChain(sim, here);
  const cur = ctx.currency;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Where, when, how you are */}
      <View style={{ paddingHorizontal: space.md, paddingTop: 6, gap: 4 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
          {here.parent || (here.level && upScale(here.level.scale)) ? (
            <Pressable onPress={() => !busy && void s.mapAct({ kind: 'leave' })} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 6 }}>
              <Ionicons name="arrow-up-circle-outline" size={18} color={busy ? t.faint : t.accent} />
              <T v="small" style={{ color: busy ? t.faint : t.accent }}>Out</T>
            </Pressable>
          ) : null}
          {chain.map((p, i) => (
            <Row key={p.id} gap={4}>
              {i ? <Ionicons name="chevron-forward" size={11} color={t.faint} /> : null}
              <Pressable disabled={busy || p.id === here.id} onPress={() => void s.mapAct({ kind: 'leave', to: p.id })} hitSlop={6}>
                <T v="small" style={{ color: p.id === here.id ? t.text : t.dim, fontWeight: p.id === here.id ? '600' : '400' }}>{p.name}</T>
              </Pressable>
            </Row>
          ))}
        </ScrollView>
        <Pressable onPress={() => onSheet('status')}>
          <Row gap={8}>
            <T v="small">{formatShort(ctx.calendar, sim.clock)} · {timeOfDay(ctx.calendar, sim.clock)}</T>
            {here.level ? <T v="small" style={{ color: t.faint }}>{SCALES[here.level.scale].label.toLowerCase()} · ~{crowdAt(sim, here, ctx.calendar)} about</T> : null}
            <View style={{ flex: 1 }} />
            <T v="small" style={{ color: t.accent }}>{pov.money} {cur}</T>
            <Row gap={2}>
              {RESOURCES.map((r) => <View key={r} style={{ width: 5, height: 14, borderRadius: 2, backgroundColor: t.surface2, justifyContent: 'flex-end', overflow: 'hidden' }}><View style={{ height: `${pov.resources[r]}%`, backgroundColor: pov.resources[r] < 25 ? t.danger : pov.resources[r] < 50 ? t.warn : t.ok }} /></View>)}
            </Row>
          </Row>
        </Pressable>
        {pov.down || pov.conditions.length ? <T v="small" style={{ color: t.danger }} numberOfLines={1}>{[pov.down ? 'down' : '', ...pov.conditions].filter(Boolean).join(' · ')}</T> : null}
      </View>

      {s.error ? <View style={{ paddingHorizontal: space.md }}><Banner text={s.error} onClose={() => useSession.setState({ error: null })} /></View> : null}
      {s.notice && !showPanel ? <View style={{ paddingHorizontal: space.md }}><Banner tone="info" text={s.notice} onClose={() => useSession.setState({ notice: null })} /></View> : null}

      {/* The map */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm }}>
        {here.level ? (
          <Grid sim={sim} level={here.level} place={here} sel={sel} onCell={(c) => setSel(sel && sel.x === c.x && sel.y === c.y ? null : c)} calendar={ctx.calendar} kit={ctx.kit} myImage={imageOf(s.wb.player?.data as Record<string, unknown>)?.uri} myName={s.wb.player?.name ?? '@'} />
        ) : (
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Ionicons name="map-outline" size={32} color={t.faint} />
            <T v="faint">{streaming?.phase === 'mapping' ? `Laying out ${streaming.text || here.name}…` : `${here.name} has no map yet.`}</T>
            {!busy ? <Button small kind="outline" icon="map-outline" title="Map it" onPress={() => void s.mapAct({ kind: 'look' })} /> : null}
          </View>
        )}
        {streaming?.phase === 'mapping' && here.level ? <T v="small" style={{ color: t.accent, marginTop: 6 }}>Laying out {streaming.text || 'the map'}…</T> : null}
      </View>

      {/* What is selected, or what is here */}
      <View style={{ paddingHorizontal: space.md, paddingBottom: 4 }}>
        {sel && here.level ? (
          <CellCard sim={sim} place={here} level={here.level} cell={sel} busy={busy} calendar={ctx.calendar} kit={ctx.kit} relations={pov.relations}
            onWho={setWho}
            onWalk={() => { setSel(null); void s.mapAct({ kind: 'walk', x: sel.x, y: sel.y }); }}
            onEnter={(p) => { setSel(null); void s.mapAct({ kind: 'enter', place: p.id }); }}
            onInteract={(text) => h.compose(text)}
            onClose={() => setSel(null)} />
        ) : (
          <HereCard sim={sim} place={here} busy={busy} calendar={ctx.calendar} currency={cur} onShop={() => setShop(true)} />
        )}
      </View>

      {/* The bar */}
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 6, paddingHorizontal: space.sm }}>
        <BarButton icon="chatbubbles-outline" label="Act" onPress={() => { setTarget(null); setPanel(true); }} accent />
        <BarButton icon="book-outline" label="Journal" onPress={onJournal} />
        <BarButton icon="briefcase-outline" label="Bag" onPress={() => onSheet('inventory')} />
        <BarButton icon="flag-outline" label={`Leads${sim.leads.filter((l) => l.status === 'open').length ? ` · ${sim.leads.filter((l) => l.status === 'open').length}` : ''}`} onPress={() => onSheet('aims')} />
        <BarButton icon="globe-outline" label="Atlas" onPress={() => setAtlas(true)} />
      </View>

      {showPanel ? <InteractionPanel key={draft.n} target={target} initial={draft} onTarget={setTarget} onClose={() => { setPanel(false); setReadUpTo(newest); if (telling) setHidden(streaming!.startedAt); }} /> : null}
      <PersonSheet who={who} onClose={() => setWho(null)} sim={sim} pov={pov} h={h} busy={busy} onTrade={() => { setWho(null); setShop(true); }} lib={lib} />
      <ShopSheet open={shop} onClose={() => setShop(false)} sim={sim} pov={pov} busy={busy} />
      <AtlasSheet open={atlas} onClose={() => setAtlas(false)} sim={sim} busy={busy} h={h} />
    </View>
  );
}

function BarButton({ icon, label, onPress, accent }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; accent?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={icon} size={20} color={accent ? t.accent : t.dim} />
      <T v="small" style={{ color: accent ? t.accent : t.dim, fontSize: 11 }}>{label}</T>
    </Pressable>
  );
}

/** The level as a grid of coloured cells, with places, features, people and you on it. */
function Grid({ sim, level, place, sel, onCell, calendar, kit, myImage, myName }: { sim: SimState; level: Level; place: Place; sel: Sel; onCell: (c: { x: number; y: number }) => void; calendar: Parameters<typeof crowdAt>[2]; kit: Parameters<typeof facesAt>[1]; myImage?: string; myName: string }) {
  const t = useTheme();
  const scheme = useScheme();
  const pal = scheme === 'light' ? LIGHT : DARK;
  const box = useRef<View>(null);
  const width = Dimensions.get('window').width - space.sm * 2;
  const height = Dimensions.get('window').height * 0.5;
  const cell = Math.max(14, Math.floor(Math.min(width / level.w, height / level.h)));
  const spots = spotsOf(sim, place.id).filter((p) => p.known);
  const people = peopleAt(sim, place.id, calendar).filter((a) => a.status !== 'dead');
  const faces = facesAt(sim, kit, place, calendar);
  const where = useMemo(() => positions(sim, level, [...people.map((a) => a.id), ...faces.map((f) => f.key)]), [sim, level, people.length, faces.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const inside = (p: Place) => peopleAt(sim, p.id, calendar).filter((a) => a.status === 'ok').length;
  const rows: React.ReactNode[] = [];
  for (let y = 0; y < level.h; y++) {
    const cells: React.ReactNode[] = [];
    for (let x = 0; x < level.w; x++) {
      const ch = at(level, x, y);
      cells.push(<View key={x} style={{ width: cell, height: cell, backgroundColor: pal[ch] ?? pal['.'], borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: scheme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)' }} />);
    }
    rows.push(<View key={y} style={{ flexDirection: 'row' }}>{cells}</View>);
  }
  const abs = (x: number, y: number) => ({ position: 'absolute' as const, left: x * cell, top: y * cell, width: cell, height: cell, alignItems: 'center' as const, justifyContent: 'center' as const });
  const me = sim.pos;
  // Where on the grid a tap landed, from page coordinates (reliable on every platform).
  const press = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    box.current?.measureInWindow((ox, oy) => {
      const x = Math.floor((pageX - ox) / cell);
      const y = Math.floor((pageY - oy) / cell);
      if (Number.isFinite(x) && Number.isFinite(y)) onCell({ x: Math.max(0, Math.min(level.w - 1, x)), y: Math.max(0, Math.min(level.h - 1, y)) });
    });
  };
  return (
    <Pressable ref={box} onPress={press} style={{ width: cell * level.w, height: cell * level.h, borderRadius: 6, overflow: 'hidden' }}>
      <View pointerEvents="none">{rows}</View>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: cell * level.w, height: cell * level.h }}>
        {level.features.map((f) => <View key={`f${f.x},${f.y}`} style={abs(f.x, f.y)}><View style={{ width: cell * 0.36, height: cell * 0.36, transform: [{ rotate: '45deg' }], backgroundColor: t.warn, opacity: 0.75 }} /></View>)}
        {spots.map((p) => {
          const n = inside(p);
          return (
            <View key={p.id} style={abs(p.x!, p.y!)}>
              <View style={{ width: cell * 0.86, height: cell * 0.86, borderRadius: cell * 0.2, backgroundColor: t.surface, borderWidth: 1.5, borderColor: p.visited ? t.accent : t.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={venueIcon(p.venue)} size={cell * 0.55} color={p.visited ? t.accent : t.dim} />
              </View>
              {n ? <View style={{ position: 'absolute', right: -2, top: -2, minWidth: 12, height: 12, borderRadius: 6, backgroundColor: t.info, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}><T style={{ fontSize: 8, color: '#fff', lineHeight: 10 }}>{n}</T></View> : null}
            </View>
          );
        })}
        {spots.map((p) => (
          <View key={`l${p.id}`} style={{ position: 'absolute', left: Math.max(0, (p.x! - 1) * cell), top: (p.y! + 1) * cell - 2, width: cell * 3, alignItems: 'center' }}>
            <T numberOfLines={1} style={{ fontSize: 9, color: t.text, backgroundColor: scheme === 'light' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)', paddingHorizontal: 2, borderRadius: 3 }}>{p.name}</T>
          </View>
        ))}
        {faces.map((f, i) => { const c = where.get(f.key); return c ? <View key={f.key} style={{ position: 'absolute', left: c.x * cell + cell * (0.15 + (i % 3) * 0.25), top: c.y * cell + cell * 0.6, width: 5, height: 5, borderRadius: 3, backgroundColor: t.faint }} /> : null; })}
        {people.map((a, i) => { const c = where.get(a.id); return c ? <View key={a.id} style={{ position: 'absolute', left: c.x * cell + cell * (0.2 + (i % 3) * 0.22), top: c.y * cell + cell * 0.2, width: 8, height: 8, borderRadius: 4, backgroundColor: t.info, borderWidth: 1, borderColor: t.bg }} /> : null; })}
        {me ? (
          <View style={abs(me.x, me.y)}>
            {myImage ? <Avatar data={{ image: { uri: myImage } }} name={myName} size={cell * 0.9} /> : <View style={{ width: cell * 0.8, height: cell * 0.8, borderRadius: cell, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}><T style={{ fontSize: cell * 0.45, color: t.accentText, fontWeight: '700' }}>{myName.charAt(0)}</T></View>}
          </View>
        ) : null}
        {sel ? <View style={{ ...abs(sel.x, sel.y), borderWidth: 2, borderColor: t.accent, borderRadius: 4 }} /> : null}
      </View>
    </Pressable>
  );
}

/** What is on the cell you tapped: a place to go into, a thing, people, or open ground; and how far. */
function CellCard({ sim, place, level, cell, busy, calendar, kit, relations, onWho, onWalk, onEnter, onInteract, onClose }: { sim: SimState; place: Place; level: Level; cell: { x: number; y: number }; busy: boolean; calendar: Parameters<typeof crowdAt>[2]; kit: Parameters<typeof facesAt>[1]; relations: Record<string, { attitude: number; note: string }>; onWho: (w: Who) => void; onWalk: () => void; onEnter: (p: Place) => void; onInteract: (text: string) => void; onClose: () => void }) {
  const t = useTheme();
  const spot = spotAt(sim, place.id, cell.x, cell.y);
  const feature = level.features.find((f) => f.x === cell.x && f.y === cell.y);
  const people = peopleAt(sim, place.id, calendar).filter((a) => a.status !== 'dead');
  const faces = facesAt(sim, kit, place, calendar);
  const where = positions(sim, level, [...people.map((a) => a.id), ...faces.map((f) => f.key)]);
  const onCell = (id: string) => { const c = where.get(id); return !!c && c.x === cell.x && c.y === cell.y; };
  const here = sim.pos && sim.pos.x === cell.x && sim.pos.y === cell.y;
  const way = sim.pos ? findPath(level, sim.pos, cell) : null;
  const open = passCost(at(level, cell.x, cell.y), level.scale) != null;
  const inside = spot ? peopleAt(sim, spot.id, calendar).filter((a) => a.status === 'ok') : [];
  const sv = spot ? services({ ...sim, here: spot.id }, calendar) : null;
  const rel = (n: string) => Object.entries(relations).find(([k]) => normName(k) === normName(n))?.[1]?.attitude;
  const title = spot?.name ?? feature?.name ?? terrainName(at(level, cell.x, cell.y));
  const sub = here ? 'you are here' : way ? `${formatDuration(walkMinutes(level, way.cost))} away` : open ? 'no way there from here' : 'cannot go there';
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.md, padding: space.md, gap: 6 }}>
      <Row gap={8}>
        <Ionicons name={spot ? venueIcon(spot.venue) : feature ? 'diamond-outline' : 'location-outline'} size={18} color={spot || feature ? t.accent : t.dim} />
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '600' }} numberOfLines={1}>{title[0]!.toUpperCase() + title.slice(1)}</T>
          <T v="small">{[spot ? spot.venue : '', sub].filter(Boolean).join(' · ')}</T>
        </View>
        <IconButton name="close" size={18} color={t.faint} onPress={onClose} />
      </Row>
      {spot?.note || feature?.note ? <T v="dim" numberOfLines={2}>{spot?.note || feature?.note}</T> : null}
      {spot ? <T v="small">{[inside.length ? `${inside.length} you know inside` : '', sv?.stock.length ? 'shop' : '', sv?.work ? 'work' : '', sv?.lodging ? 'beds' : '', spot.forSale ? `for sale ${spot.forSale}` : '', spot.owner === 'player' ? 'yours' : ''].filter(Boolean).join(' · ')}</T> : null}
      {people.some((a) => onCell(a.id)) || faces.some((f) => onCell(f.key)) ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {people.filter((a) => onCell(a.id)).map((a) => <Chip key={a.id} small label={a.name.split(' ')[0]!} color={attColor(rel(a.name), t)} onPress={() => onWho({ actor: a })} />)}
          {faces.filter((f) => onCell(f.key)).map((f) => <Chip key={f.key} small label={`${f.look} ${f.role}`} onPress={() => onWho({ face: f as Face })} />)}
        </ScrollView>
      ) : null}
      <Row style={{ flexWrap: 'wrap' }}>
        {spot ? <Button small icon="enter-outline" title="Go in" disabled={busy || (!way && !here)} onPress={() => onEnter(spot)} /> : null}
        {!here && way ? <Button small kind={spot ? 'outline' : 'primary'} icon="walk-outline" title={spot ? 'Walk to the door' : 'Walk here'} disabled={busy} onPress={onWalk} /> : null}
        {feature ? <Button small kind="outline" icon="hand-left-outline" title="Deal with it" disabled={busy} onPress={() => onInteract(`You go over to ${feature.name} and `)} /> : null}
        {!spot && !feature && here ? <Button small kind="outline" icon="search-outline" title="Search here" disabled={busy} onPress={() => onInteract('You search around where you stand, ')} /> : null}
      </Row>
    </View>
  );
}

/** Where you are: the people about, what the place offers, and time to pass. */
function HereCard({ sim, place, busy, calendar, currency, onShop }: { sim: SimState; place: Place; busy: boolean; calendar: Parameters<typeof crowdAt>[2]; currency: string; onShop: () => void }) {
  const t = useTheme();
  const s = useSession();
  const sv = services(sim, calendar);
  const tap = (a: Parameters<typeof s.simAct>[0]) => { if (!busy) void s.simAct(a); };
  return (
    <View style={{ gap: 6 }}>
      <Row gap={6}>
        <Ionicons name={venueIcon(place.venue)} size={14} color={t.accent} />
        <T v="small" numberOfLines={1} style={{ flex: 1, color: t.text }}>{place.note || place.name}</T>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {sv?.stock.length ? <Chip small label={sv.open ? 'Shop' : 'Shop · shut'} onPress={onShop} /> : null}
        {sv?.work ? <Chip small label={`Work ${sv.work.hours} h · ${sv.work.pay} ${currency}`} onPress={() => tap({ kind: 'work' })} /> : null}
        {sv?.lodging ? <Chip small label={`Bed · ${sv.lodging} ${currency}`} onPress={() => tap({ kind: 'rent', nights: 1 })} /> : null}
        {sv?.forSale ? <Chip small label={`Buy · ${sv.forSale}`} onPress={() => tap({ kind: 'buyPlace' })} /> : null}
        {sv?.lying.map((x) => <Chip key={x.id} small label={`Take ${x.name}`} onPress={() => tap({ kind: 'take', thing: x.id })} />)}
        {sv?.stash ? <Chip small label="Your things" onPress={onShop} /> : null}
        <Chip small label="Wait 1 h" onPress={() => tap({ kind: 'wait', minutes: 60 })} />
        <Chip small label="Rest" onPress={() => tap({ kind: 'rest', hours: 8 })} />
      </ScrollView>
    </View>
  );
}

/** The text side of play: this stretch of the story, and the composer. Slides up over the map. */
function InteractionPanel({ target, initial, onTarget, onClose }: { target: string | null; initial: { text: string; mode: 'do' | 'say'; n: number }; onTarget: (t: string | null) => void; onClose: () => void }) {
  const t = useTheme();
  const s = useSession();
  const [text, setText] = useState(initial.text);
  const [mode, setMode] = useState<'do' | 'say'>(initial.mode);
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const streaming = s.streaming;
  const recent = s.path.slice(-8);
  const fontSize = 16;
  useEffect(() => {
    if (initial.n) setTimeout(() => input.current?.focus(), 250);
  }, [initial.n]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); }, [recent.length, streaming?.text.length]);
  const send = () => {
    const v = text.trim();
    if (!v || streaming) return;
    setText('');
    void askNotificationPermission();
    const line = v.replace(/^["“]|["”]$/g, '');
    void s.act(mode === 'say' ? (target ? `You say to ${target}: “${line}”` : `You say: “${line}”`) : v);
  };
  const h = Dimensions.get('window').height;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: h * 0.62, backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: t.border, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, elevation: 12 }}>
      <Pressable onPress={onClose} style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.border }} />
      </Pressable>
      <Row between style={{ paddingHorizontal: space.lg, paddingBottom: 4 }}>
        <T v="h">{target ? target.replace(/^the /, '').replace(/^./, (c) => c.toUpperCase()) : 'The story'}</T>
        <IconButton name="chevron-down" size={22} color={t.dim} onPress={onClose} />
      </Row>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 10, paddingBottom: 8 }}>
        {recent.map((b) => b.role === 'prose' ? (
          <View key={b.id} style={{ gap: 4 }}>
            {b.state?.sim?.chips.length ? <ChipRow chips={b.state.sim.chips} /> : null}
            <T style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.55 }}>{b.text}</T>
          </View>
        ) : b.role === 'instruction' ? (
          <Row key={b.id} style={{ alignItems: 'flex-start' }}><Ionicons name="return-down-forward-outline" size={14} color={t.accent} style={{ marginTop: 3 }} /><T v="dim" style={{ flex: 1, fontStyle: 'italic' }}>{b.text}</T></Row>
        ) : (
          <T key={b.id} v="faint" style={{ fontStyle: 'italic' }}>{b.text}</T>
        ))}
        {streaming && streaming.phase !== 'mapping' ? (
          <View style={{ gap: 4 }}>
            {streaming.chips?.length ? <ChipRow chips={streaming.chips} /> : null}
            <T v="small" style={{ color: t.accent }}>{streaming.phase === 'refereeing' ? 'The world answers…' : streaming.phase === 'summarizing' ? 'Folding older passages into the summary…' : ''}</T>
            <T style={{ fontFamily: serif, fontSize, lineHeight: fontSize * 1.55 }}>{streaming.text}{streaming.text ? '▍' : ''}</T>
          </View>
        ) : null}
        {s.notice ? <Banner tone="info" text={s.notice} onClose={() => useSession.setState({ notice: null })} /> : null}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, padding: space.sm, gap: 6 }}>
        <Row gap={6}>
          <Chip small label="Do" selected={mode === 'do'} onPress={() => setMode('do')} />
          <Chip small label="Say" selected={mode === 'say'} onPress={() => setMode('say')} />
          {mode === 'say' && target ? <Chip small label={`to ${target.replace(/^the /, '')}  ×`} selected onPress={() => onTarget(null)} /> : null}
          <View style={{ flex: 1 }} />
          {streaming ? <Button small kind="outline" title="Stop" onPress={s.stop} /> : <Button small kind="ghost" icon="play-forward-outline" title="Let it play" onPress={() => { void askNotificationPermission(); void s.generate(); }} />}
        </Row>
        <Row style={{ alignItems: 'flex-end' }}>
          <TextInput ref={input} value={text} onChangeText={setText} placeholder={mode === 'say' ? 'What you say…' : 'What you do…'} placeholderTextColor={t.faint} multiline style={{ flex: 1, backgroundColor: t.bg, color: t.text, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 }} />
          <IconButton name="arrow-up-circle" size={32} color={text.trim() && !streaming ? t.accent : t.faint} onPress={send} disabled={!text.trim() || !!streaming} />
        </Row>
      </View>
    </View>
  );
}

function ChipRow({ chips }: { chips: string[] }) {
  const t = useTheme();
  return <Row gap={6} style={{ flexWrap: 'wrap' }}>{chips.map((c, i) => <View key={i} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: t.bg }}><T v="small" style={{ color: t.accent }}>{c}</T></View>)}</Row>;
}
