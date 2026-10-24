import type { SQLiteDatabase } from 'expo-sqlite';
import type { Beat, Character, Session, Species, Universe } from '@/core/types';
import type { WorldContext } from '@/core/context/assemble';
import type { CheckResult, SceneState, WorldEntity, WorldEvent, WorldInstance } from '@/core/world/types';
import type { Newcomer } from '@/core/world/forge';
import { characterDraft, draftCard, knowledge, libraryDrafts, normName } from '@/core/world/drafts';
import { clockAt, sceneAt } from '@/core/world/timeline';
import { applyDelta, initialPov, passTime, renderPov } from '@/core/world/survival';
import { chroniclePrompt, parseChronicle } from '@/core/world/chronicle';
import { applyThreadUpdates, gmReadPrompt, parseGmRead, parseThreads, seedThreadsPrompt, threadsForChronicle, type GmRead, type Thread } from '@/core/world/gm';
import { formatTime } from '@/core/world/calendar';
import { mentions, resolveRefs } from '@/core/world/scan';
import { renderCheck } from '@/core/world/dice';
import { newId, now } from '@/core/ids';
import { canonEvents, getInstance, listEntities, primeInstance, saveEvent, siblingStories } from '@/db/repo/world';
import { getCharacters, listCharacters } from '@/db/repo/library';
import { updateBeatWorld } from '@/db/repo/sessions';
import { client } from './client';

/** What a story needs from its world beyond the classic bundle. */
export interface WorldBundle {
  entities: WorldEntity[];
  instance: WorldInstance | null;
  player: Character | null;
  /** Everyone who lives in this world, for naming things the chronicle mentions. */
  people: Character[];
}

export const emptyWorldBundle: WorldBundle = { entities: [], instance: null, player: null, people: [] };

export async function loadWorldBundle(db: SQLiteDatabase, s: Session): Promise<WorldBundle> {
  if (!s.universeId) return emptyWorldBundle;
  const [entities, instance, everyone, player] = await Promise.all([
    listEntities(db, s.universeId),
    s.instanceId ? getInstance(db, s.instanceId) : primeInstance(db, s.universeId),
    listCharacters(db),
    s.pov?.characterId ? getCharacters(db, [s.pov.characterId]).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  return { entities, instance, player, people: everyone.filter((c) => c.universeId === s.universeId || c.universeId == null) };
}

/** Vanilla: the real world with nothing in it, continuity and chronicle off, writer mode. No world work at all. */
export function needsWorld(s: Session, wb: WorldBundle): boolean {
  return s.mode === 'pov' || s.world.continuity || s.world.chronicle || wb.entities.length > 0;
}

export function chronicleOn(s: Session): boolean {
  return s.world.chronicle || s.mode === 'pov';
}

export function initialScene(s: Session, wb: WorldBundle): SceneState {
  const loc = s.pov?.startLocationId ?? wb.player?.data.homeLocationId ?? null;
  const e = loc ? wb.entities.find((x) => x.id === loc) : undefined;
  return {
    locationId: e?.id ?? null,
    locationName: e?.name ?? '',
    pov: s.mode === 'pov' && wb.player ? { ...initialPov({ money: wb.player.data.money, inventory: wb.player.data.inventory }), threads: s.pov?.threads ?? [] } : undefined,
  };
}

export async function buildWorldContext(db: SQLiteDatabase, s: Session, path: Beat[], wb: WorldBundle, extra: { check?: CheckResult | null; read?: GmRead | null; survivalNotes?: string[]; sim?: WorldContext['sim']; scene?: SceneState; now?: number } = {}): Promise<WorldContext | undefined> {
  if (!needsWorld(s, wb)) return undefined;
  const instanceId = s.instanceId ?? wb.instance?.id ?? null;
  let events: WorldEvent[] = [];
  let siblings: WorldContext['siblings'] = [];
  if (instanceId && (s.world.continuity || chronicleOn(s))) {
    const canon = await canonEvents(db, instanceId, { sessionId: s.id, path: new Set(path.map((b) => b.id)) });
    events = s.world.continuity ? canon : canon.filter((e) => e.sessionId === s.id);
    if (s.world.continuity) siblings = await siblingStories(db, instanceId, s.id);
  }
  return {
    entities: wb.entities,
    instance: wb.instance,
    events,
    siblings,
    now: extra.now ?? clockAt(path, s.clockStart),
    scene: extra.scene ?? sceneAt(path, initialScene(s, wb)),
    player: s.mode === 'pov' ? wb.player : null,
    check: extra.check ?? null,
    read: extra.read ?? null,
    survivalNotes: extra.survivalNotes,
    sim: extra.sim ?? null,
  };
}

export async function helperJson(o: { apiKey: string; model: string; messages: Parameters<typeof client.stream>[0]['messages']; maxTokens: number; zdr: boolean; signal?: AbortSignal }): Promise<string> {
  let text = '';
  let reasoning = '';
  for await (const ev of client.stream({ apiKey: o.apiKey, model: o.model, messages: o.messages, params: { temperature: 0.2, topP: 0.9, maxTokens: Math.max(o.maxTokens, 4000), reasoning: false }, zdr: o.zdr, signal: o.signal })) {
    if (ev.type === 'text') text += ev.text ?? '';
    if (ev.type === 'reasoning') reasoning += ev.text ?? '';
    if (ev.type === 'error') throw new Error(ev.error);
  }
  return text.trim() ? text : reasoning;
}

/**
 * The game master's read of a turn, before the narrator writes: what the
 * player is after, whether it can work, whether it is tested, how the world
 * answers and what changes. Runs every play turn, a plain continue included.
 */
export async function gmRead(o: { apiKey: string; model: string; zdr: boolean; signal?: AbortSignal; action: string; scene: SceneState; player: Character; universe: Universe | null; difficulty: NonNullable<Session['pov']>['difficulty']; recent: string; checks: boolean; wb: WorldBundle }): Promise<GmRead | null> {
  if (!o.scene.pov) return null;
  const sheet = renderPov(o.scene.pov, { name: o.player.name, currency: o.universe?.data.currency ?? '', difficulty: o.difficulty });
  const here = o.scene.locationId ? o.wb.entities.find((e) => e.id === o.scene.locationId) : undefined;
  const holder = here && typeof here.data.controlledBy === 'string' ? o.wb.entities.find((e) => e.id === here.data.controlledBy) : undefined;
  const around = [here ? `${here.name}: ${[here.summary, typeof here.data.dangers === 'string' ? `dangers: ${here.data.dangers}` : ''].filter(Boolean).join('; ')}` : '', holder ? `Held by ${holder.name}: ${holder.summary}` : ''].filter(Boolean).join('\n');
  const text = await helperJson({ apiKey: o.apiKey, model: o.model, zdr: o.zdr, signal: o.signal, maxTokens: 600, messages: gmReadPrompt({ name: o.player.name, action: o.action, scene: o.scene.locationName || 'unknown place', sheet, attributes: o.player.data.attributes ?? {}, recent: o.recent, checks: o.checks, threads: o.scene.pov.threads, around }) });
  return parseGmRead(text, o.checks);
}

/** Three threads for the game master's back pocket, rooted in the world and the player's character. */
export async function seedThreads(o: { apiKey: string; model: string; zdr: boolean; signal?: AbortSignal; session: Session; universe: Universe | null; species: Species[]; wb: WorldBundle; recent: string }): Promise<Thread[]> {
  if (!o.wb.player) return [];
  const lib = { universe: o.universe, entities: o.wb.entities, characters: o.wb.people, species: o.species, lore: [] };
  const pool = libraryDrafts(lib).filter((d) => d.id !== o.wb.player!.id);
  const me = characterDraft(o.wb.player, lib);
  const text = await helperJson({ apiKey: o.apiKey, model: o.model, zdr: o.zdr, signal: o.signal, maxTokens: 1200, messages: seedThreadsPrompt({ name: o.wb.player.name, knowledge: knowledge(pool, me, o.session.brief, 6000), player: draftCard(me), brief: o.session.brief, recent: o.recent }) });
  return parseThreads(text);
}

export interface ChronicleOutcome {
  at: number;
  scene: SceneState;
  events: WorldEvent[];
  minutes: number;
  notes: string[];
  newcomers: Newcomer[];
}

/** After a passage: advance the clock, move the scene, record events, and in play keep the books. */
export async function chronicle(o: {
  db: SQLiteDatabase; apiKey: string; model: string; zdr: boolean; signal?: AbortSignal;
  session: Session; universe: Universe | null; species: Species[]; wb: WorldBundle;
  beat: Beat; parentPath: Beat[]; action: string; check: CheckResult | null; read?: GmRead | null;
}): Promise<ChronicleOutcome | null> {
  const { session: s, wb } = o;
  const prevAt = clockAt(o.parentPath, s.clockStart);
  const prevScene = sceneAt(o.parentPath, initialScene(s, wb));
  const cal = o.universe?.data.calendar;
  const known = [...wb.people.map((c) => c.name), ...wb.entities.map((e) => e.name), ...o.species.map((x) => x.name)];
  const pov = s.mode === 'pov' && wb.player && prevScene.pov
    ? { name: wb.player.name, sheet: renderPov(prevScene.pov, { name: wb.player.name, currency: o.universe?.data.currency ?? '', difficulty: s.pov?.difficulty ?? 'survival' }), action: o.action, ruling: o.check ? renderCheck(o.check) : '', currency: o.universe?.data.currency || 'coins', threads: threadsForChronicle(prevScene.pov.threads) }
    : null;
  const text = await helperJson({ apiKey: o.apiKey, model: o.model, zdr: o.zdr, signal: o.signal, maxTokens: 900, messages: chroniclePrompt({ worldName: o.universe?.name ?? 'the world', now: formatTime(cal, prevAt), location: prevScene.locationName, present: prevScene.present, known, passage: o.beat.text, pov }) });
  const r = parseChronicle(text);
  if (!r) return null;
  const minutes = r.minutes > 0 ? r.minutes : 5;
  const at = prevAt + minutes;
  let scene: SceneState = { ...prevScene, ...(r.present ? { present: r.present } : {}) };
  if (r.locationName) {
    const loc = wb.entities.find((e) => e.kind === 'location' && (e.name.toLowerCase() === r.locationName!.toLowerCase() || mentions(r.locationName!, e.name)));
    scene = { ...scene, locationId: loc?.id ?? null, locationName: loc?.name ?? r.locationName };
  }
  const notes: string[] = [];
  const closedThreads: Thread[] = [];
  if (pov && prevScene.pov) {
    const timed = passTime(prevScene.pov, minutes, s.pov?.difficulty ?? 'survival', r.resting);
    const applied = r.player ? applyDelta(timed.state, r.player) : { state: timed.state, notes: [] };
    notes.push(...timed.notes, ...applied.notes);
    const moved = applyThreadUpdates(applied.state.threads ?? [], r.threads, r.newThread);
    closedThreads.push(...moved.closed);
    scene = { ...scene, pov: { ...applied.state, threads: moved.threads, lastCheck: o.check, lastRead: o.read ?? null } };
  }
  const pool = { characters: wb.people, entities: wb.entities, species: o.species };
  const instanceId = s.instanceId ?? wb.instance?.id ?? null;
  const events: WorldEvent[] = [];
  if (instanceId) {
    for (const e of r.events) events.push({ id: newId(), instanceId, sessionId: s.id, beatId: o.beat.id, at, kind: e.kind, title: e.title || e.text.slice(0, 60), text: e.text, entities: resolveRefs(e.who, pool), importance: e.importance, createdAt: now() });
    for (const c of r.changes) {
      const refs = resolveRefs([c.who], pool);
      const named = refs.some((x) => x.id);
      events.push({ id: newId(), instanceId, sessionId: s.id, beatId: o.beat.id, at, kind: c.kind, title: `${c.who}: ${c.change}`.slice(0, 80), text: c.change, entities: refs, importance: c.kind === 'death' ? 3 : named ? 2 : 1, createdAt: now() });
    }
    // A thread that lands becomes part of the world's history, whether or not the player was there.
    for (const t of closedThreads) events.push({ id: newId(), instanceId, sessionId: s.id, beatId: o.beat.id, at, kind: 'event', title: `${t.name}: ${t.status === 'done' ? 'it came to pass' : 'it came to nothing'}`.slice(0, 80), text: t.outcome ?? t.next, entities: [], importance: t.status === 'done' ? 2 : 1, createdAt: now() });
    for (const e of events) await saveEvent(o.db, e);
  }
  await updateBeatWorld(o.db, o.beat.id, at, scene);
  const knownNorm = new Set(known.map(normName));
  const newcomers = r.newcomers.filter((n) => !knownNorm.has(normName(n.name))).map((n) => ({ ...n, beatId: o.beat.id }));
  return { at, scene, events, minutes, notes, newcomers };
}
