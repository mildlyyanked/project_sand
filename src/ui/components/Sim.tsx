import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import type { Character } from '@/core/types';
import type { PovState } from '@/core/world/types';
import { formatDuration, formatShort, timeOfDay } from '@/core/world/calendar';
import { normName } from '@/core/world/drafts';
import { sceneAt as simScene } from '@/core/sim/crowd';
import { services } from '@/core/sim/actions';
import { sellOffer } from '@/core/sim/economy';
import { nearbyPlaces, route } from '@/core/sim/ops';
import { attitudeWord, placeChain } from '@/core/sim/narrate';
import type { Actor, Face, Lead, Place, SimAction, SimState, Venue } from '@/core/sim/types';
import { sceneAt } from '@/core/world/timeline';
import { useSession } from '@/state/session';
import { initialScene } from '@/state/world';
import { simAt, simContext, simOn, useSimVersion } from '@/state/sim';
import { Badge, Button, Chip, Ionicons, Row, SearchBox, Sheet, T, matches } from './index';
import { Avatar } from './EntryImage';
import { radius, space, useTheme, type Theme } from '../theme';

/**
 * Play on the world simulation, on screen: where you are and who is here,
 * the ways out, what the place offers, and sheets for a person, a shop and
 * the map. Taps settle by the world's rules at once; talk and anything else
 * goes through the composer to the referee.
 */
type Icon = React.ComponentProps<typeof Ionicons>['name'];
const VENUE_ICON: Partial<Record<Venue, Icon>> = { tavern: 'beer-outline', inn: 'bed-outline', market: 'basket-outline', shop: 'storefront-outline', workshop: 'hammer-outline', temple: 'flame-outline', clinic: 'medkit-outline', dock: 'boat-outline', garrison: 'shield-outline', palace: 'business-outline', office: 'document-text-outline', square: 'people-outline', street: 'trail-sign-outline', hall: 'swap-horizontal-outline', home: 'home-outline', settlement: 'business-outline', district: 'grid-outline', road: 'git-commit-outline', wild: 'leaf-outline', ruin: 'skull-outline', region: 'earth-outline', room: 'cube-outline', building: 'cube-outline', vehicle: 'car-outline' };
export const venueIcon = (v: Venue): Icon => VENUE_ICON[v] ?? 'location-outline';
const attColor = (n: number | undefined, t: Theme) => (n == null ? t.faint : n > 0 ? t.ok : n < 0 ? t.danger : t.dim);

/** The world at the end of the open story's path, or null when this is not play on the simulation. */
export function useSimNow() {
  const { session, path, wb, bundle } = useSession();
  const v = useSimVersion((x) => x.v);
  return useMemo(() => {
    if (!session || !simOn(session) || !wb.player) return null;
    const at = simAt({ session, path, wb, universe: bundle.universe });
    const pov = sceneAt(path, initialScene(session, wb)).pov ?? null;
    return { sim: at.sim, pov, ctx: simContext(session, bundle.universe, wb.player) };
  }, [session, path, wb, bundle.universe, v]); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface SimHandlers {
  /** Say something to someone: the composer, in Say mode, addressed to them. */
  talkTo: (name: string) => void;
  /** Put words in the composer (Do), for the player to finish. */
  compose: (text: string) => void;
  /** Send an action now. */
  act: (text: string) => void;
  canonize: (name: string, kind: 'character' | 'location') => void;
}

type Who = { actor: Actor } | { face: Face };

export function SimPanel({ h, busy }: { h: SimHandlers; busy: boolean }) {
  const t = useTheme();
  const s = useSession();
  const now = useSimNow();
  const [folded, setFolded] = useState(false);
  const [who, setWho] = useState<Who | null>(null);
  const [shop, setShop] = useState(false);
  const [map, setMap] = useState(false);
  if (!now || !now.pov) return null;
  const { sim, pov, ctx } = now;
  const scene = simScene(sim, ctx.kit, ctx.calendar);
  if (!scene) return null;
  const sv = services(sim, ctx.calendar);
  const exits = nearbyPlaces(sim, sim.here);
  const rel = (name: string) => Object.entries(pov.relations).find(([k]) => normName(k) === normName(name))?.[1];
  const lib = (a: Actor) => (a.libId ? [...s.bundle.characters, ...s.wb.people].find((c) => c.id === a.libId) : undefined);
  const tap = (a: SimAction) => { if (!busy) void s.simAct(a); };
  const cur = ctx.currency;

  return (
    <View style={{ gap: 6 }}>
      <Row gap={6}>
        <Ionicons name={venueIcon(scene.place.venue)} size={14} color={t.accent} />
        <T v="small" numberOfLines={1} style={{ flex: 1, color: t.text }}>
          {scene.place.name}<T v="small">{`  ·  about ${scene.crowd} ${scene.crowd === 1 ? 'person' : 'people'}  ·  ${timeOfDay(ctx.calendar, sim.clock)}`}</T>
        </T>
        <Pressable onPress={() => setMap(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Ionicons name="map-outline" size={15} color={t.accent} />
          <T v="small" style={{ color: t.accent }}>Map</T>
        </Pressable>
        <Pressable onPress={() => setFolded(!folded)} hitSlop={8}><Ionicons name={folded ? 'chevron-up' : 'chevron-down'} size={16} color={t.dim} /></Pressable>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
        {exits.map((x) => <Chip key={x.place.id} small label={`→ ${x.place.name} · ${formatDuration(x.minutes)}`} onPress={() => tap({ kind: 'go', to: x.place.id })} />)}
        {!exits.length ? <Chip small label="Find a way out" onPress={() => h.act('You look for a way out of here and where it leads.')} /> : null}
      </ScrollView>
      {!folded ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
            {scene.people.map((a) => {
              const c = lib(a);
              const r = rel(a.name);
              return (
                <Pressable key={a.id} onPress={() => setWho({ actor: a })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 4, opacity: a.status === 'dead' ? 0.5 : 1 }}>
                  <View>
                    <Avatar data={c?.data as Record<string, unknown> | undefined} name={a.name} size={26} />
                    <View style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: attColor(r?.attitude, t), borderWidth: 1, borderColor: t.bg }} />
                  </View>
                  <T v="small" style={{ color: t.text }}>{a.status === 'dead' ? `† ${a.name.split(' ')[0]}` : a.name.split(' ')[0]}</T>
                </Pressable>
              );
            })}
            {scene.faces.map((f) => (
              <Pressable key={f.key} onPress={() => setWho({ face: f })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' }}>
                <Ionicons name="person-outline" size={12} color={t.dim} />
                <T v="small">{f.look} {f.role}</T>
              </Pressable>
            ))}
            {!scene.people.length && !scene.faces.length ? <T v="faint">Nobody about.</T> : null}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {sv?.stock.length ? <Chip small label={sv.open ? `Shop · ${sv.keeper?.name.split(' ')[0] ?? 'open'}` : 'Shop · shut'} onPress={() => setShop(true)} /> : null}
            {sv?.work ? <Chip small label={`Work ${sv.work.hours} h · ${sv.work.pay} ${cur}`} onPress={() => tap({ kind: 'work' })} /> : null}
            {sv?.lodging ? <Chip small label={`Bed · ${sv.lodging} ${cur}`} onPress={() => tap({ kind: 'rent', nights: 1 })} /> : null}
            {sv?.forSale ? <Chip small label={`Buy this place · ${sv.forSale}`} onPress={() => tap({ kind: 'buyPlace' })} /> : null}
            {sv?.lying.map((x) => <Chip key={x.id} small label={`Take ${x.name}`} onPress={() => tap({ kind: 'take', thing: x.id })} />)}
            {sv?.stash ? <Chip small label={`Your things · ${sv.stash.reduce((n, x) => n + x.qty, 0)}`} onPress={() => setShop(true)} /> : null}
            <Chip small label="Look around" onPress={() => h.act('You look around, taking in the place and the people in it.')} />
            <Chip small label="Wait 1 h" onPress={() => tap({ kind: 'wait', minutes: 60 })} />
            <Chip small label="Rest" onPress={() => tap({ kind: 'rest', hours: 8 })} />
            <Chip small label="Ask for work" onPress={() => h.act('You ask around for paid work, or anyone who needs something done.')} />
            <Chip small label="Explore" onPress={() => h.act(`You explore ${scene.place.name} and the streets around it, learning what is where.`)} />
          </ScrollView>
        </>
      ) : null}

      <PersonSheet who={who} onClose={() => setWho(null)} sim={sim} pov={pov} h={h} busy={busy} onTrade={() => { setWho(null); setShop(true); }} lib={lib} />
      <ShopSheet open={shop} onClose={() => setShop(false)} sim={sim} pov={pov} busy={busy} />
      <MapSheet open={map} onClose={() => setMap(false)} sim={sim} busy={busy} h={h} />
    </View>
  );
}

function PersonSheet({ who, onClose, sim, pov, h, busy, onTrade, lib }: { who: Who | null; onClose: () => void; sim: SimState; pov: PovState; h: SimHandlers; busy: boolean; onTrade: () => void; lib: (a: Actor) => Character | undefined }) {
  const t = useTheme();
  const [give, setGive] = useState(false);
  if (!who) return null;
  const a = 'actor' in who ? who.actor : null;
  const f = 'face' in who ? who.face : null;
  const name = a ? a.name : `the ${f!.look} ${f!.role}`;
  const title = a ? a.name : `${f!.look[0]!.toUpperCase()}${f!.look.slice(1)} ${f!.role}`;
  const r = a ? Object.entries(pov.relations).find(([k]) => normName(k) === normName(a.name))?.[1] : undefined;
  const c = a ? lib(a) : undefined;
  const here = sim.places[sim.here];
  const shopHere = !!a?.staff && a.work === sim.here && !!here?.shop;
  const close = (fn: () => void) => { setGive(false); onClose(); fn(); };
  return (
    <Sheet open onClose={() => { setGive(false); onClose(); }}>
      <Row gap={12}>
        <Avatar data={c?.data as Record<string, unknown> | undefined} name={a?.name ?? f!.role} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h">{title}</T>
          <T v="small">{[a?.role ?? f!.role, a?.look, a?.faction, a?.staff ? 'works here' : '', a && a.status !== 'ok' ? a.status : ''].filter(Boolean).join(' · ')}</T>
          {r ? <T v="small" style={{ color: attColor(r.attitude, t) }}>{attitudeWord(r.attitude)} toward you{r.note ? ` · ${r.note}` : ''}</T> : <T v="small" style={{ color: t.faint }}>{a?.met ? 'No strong feelings about you' : 'You have not dealt with them'}</T>}
        </View>
      </Row>
      {a?.traits ? <T v="dim">{a.traits}</T> : null}
      {a?.memory.length ? (
        <View style={{ gap: 2 }}>
          <T v="label">What they remember</T>
          {a.memory.slice(-4).map((m, i) => <T key={i} v="small">• {m}</T>)}
        </View>
      ) : null}
      {a?.status === 'dead' ? <T v="faint">Dead.</T> : (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small icon="chatbubble-outline" title="Talk" disabled={busy} onPress={() => close(() => h.talkTo(name))} />
            <Button small kind="outline" icon="help-outline" title="Ask about…" disabled={busy} onPress={() => close(() => h.compose(`You ask ${name} about `))} />
            {pov.inventory.length ? <Button small kind="outline" icon="gift-outline" title="Give…" disabled={busy} onPress={() => setGive(!give)} /> : null}
            {shopHere ? <Button small kind="outline" icon="pricetag-outline" title="Trade" onPress={onTrade} /> : null}
            {a && !a.follows ? <Button small kind="ghost" icon="walk-outline" title="Come with me" disabled={busy} onPress={() => close(() => h.act(`You ask ${name} to come with you.`))} /> : null}
            {a?.follows ? <Button small kind="ghost" icon="hand-left-outline" title="Part ways" disabled={busy} onPress={() => close(() => h.act(`You part ways with ${name} for now.`))} /> : null}
            <Button small kind="ghost" icon="flash-outline" title="Do…" disabled={busy} onPress={() => close(() => h.compose(`You turn to ${name} and `))} />
          </Row>
          {give ? (
            <View style={{ gap: 6 }}>
              <T v="label">Give {a ? a.name.split(' ')[0] : 'them'}…</T>
              <Row style={{ flexWrap: 'wrap' }}>
                {pov.inventory.map((i) => <Chip key={i.name} small label={`${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`} onPress={() => close(() => h.act(`You give ${name} the ${i.name}.`))} />)}
              </Row>
            </View>
          ) : null}
        </>
      )}
      <Row style={{ flexWrap: 'wrap' }}>
        {a?.libId ? <Button small kind="ghost" icon="open-outline" title="Open entry" onPress={() => close(() => router.push(`/library/character/${a.libId}`))} /> : null}
        {a?.made && a.met ? <Button small kind="ghost" icon="sparkles-outline" title="Canonize" onPress={() => close(() => h.canonize(a.name, 'character'))} /> : null}
      </Row>
    </Sheet>
  );
}

function ShopSheet({ open, onClose, sim, pov, busy }: { open: boolean; onClose: () => void; sim: SimState; pov: PovState; busy: boolean }) {
  const t = useTheme();
  const s = useSession();
  const now = useSimNow();
  const [tab, setTab] = useState<'buy' | 'sell' | 'stash'>('buy');
  if (!open || !now) return null;
  const { ctx } = now;
  const sv = services(sim, ctx.calendar);
  const here = sim.places[sim.here];
  if (!sv || !here) return null;
  const cur = ctx.currency;
  const act = (a: SimAction) => { onClose(); void s.simAct(a); };
  const tabs = [sv.stock.length ? 'buy' : '', sv.stock.length ? 'sell' : '', sv.stash ? 'stash' : ''].filter(Boolean) as ('buy' | 'sell' | 'stash')[];
  const cur2 = tabs.includes(tab) ? tab : tabs[0] ?? 'buy';
  return (
    <Sheet open onClose={onClose} title={here.name}>
      <Row between>
        <T v="small" style={{ color: sv.open ? t.ok : t.danger }}>{sv.keeper ? `${sv.keeper.name}${sv.open ? ' is serving' : ' is not here: shut'}` : 'Nobody minds the place'}</T>
        <T v="small" style={{ color: t.accent }}>You have {pov.money} {cur}</T>
      </Row>
      {tabs.length > 1 ? <Row>{tabs.map((k) => <Chip key={k} small label={k === 'buy' ? 'Buy' : k === 'sell' ? 'Sell' : 'Your things'} selected={cur2 === k} onPress={() => setTab(k)} />)}</Row> : null}
      {cur2 === 'buy' ? sv.stock.map((x) => (
        <Row key={x.id} between>
          <View style={{ flex: 1 }}><T>{x.name}</T><T v="small">{x.category}{x.qty > 1 ? ` · ${x.qty} left` : ''}</T></View>
          <Button small title={`${x.price} ${cur}`} disabled={busy || !sv.open || pov.money < x.price!} onPress={() => act({ kind: 'buy', thing: x.id })} />
        </Row>
      )) : null}
      {cur2 === 'sell' ? (pov.inventory.length ? pov.inventory.map((i) => {
        const offer = sellOffer(ctx.kit, sim, here, i.name, i.itemId);
        return (
          <Row key={i.name} between>
            <View style={{ flex: 1 }}><T>{i.name}{i.qty > 1 ? ` ×${i.qty}` : ''}</T><T v="small">{offer ? `${sv.keeper?.name.split(' ')[0] ?? 'They'} would pay ${offer}` : 'not their trade'}</T></View>
            <Button small kind="outline" title="Sell" disabled={busy || !sv.open || !offer} onPress={() => act({ kind: 'sell', item: i.name })} />
          </Row>
        );
      }) : <T v="faint">You carry nothing to sell.</T>) : null}
      {cur2 === 'stash' && sv.stash ? (
        <>
          <T v="label">Kept here</T>
          {sv.stash.length ? sv.stash.map((x) => <Row key={x.id} between><T>{x.name}{x.qty > 1 ? ` ×${x.qty}` : ''}</T><Button small kind="outline" title="Take" disabled={busy} onPress={() => act({ kind: 'unstash', thing: x.id })} /></Row>) : <T v="faint">Nothing kept here yet.</T>}
          <T v="label">Put away</T>
          <Row style={{ flexWrap: 'wrap' }}>{pov.inventory.map((i) => <Chip key={i.name} small label={i.name} onPress={() => act({ kind: 'stash', item: i.name })} />)}</Row>
        </>
      ) : null}
      {cur2 !== 'stash' ? <T v="faint">Haggling, stealing or anything else: say or do it in the composer.</T> : null}
    </Sheet>
  );
}

function MapSheet({ open, onClose, sim, busy, h }: { open: boolean; onClose: () => void; sim: SimState; busy: boolean; h: SimHandlers }) {
  const t = useTheme();
  const s = useSession();
  const now = useSimNow();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  if (!open || !now) return null;
  const { ctx } = now;
  const known = Object.values(sim.places).filter((p) => p.known);
  const kids = (id: string | null) => known.filter((p) => (p.parent && known.some((x) => x.id === p.parent) ? p.parent : null) === id).sort((a, b) => (route(sim, sim.here, a.id)?.minutes ?? 1e9) - (route(sim, sim.here, b.id)?.minutes ?? 1e9));
  const hereChain = new Set(placeChain(sim, sim.places[sim.here]!).map((p) => p.id));
  const people = (id: string) => Object.values(sim.actors).filter((a) => a.met && a.status === 'ok' && (a.home === id || a.work === id || a.haunt === id)).length;
  const row = (p: Place, depth: number): React.ReactNode => {
    const mins = route(sim, sim.here, p.id)?.minutes;
    const isHere = p.id === sim.here;
    const open1 = sel === p.id;
    const badges = [p.owner === 'player' ? 'yours' : '', sim.lodging?.place === p.id && sim.lodging.until > sim.clock ? 'your bed' : '', p.forSale ? 'for sale' : '', p.shop ? 'shop' : '', p.work ? 'work' : '', p.lodging ? 'beds' : '', !p.visited ? 'not visited' : ''].filter(Boolean);
    return (
      <View key={p.id}>
        <Pressable onPress={() => setSel(open1 ? null : p.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingLeft: depth * 14, opacity: pressed ? 0.7 : p.visited || isHere ? 1 : 0.65 })}>
          <Ionicons name={isHere ? 'navigate' : venueIcon(p.venue)} size={15} color={isHere ? t.accent : hereChain.has(p.id) ? t.text : t.dim} />
          <View style={{ flex: 1 }}>
            <T numberOfLines={1} style={{ color: isHere ? t.accent : t.text }}>{p.name}</T>
            {badges.length ? <T v="small" numberOfLines={1}>{badges.join(' · ')}</T> : null}
          </View>
          <T v="small">{isHere ? 'here' : mins != null ? formatDuration(mins) : '?'}</T>
        </Pressable>
        {open1 ? (
          <View style={{ paddingLeft: depth * 14 + 23, paddingBottom: 8, gap: 6 }}>
            {p.note ? <T v="dim">{p.note}</T> : null}
            {people(p.id) ? <T v="small">{people(p.id)} {people(p.id) === 1 ? 'person' : 'people'} you know go here</T> : null}
            <Row style={{ flexWrap: 'wrap' }}>
              {!isHere ? <Button small icon="navigate-outline" title={`Go · ${mins != null ? formatDuration(mins) : '?'}`} disabled={busy} onPress={() => { onClose(); void s.simAct({ kind: 'go', to: p.id }); }} /> : null}
              {p.libId ? <Button small kind="ghost" icon="open-outline" title="Open entry" onPress={() => { onClose(); router.push(`/library/entity/${p.libId}`); }} /> : null}
              {p.made ? <Button small kind="ghost" icon="sparkles-outline" title="Canonize" onPress={() => { onClose(); h.canonize(p.name, 'location'); }} /> : null}
            </Row>
          </View>
        ) : null}
      </View>
    );
  };
  const walk = (id: string | null, depth: number): React.ReactNode[] => kids(id).flatMap((p) => [row(p, depth), ...walk(p.id, depth + 1)]);
  const leads = sim.leads.filter((l) => l.status === 'open');
  return (
    <Sheet open onClose={onClose} title="Map" full>
      <T v="small">{formatShort(ctx.calendar, sim.clock)} · {known.length} places known · tap one to go</T>
      {leads.length ? <Row style={{ flexWrap: 'wrap' }}>{leads.map((l) => <Badge key={l.id} label={`${l.title}${l.where ? ` · ${l.where}` : ''}`} tone="info" />)}</Row> : null}
      {known.length > 12 ? <SearchBox value={q} onChange={setQ} placeholder="Find a place" small /> : null}
      {q.trim() ? known.filter((p) => matches(q, p.name, p.note, p.venue)).map((p) => row(p, 0)) : walk(null, 0)}
      <Button kind="ghost" icon="compass-outline" title="Ask the way somewhere new" disabled={busy} onPress={() => { onClose(); h.compose('You ask the way to '); }} />
    </Sheet>
  );
}

/** Leads for the sheet: open first, then the ones settled. */
export function LeadsList({ leads, calendar }: { leads: Lead[]; calendar?: Parameters<typeof formatShort>[0] }) {
  const t = useTheme();
  if (!leads.length) return <T v="faint">No leads yet. Ask around for work, talk to people, follow what the world shows you.</T>;
  const order = [...leads].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
  return (
    <View style={{ gap: space.sm }}>
      {order.map((l) => (
        <View key={l.id} style={{ gap: 2, opacity: l.status === 'open' ? 1 : 0.55 }}>
          <Row gap={6}>
            <Ionicons name={l.status === 'done' ? 'checkmark-circle' : l.status === 'failed' ? 'close-circle' : 'flag-outline'} size={15} color={l.status === 'done' ? t.ok : l.status === 'failed' ? t.danger : t.accent} />
            <T style={{ flex: 1 }}>{l.title}</T>
          </Row>
          {l.goal ? <T v="dim">{l.goal}</T> : null}
          <T v="small">{[l.giver ? `from ${l.giver}` : '', l.where ? `at ${l.where}` : '', l.reward ? `reward: ${l.reward}` : '', l.deadline && l.status === 'open' ? `due ${formatShort(calendar, l.deadline)}` : ''].filter(Boolean).join(' · ')}</T>
        </View>
      ))}
    </View>
  );
}
