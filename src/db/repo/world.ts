import type { SQLiteDatabase } from 'expo-sqlite';
import type { Id, Session } from '@/core/types';
import type { EntityKind, WorldEntity, WorldEvent, WorldInstance } from '@/core/world/types';
import type { SiblingStory } from '@/core/world/continuity';
import { newId, now } from '@/core/ids';
import { b, ib, j, pj } from './map';

// Elements: places, factions, things

interface ERow { id: string; universe_id: string; kind: string; name: string; parent_id: string | null; summary: string; keys_json: string; data_json: string; created_at: number; updated_at: number }
const eFrom = (r: ERow): WorldEntity => ({ id: r.id, universeId: r.universe_id, kind: r.kind as EntityKind, name: r.name, parentId: r.parent_id, summary: r.summary, keys: pj(r.keys_json, []), data: pj(r.data_json, {}), createdAt: r.created_at, updatedAt: r.updated_at });

export async function listEntities(db: SQLiteDatabase, universeId: Id, kind?: EntityKind): Promise<WorldEntity[]> {
  const rows = kind
    ? await db.getAllAsync<ERow>('SELECT * FROM entities WHERE universe_id = ? AND kind = ? ORDER BY name', universeId, kind)
    : await db.getAllAsync<ERow>('SELECT * FROM entities WHERE universe_id = ? ORDER BY kind, name', universeId);
  return rows.map(eFrom);
}
export async function getEntity(db: SQLiteDatabase, id: Id): Promise<WorldEntity | null> {
  const r = await db.getFirstAsync<ERow>('SELECT * FROM entities WHERE id = ?', id);
  return r ? eFrom(r) : null;
}
export async function saveEntity(db: SQLiteDatabase, e: WorldEntity): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO entities (id, universe_id, kind, name, parent_id, summary, keys_json, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', e.id, e.universeId, e.kind, e.name, e.parentId, e.summary, j(e.keys), j(e.data), e.createdAt, now());
}
/** Children move up to the deleted element's parent so a hierarchy never breaks. */
export async function deleteEntity(db: SQLiteDatabase, id: Id): Promise<void> {
  const e = await getEntity(db, id);
  if (!e) return;
  await db.runAsync('UPDATE entities SET parent_id = ? WHERE parent_id = ?', e.parentId, id);
  await db.runAsync('DELETE FROM entities WHERE id = ?', id);
}
export const newEntity = (universeId: Id, kind: EntityKind, name?: string, parentId: Id | null = null): WorldEntity => ({ id: newId(), universeId, kind, name: name ?? (kind === 'location' ? 'New place' : kind === 'organization' ? 'New faction' : 'New thing'), parentId, summary: '', keys: [], data: {}, createdAt: now(), updatedAt: now() });

// Instances

interface IRow { id: string; universe_id: string; name: string; description: string; forked_from: string | null; fork_at: number | null; is_prime: number; created_at: number; updated_at: number }
const iFrom = (r: IRow): WorldInstance => ({ id: r.id, universeId: r.universe_id, name: r.name, description: r.description, forkedFrom: r.forked_from, forkAt: r.fork_at, isPrime: b(r.is_prime), createdAt: r.created_at, updatedAt: r.updated_at });

export async function listInstances(db: SQLiteDatabase, universeId?: Id): Promise<WorldInstance[]> {
  const rows = universeId ? await db.getAllAsync<IRow>('SELECT * FROM instances WHERE universe_id = ? ORDER BY is_prime DESC, created_at', universeId) : await db.getAllAsync<IRow>('SELECT * FROM instances ORDER BY is_prime DESC, created_at');
  return rows.map(iFrom);
}
export async function getInstance(db: SQLiteDatabase, id: Id | null): Promise<WorldInstance | null> {
  if (!id) return null;
  const r = await db.getFirstAsync<IRow>('SELECT * FROM instances WHERE id = ?', id);
  return r ? iFrom(r) : null;
}
export async function saveInstance(db: SQLiteDatabase, i: WorldInstance): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO instances (id, universe_id, name, description, forked_from, fork_at, is_prime, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', i.id, i.universeId, i.name, i.description, i.forkedFrom, i.forkAt, ib(i.isPrime), i.createdAt, now());
}
export const newInstance = (universeId: Id, name = 'New instance', isPrime = false): WorldInstance => ({ id: newId(), universeId, name, description: '', forkedFrom: null, forkAt: null, isPrime, createdAt: now(), updatedAt: now() });

/** The instance a world's stories use unless told otherwise; created on first need. */
export async function primeInstance(db: SQLiteDatabase, universeId: Id, name = 'Prime'): Promise<WorldInstance> {
  const r = await db.getFirstAsync<IRow>('SELECT * FROM instances WHERE universe_id = ? AND is_prime = 1', universeId);
  if (r) return iFrom(r);
  const i = newInstance(universeId, name, true);
  await saveInstance(db, i);
  return i;
}

/** Stories move to the world's prime instance; their recorded events go with the instance. */
export async function deleteInstance(db: SQLiteDatabase, id: Id): Promise<void> {
  const i = await getInstance(db, id);
  if (!i || i.isPrime) return;
  const prime = await primeInstance(db, i.universeId);
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE sessions SET instance_id = ? WHERE instance_id = ?', prime.id, id);
    await db.runAsync('DELETE FROM world_events WHERE instance_id = ?', id);
    await db.runAsync('DELETE FROM instances WHERE id = ?', id);
  });
}

// Timeline

interface WRow { id: string; instance_id: string; session_id: string | null; beat_id: string | null; at: number; kind: string; title: string; text: string; entities_json: string; importance: number; created_at: number }
const wFrom = (r: WRow): WorldEvent => ({ id: r.id, instanceId: r.instance_id, sessionId: r.session_id, beatId: r.beat_id, at: r.at, kind: r.kind as WorldEvent['kind'], title: r.title, text: r.text, entities: pj(r.entities_json, []), importance: Math.max(1, Math.min(3, r.importance)) as 1 | 2 | 3, createdAt: r.created_at });

export async function listEvents(db: SQLiteDatabase, instanceId: Id): Promise<WorldEvent[]> {
  return (await db.getAllAsync<WRow>('SELECT * FROM world_events WHERE instance_id = ? ORDER BY at, created_at', instanceId)).map(wFrom);
}
export async function saveEvent(db: SQLiteDatabase, e: WorldEvent): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO world_events (id, instance_id, session_id, beat_id, at, kind, title, text, entities_json, importance, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', e.id, e.instanceId, e.sessionId, e.beatId, Math.round(e.at), e.kind, e.title, e.text, j(e.entities), e.importance, e.createdAt);
}
export async function deleteEvent(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM world_events WHERE id = ?', id);
}
export async function deleteEventsForBeat(db: SQLiteDatabase, beatId: Id): Promise<void> {
  await db.runAsync('DELETE FROM world_events WHERE beat_id = ?', beatId);
}
export const newEvent = (instanceId: Id, at: number, p: Partial<WorldEvent> = {}): WorldEvent => ({ id: newId(), instanceId, sessionId: null, beatId: null, at, kind: 'event', title: '', text: '', entities: [], importance: 2, createdAt: now(), ...p });

/** Ids of the beats on a story's current branch, root to tip. */
export async function pathIds(db: SQLiteDatabase, tip: Id | null): Promise<Set<string>> {
  if (!tip) return new Set();
  const rows = await db.getAllAsync<{ id: string }>('WITH RECURSIVE p(id, parent_id) AS (SELECT id, parent_id FROM beats WHERE id = ? UNION ALL SELECT b.id, b.parent_id FROM beats b JOIN p ON b.id = p.parent_id) SELECT id FROM p', tip);
  return new Set(rows.map((r) => r.id));
}

/**
 * The instance's canon: events entered by hand, plus each story's events from
 * its current branch only. Abandoned branches stay recorded but do not count.
 * `override` stands in for one story's branch (the one being written now).
 */
export async function canonEvents(db: SQLiteDatabase, instanceId: Id, override?: { sessionId: Id; path: Set<string> }): Promise<WorldEvent[]> {
  const events = await listEvents(db, instanceId);
  const sessionIds = [...new Set(events.map((e) => e.sessionId).filter((x): x is string => !!x))];
  const paths = new Map<string, Set<string>>();
  for (const sid of sessionIds) {
    if (override?.sessionId === sid) { paths.set(sid, override.path); continue; }
    const row = await db.getFirstAsync<{ current_beat_id: string | null }>('SELECT current_beat_id FROM sessions WHERE id = ?', sid);
    if (row) paths.set(sid, await pathIds(db, row.current_beat_id));
  }
  return events.filter((e) => !e.sessionId || (!!e.beatId && !!paths.get(e.sessionId)?.has(e.beatId)));
}

/** Other stories in the instance with where their clocks stand and what happened in them. */
export async function siblingStories(db: SQLiteDatabase, instanceId: Id, exceptSessionId: Id | null): Promise<SiblingStory[]> {
  const rows = await db.getAllAsync<{ id: string; title: string; mode: string; clock_start: number; summary: string; current_beat_id: string | null }>('SELECT id, title, mode, clock_start, summary, current_beat_id FROM sessions WHERE instance_id = ? AND is_template = 0 AND id != ?', instanceId, exceptSessionId ?? '');
  const out: SiblingStory[] = [];
  for (const r of rows) {
    const ids = [...(await pathIds(db, r.current_beat_id))];
    if (!ids.length && !r.summary.trim()) continue;
    const beats = ids.length ? await db.getAllAsync<{ text: string; at: number | null; role: string; created_at: number }>(`SELECT text, at, role, created_at FROM beats WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`, ...ids) : [];
    const clock = beats.reduce((m, x) => (x.at != null && x.at > m ? x.at : m), r.clock_start ?? 0);
    const lastProse = [...beats].reverse().find((x) => x.role === 'prose')?.text ?? '';
    out.push({ title: r.title, mode: r.mode === 'pov' ? 'pov' : 'writer', clockStart: r.clock_start ?? 0, clock, summary: r.summary ?? '', excerpt: lastProse.slice(-700) });
  }
  return out;
}

/** A new version of the world that shares everything up to `at` and nothing after. */
export async function forkInstance(db: SQLiteDatabase, from: WorldInstance, at: number, name: string, description: string): Promise<WorldInstance> {
  const canon = (await canonEvents(db, from.id)).filter((e) => e.at <= at);
  const inst: WorldInstance = { ...newInstance(from.universeId, name), description, forkedFrom: from.id, forkAt: Math.round(at) };
  await db.withTransactionAsync(async () => {
    await saveInstance(db, inst);
    for (const e of canon) await saveEvent(db, { ...e, id: newId(), instanceId: inst.id, sessionId: null, beatId: null });
  });
  return inst;
}

export async function sessionsInInstance(db: SQLiteDatabase, instanceId: Id): Promise<Pick<Session, 'id' | 'title' | 'mode' | 'clockStart'>[]> {
  const rows = await db.getAllAsync<{ id: string; title: string; mode: string; clock_start: number }>('SELECT id, title, mode, clock_start FROM sessions WHERE instance_id = ? AND is_template = 0 ORDER BY clock_start', instanceId);
  return rows.map((r) => ({ id: r.id, title: r.title, mode: r.mode === 'pov' ? 'pov' : 'writer', clockStart: r.clock_start }));
}

/** The latest in-world time anything in the instance has reached. */
export async function instanceClock(db: SQLiteDatabase, instanceId: Id): Promise<number> {
  const a = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(at) as m FROM world_events WHERE instance_id = ?', instanceId);
  const b2 = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(b.at) as m FROM beats b JOIN sessions s ON s.id = b.session_id WHERE s.instance_id = ?', instanceId);
  const c = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(clock_start) as m FROM sessions WHERE instance_id = ?', instanceId);
  return Math.max(a?.m ?? 0, b2?.m ?? 0, c?.m ?? 0);
}

export async function defaultWorldId(db: SQLiteDatabase): Promise<Id | null> {
  const r = await db.getFirstAsync<{ id: string }>('SELECT id FROM universes WHERE is_default = 1');
  return r?.id ?? null;
}
