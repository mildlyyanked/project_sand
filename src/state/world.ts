import type { SQLiteDatabase } from 'expo-sqlite';
import type { Beat, Character, Session, Species, Universe } from '@/core/types';
import type { WorldContext } from '@/core/context/assemble';
import type { CheckResult, SceneState, WorldEntity, WorldEvent, WorldInstance } from '@/core/world/types';
import type { Newcomer } from '@/core/world/forge';
import { normName } from '@/core/world/drafts';
import { clockAt, sceneAt } from '@/core/world/timeline';
import { applyDelta, initialPov, passTime, renderPov } from '@/core/world/survival';
import { adjudicatePrompt, chroniclePrompt, parseChronicle, parseRuling, type Ruling } from '@/core/world/chronicle';
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
    pov: s.mode === 'pov' && wb.player ? initialPov({ money: wb.player.data.money, inventory: wb.player.data.inventory }) : undefined,
  };
}

export async function buildWorldContext(db: SQLiteDatabase, s: Session, path: Beat[], wb: WorldBundle, extra: { check?: CheckResult | null; survivalNotes?: string[] } = {}): Promise<WorldContext | undefined> {
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
    now: clockAt(path, s.clockStart),
    scene: sceneAt(path, initialScene(s, wb)),
    player: s.mode === 'pov' ? wb.player : null,
    check: extra.check ?? null,
    survivalNotes: extra.survivalNotes,
  };
}

async function helperJson(o: { apiKey: string; model: string; messages: Parameters<typeof client.stream>[0]['messages']; maxTokens: number; zdr: boolean; signal?: AbortSignal }): Promise<string> {
  let text = '';
  let reasoning = '';
  for await (const ev of client.stream({ apiKey: o.apiKey, model: o.model, messages: o.messages, params: { temperature: 0.2, topP: 0.9, maxTokens: Math.max(o.maxTokens, 4000), reasoning: false }, zdr: o.zdr, signal: o.signal })) {
    if (ev.type === 'text') text += ev.text ?? '';
    if (ev.type === 'reasoning') reasoning += ev.text ?? '';
    if (ev.type === 'error') throw new Error(ev.error);
  }
  return text.trim() ? text : reasoning;
}

/** The referee's call on the player's action, or null when it needs no test. */
export async function referee(o: { apiKey: string; model: string; zdr: boolean; signal?: AbortSignal; action: string; scene: SceneState; player: Character; universe: Universe | null; difficulty: Session['pov'] extends infer P ? P extends { difficulty: infer D } ? D : never : never; recent: string }): Promise<Ruling | null> {
  if (!o.scene.pov) return null;
  const sheet = renderPov(o.scene.pov, { name: o.player.name, currency: o.universe?.data.currency ?? '', difficulty: o.difficulty });
  const text = await helperJson({ apiKey: o.apiKey, model: o.model, zdr: o.zdr, signal: o.signal, maxTokens: 300, messages: adjudicatePrompt({ action: o.action, scene: o.scene.locationName || 'unknown place', sheet, attributes: o.player.data.attributes ?? {}, recent: o.recent }) });
  return parseRuling(text);
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
  beat: Beat; parentPath: Beat[]; action: string; check: CheckResult | null;
}): Promise<ChronicleOutcome | null> {
  const { session: s, wb } = o;
  const prevAt = clockAt(o.parentPath, s.clockStart);
  const prevScene = sceneAt(o.parentPath, initialScene(s, wb));
  const cal = o.universe?.data.calendar;
  const known = [...wb.people.map((c) => c.name), ...wb.entities.map((e) => e.name), ...o.species.map((x) => x.name)];
  const pov = s.mode === 'pov' && wb.player && prevScene.pov
    ? { name: wb.player.name, sheet: renderPov(prevScene.pov, { name: wb.player.name, currency: o.universe?.data.currency ?? '', difficulty: s.pov?.difficulty ?? 'survival' }), action: o.action, ruling: o.check ? renderCheck(o.check) : '', currency: o.universe?.data.currency || 'coins' }
    : null;
  const text = await helperJson({ apiKey: o.apiKey, model: o.model, zdr: o.zdr, signal: o.signal, maxTokens: 900, messages: chroniclePrompt({ worldName: o.universe?.name ?? 'the world', now: formatTime(cal, prevAt), location: prevScene.locationName, known, passage: o.beat.text, pov }) });
  const r = parseChronicle(text);
  if (!r) return null;
  const minutes = r.minutes > 0 ? r.minutes : 5;
  const at = prevAt + minutes;
  let scene: SceneState = { ...prevScene };
  if (r.locationName) {
    const loc = wb.entities.find((e) => e.kind === 'location' && (e.name.toLowerCase() === r.locationName!.toLowerCase() || mentions(r.locationName!, e.name)));
    scene = { ...scene, locationId: loc?.id ?? null, locationName: loc?.name ?? r.locationName };
  }
  const notes: string[] = [];
  if (pov && prevScene.pov) {
    const timed = passTime(prevScene.pov, minutes, s.pov?.difficulty ?? 'survival', r.resting);
    const applied = r.player ? applyDelta(timed.state, r.player) : { state: timed.state, notes: [] };
    notes.push(...timed.notes, ...applied.notes);
    scene = { ...scene, pov: { ...applied.state, lastCheck: o.check } };
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
    for (const e of events) await saveEvent(o.db, e);
  }
  await updateBeatWorld(o.db, o.beat.id, at, scene);
  const knownNorm = new Set(known.map(normName));
  const newcomers = r.newcomers.filter((n) => !knownNorm.has(normName(n.name))).map((n) => ({ ...n, beatId: o.beat.id }));
  return { at, scene, events, minutes, notes, newcomers };
}
