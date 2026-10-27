import type { SQLiteDatabase } from 'expo-sqlite';
import { create } from 'zustand';
import type { Beat, Session, Species, Universe } from '@/core/types';
import type { PovState, SceneState } from '@/core/world/types';
import { clockAt, sceneAt } from '@/core/world/timeline';
import { renderPov } from '@/core/world/survival';
import { DEFAULT_KIT, kitPrompt, parseKit } from '@/core/sim/kit';
import { mergeLibrary, seedWorld } from '@/core/sim/seed';
import { peopleAt } from '@/core/sim/crowd';
import { replay, runTurn, settle, type TurnResult } from '@/core/sim/turn';
import { resolveAction } from '@/core/sim/actions';
import { parseReferee, refereePrompt, sceneForReferee } from '@/core/sim/referee';
import { renderTurn, sceneForNarrator, simContract, type SimLength } from '@/core/sim/narrate';
import type { SimContext } from '@/core/sim/ops';
import type { Kit, Resolution, SimAction, SimOp, SimState } from '@/core/sim/types';
import { listSnaps, saveSnap } from '@/db/repo/sim';
import { applyOps } from '@/core/sim/ops';
import { fallbackLayout, layoutPrompt, parseLayout, type Layout } from '@/core/sim/grid';
import { mapNeeds, resolveMap, type MapAction, type MapNeed, type MapResolution } from '@/core/sim/map';
import { placeChain } from '@/core/sim/narrate';
import { saveEvent } from '@/db/repo/world';
import { resolveRefs } from '@/core/world/scan';
import { newId, now } from '@/core/ids';
import { helperJson, initialScene, type WorldBundle } from './world';

/**
 * The world simulation for the open play story: rebuilt for any point on the
 * story's path from the nearest snapshot and the ops the passages since then
 * kept, so undo, swipes and branches always see the world as it was there.
 */
export function simOn(s: Session | null | undefined): boolean {
  return !!s && s.mode === 'pov' && s.pov?.engine !== 'classic';
}

/** Snapshots per story, loaded on open; a version bump tells views to rebuild. */
const snaps = new Map<string, Map<string, SimState>>();
export const useSimVersion = create<{ v: number }>(() => ({ v: 0 }));
const bump = () => useSimVersion.setState((s) => ({ v: s.v + 1 }));

export async function loadSnaps(db: SQLiteDatabase, sid: string): Promise<void> {
  snaps.set(sid, await listSnaps(db, sid));
  bump();
}

export function simContext(session: Session, universe: Universe | null, player: { name: string } | null): SimContext {
  return { kit: session.pov?.kit ?? DEFAULT_KIT, calendar: universe?.data.calendar, difficulty: session.pov?.difficulty ?? 'survival', currency: universe?.data.currency || 'coins', playerName: player?.name ?? 'you' };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export interface SimAt {
  sim: SimState;
  /** Where the world this was built from was taken: a passage id, or 'root'. */
  baseAt: string;
  /** The base was made just now from the library; save it so it stays put. */
  fresh: boolean;
  /** Passages replayed on top of the base. */
  since: number;
}

/** The world at the end of `path`. */
export function simAt(o: { session: Session; path: Beat[]; wb: WorldBundle; universe: Universe | null; species?: Species[] }): SimAt {
  const { session, path, wb } = o;
  const ctx = simContext(session, o.universe, wb.player);
  const map = snaps.get(session.id) ?? new Map<string, SimState>();
  const chain: number[] = [];
  let base: SimState | null = null;
  let baseAt = 'root';
  let fresh = false;
  let i = path.length - 1;
  for (; i >= 0; i--) {
    const b = path[i]!;
    const snap = map.get(b.id);
    if (snap) { base = clone(snap); baseAt = b.id; break; }
    if (b.state?.sim) { chain.unshift(i); continue; }
    if (b.role !== 'prose') continue;
    break;
  }
  if (!base) {
    if (i < 0 && map.get('root')) base = clone(map.get('root')!);
    else {
      const upTo = path.slice(0, i + 1);
      const scene = sceneAt(upTo, initialScene(session, wb));
      base = seedWorld({ entities: wb.entities, characters: wb.people, player: wb.player, castIds: session.characterIds, startId: scene.locationId, startName: scene.locationName, clock: clockAt(upTo, session.clockStart), calendar: ctx.calendar, kit: ctx.kit });
      baseAt = i >= 0 ? path[i]!.id : 'root';
      fresh = true;
    }
  }
  mergeLibrary(base, { entities: wb.entities, characters: wb.people, player: wb.player, kit: ctx.kit });
  let sim = base;
  for (const idx of chain) {
    const b = path[idx]!;
    const before = sceneAt(path.slice(0, idx), initialScene(session, wb)).pov;
    if (before && b.state?.sim) sim = replay(sim, before, b.state.sim.ops, ctx);
  }
  return { sim, baseAt, fresh, since: chain.length };
}

/** Keep a world: the base just made, or a snapshot every dozen passages so rebuilding stays quick. */
export async function keepSnap(db: SQLiteDatabase, sid: string, beatId: string, sim: SimState): Promise<void> {
  const map = snaps.get(sid) ?? new Map<string, SimState>();
  map.set(beatId, clone(sim));
  snaps.set(sid, map);
  await saveSnap(db, sid, beatId, sim);
}

const kitTried = new Set<string>();

/** The play world's kit: written once by the helper in the world's own terms; the defaults until then. */
export async function ensureKit(o: { db: SQLiteDatabase; session: Session; universe: Universe | null; apiKey: string; signal?: AbortSignal; save: (kit: Kit) => Promise<void> }): Promise<Kit> {
  const have = o.session.pov?.kit;
  if (have) return have;
  if (kitTried.has(o.session.id) || !o.universe) return DEFAULT_KIT;
  kitTried.add(o.session.id);
  const u = o.universe;
  const world = [`World: ${u.name}`, u.description, u.data.genre && `Genre: ${u.data.genre}`, u.data.tone && `Tone: ${u.data.tone}`, u.data.technology && `Technology: ${u.data.technology}`, u.data.society && `Society: ${u.data.society}`, u.data.currency && `Money: ${u.data.currency}`].filter(Boolean).join('\n');
  try {
    const text = await helperJson({ apiKey: o.apiKey, model: o.session.models.helper, zdr: o.session.zdr, signal: o.signal, maxTokens: 4000, messages: kitPrompt({ world, currency: u.data.currency }) });
    const kit = parseKit(text);
    if (kit) { await o.save(kit); return kit; }
  } catch {
    // The defaults serve until the next story.
  }
  return DEFAULT_KIT;
}

/** The scene state a passage keeps in play: the library place it is at, who is about, the sheet, and the turn. */
export function sceneFromSim(sim: SimState, pov: PovState, record: SceneState['sim'], ctx: SimContext): SceneState {
  const place = sim.places[sim.here];
  return {
    locationId: place?.libId ?? null,
    locationName: place?.name ?? '',
    present: peopleAt(sim, sim.here, ctx.calendar).filter((a) => a.status !== 'dead').map((a) => a.name),
    pov,
    sim: record,
  };
}

/** Resolve a turn: a tapped action by the rules; anything typed by the referee, with dice. */
export async function resolveTurn(o: {
  session: Session; universe: Universe | null; wb: WorldBundle; sim: SimState; pov: PovState; apiKey: string; signal?: AbortSignal;
  action: string; tapped?: SimAction | null; opening: boolean; recent: string;
}): Promise<{ turn: TurnResult; opening: boolean }> {
  const ctx = simContext(o.session, o.universe, o.wb.player);
  const player = o.wb.player!;
  let res: Resolution;
  let check = null;
  if (o.tapped) res = resolveAction(o.sim, o.pov, o.tapped, { kit: ctx.kit, currency: ctx.currency, calendar: ctx.calendar });
  else if (o.opening && !o.action.trim()) res = { action: '', outcome: '', ops: [] };
  else {
    const scene = sceneForReferee(o.sim, ctx.kit, o.pov, { calendar: ctx.calendar, currency: ctx.currency, playerName: player.name });
    const sheet = renderPov(o.pov, { name: player.name, currency: ctx.currency, difficulty: ctx.difficulty });
    const checks = o.session.pov?.checks !== false;
    const text = await helperJson({ apiKey: o.apiKey, model: o.session.models.helper, zdr: o.session.zdr, signal: o.signal, maxTokens: 2500, messages: refereePrompt({ name: player.name, scene, sheet, attributes: player.data.attributes ?? {}, checks, recent: o.recent, action: o.action, threads: o.pov.threads }) });
    const r = parseReferee(text, checks);
    if (!r) throw new Error('The referee could not read that turn. Try again, or another helper model.');
    const settled = settle(r, o.action || 'You wait and watch.', { pov: o.pov, scores: player.data.attributes ?? {} });
    res = settled.res;
    check = settled.check;
  }
  const turn = runTurn(o.sim, o.pov, res, ctx, check);
  turn.record.action = res.action;
  turn.record.outcome = res.outcome;
  return { turn, opening: o.opening && !o.action.trim() && !o.tapped };
}

/** What the narrator gets for a turn: the contract, the scene now, and the turn as decided. */
export function narration(o: { session: Session; universe: Universe | null; wb: WorldBundle; sim: SimState; pov: PovState; record: NonNullable<SceneState['sim']>; check: TurnResult['check']; opening: boolean }): { contract: string; scene: string; turn: string } {
  const ctx = simContext(o.session, o.universe, o.wb.player);
  const name = o.wb.player?.name ?? 'you';
  const len = (o.session.pov?.turnLength ?? 'standard') as SimLength;
  return {
    contract: simContract({ name, length: len }),
    scene: sceneForNarrator(o.sim, ctx.kit, o.pov, { calendar: ctx.calendar, currency: ctx.currency }),
    turn: renderTurn({ name, res: { action: o.record.action ?? '', outcome: o.record.outcome ?? '', ops: o.record.ops }, check: o.check, facts: o.record.facts, opening: o.opening }),
  };
}

/** After a play turn: what the world will remember goes on the timeline, and every dozen passages the world is kept whole. */
export async function recordSimTurn(db: SQLiteDatabase, sess: Session, wb: WorldBundle, beat: Beat, simTurn: { turn: TurnResult } | null, at: number, since: number): Promise<void> {
  if (!simTurn) return;
  const t = simTurn.turn;
  const instanceId = sess.instanceId ?? wb.instance?.id ?? null;
  if (instanceId) {
    const pool = { characters: wb.people, entities: wb.entities, species: [] };
    for (const e of t.events) await saveEvent(db, { id: newId(), instanceId, sessionId: sess.id, beatId: beat.id, at, kind: e.kind, title: e.title.slice(0, 80), text: e.title, entities: resolveRefs(e.who, pool), importance: e.importance, createdAt: now() });
    for (const th of t.closed) await saveEvent(db, { id: newId(), instanceId, sessionId: sess.id, beatId: beat.id, at, kind: 'event', title: `${th.name}: ${th.status === 'done' ? 'it came to pass' : 'it came to nothing'}`.slice(0, 80), text: th.outcome ?? th.next, entities: [], importance: th.status === 'done' ? 2 : 1, createdAt: now() });
  }
  if (since + 1 >= 12) await keepSnap(db, sess.id, beat.id, t.sim);
}

function worldLine(u: Universe | null): string {
  if (!u) return '';
  return [`World: ${u.name}`, u.description, u.data.genre && `Genre: ${u.data.genre}`, u.data.tone && `Tone: ${u.data.tone}`, u.data.technology && `Technology: ${u.data.technology}`, u.data.society && `Society: ${u.data.society}`].filter(Boolean).join('\n');
}

/** Lay out a map the move needs: one helper call, or the rules when there is no key or the answer is unusable. */
async function layoutOps(o: { need: MapNeed; sim: SimState; session: Session; universe: Universe | null; apiKey: string; signal?: AbortSignal }): Promise<SimOp[]> {
  const p = o.sim.places[o.need.place];
  if (!p) return [];
  const kids = Object.values(o.sim.places).filter((q) => q.parent === p.id);
  const must = o.need.mode === 'inside' ? kids.map((q) => ({ name: q.name, venue: q.venue, note: q.note })) : [{ name: p.name, venue: p.venue, note: p.note }];
  let layout: Layout | null = null;
  if (o.apiKey) {
    try {
      const text = await helperJson({ apiKey: o.apiKey, model: o.session.models.helper, zdr: o.session.zdr, signal: o.signal, maxTokens: 3500, messages: layoutPrompt({ mode: o.need.mode, place: { name: p.name, venue: p.venue, type: p.type, note: p.note }, scale: o.need.scale, chain: placeChain(o.sim, p).slice(0, -1).map((q) => q.name).reverse(), must, world: worldLine(o.universe) }) });
      layout = parseLayout(text, o.need.scale);
    } catch (e) {
      if (o.signal?.aborted) throw e;
    }
  }
  if (o.need.mode === 'inside') return [{ op: 'level', place: p.id, layout: layout ?? fallbackLayout({ scale: o.need.scale, must: must.map((m) => ({ name: m.name, venue: m.venue as Place['venue'] })), seed: o.sim.seed, name: p.name }) }];
  const name = layout?.name?.trim() || `The land around ${p.name}`;
  const type = layout?.type || (o.need.scale === 'system' ? 'system' : o.need.scale === 'world' ? 'planet' : o.need.scale === 'realm' ? 'continent' : o.need.scale === 'city' ? 'city' : o.need.scale === 'quarter' ? 'district' : 'region');
  return [
    { op: 'parent', name, type, ...(layout?.note ? { note: layout.note } : {}) },
    { op: 'level', place: name, layout: layout ?? fallbackLayout({ scale: o.need.scale, must: [{ name: p.name, venue: p.venue }], seed: o.sim.seed, name }) },
  ];
}

type Place = SimState['places'][string];

/** A move on the map, worked out: maps laid out if needed, the move settled, the turn run. */
export async function planMapTurn(o: { session: Session; universe: Universe | null; wb: WorldBundle; sim: SimState; pov: PovState; a: MapAction; apiKey: string; signal?: AbortSignal; onMapping?: (name: string) => void }): Promise<{ turn: TurnResult; res: MapResolution; mapped: boolean }> {
  const ctx = simContext(o.session, o.universe, o.wb.player);
  const pre: SimOp[] = [];
  let sim = o.sim;
  for (const need of mapNeeds(sim, o.a)) {
    o.onMapping?.(sim.places[need.place]?.name ?? '');
    const ops = await layoutOps({ need, sim, session: o.session, universe: o.universe, apiKey: o.apiKey, signal: o.signal });
    sim = applyOps(sim, o.pov, ops, ctx).sim;
    pre.push(...ops);
  }
  // Arriving with no cell yet (first time on this map): stand at its way in.
  if (!sim.pos && sim.places[sim.here]?.level) sim = { ...sim, pos: { ...sim.places[sim.here]!.level!.entry } };
  const res = resolveMap(sim, o.a, { kit: ctx.kit, calendar: ctx.calendar });
  const posFix: SimOp[] = !o.sim.pos && sim.pos && sim.places[sim.here]?.level ? [{ op: 'step', x: sim.pos.x, y: sim.pos.y, minutes: 0 }] : [];
  const all = { ...res, ops: [...pre, ...posFix, ...res.ops] };
  const turn = runTurn(o.sim, o.pov, all, ctx);
  turn.record.action = res.action;
  turn.record.outcome = res.outcome;
  return { turn, res, mapped: pre.length > 0 };
}

