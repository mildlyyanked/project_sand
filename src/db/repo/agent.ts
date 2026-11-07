import type { SQLiteDatabase } from 'expo-sqlite';
import type { Id } from '@/core/types';
import { EMPTY_AGENT, type AgentState, type WorkshopMessage } from '@/core/world/agent';
import { now } from '@/core/ids';
import { j, pj } from './map';

export async function getAgent(db: SQLiteDatabase, universeId: Id): Promise<AgentState> {
  const r = await db.getFirstAsync<{ data_json: string }>('SELECT data_json FROM agent WHERE universe_id = ?', universeId);
  return { ...EMPTY_AGENT, ...pj<Partial<AgentState>>(r?.data_json, {}) };
}

export async function saveAgent(db: SQLiteDatabase, universeId: Id, a: AgentState): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO agent (universe_id, data_json, updated_at) VALUES (?,?,?)', universeId, j(a), now());
}

/** Read, change and write the agent in one go, so two writers never undo each other. */
export async function patchAgent(db: SQLiteDatabase, universeId: Id, f: (a: AgentState) => AgentState): Promise<AgentState> {
  const next = f(await getAgent(db, universeId));
  await saveAgent(db, universeId, next);
  return next;
}

interface WRow { id: string; universe_id: string; role: string; text: string; data_json: string; created_at: number }
const wFrom = (r: WRow): WorkshopMessage => ({ id: r.id, universeId: r.universe_id, role: r.role as WorkshopMessage['role'], text: r.text, data: pj(r.data_json, {}), createdAt: r.created_at });

export async function listWorkshop(db: SQLiteDatabase, universeId: Id, limit = 200): Promise<WorkshopMessage[]> {
  return (await db.getAllAsync<WRow>('SELECT * FROM (SELECT * FROM workshop WHERE universe_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at', universeId, limit)).map(wFrom);
}

export async function saveWorkshop(db: SQLiteDatabase, m: WorkshopMessage): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO workshop (id, universe_id, role, text, data_json, created_at) VALUES (?,?,?,?,?,?)', m.id, m.universeId, m.role, m.text, j(m.data), m.createdAt);
}

export async function getWorkshopMessage(db: SQLiteDatabase, id: Id): Promise<WorkshopMessage | null> {
  const r = await db.getFirstAsync<WRow>('SELECT * FROM workshop WHERE id = ?', id);
  return r ? wFrom(r) : null;
}

export async function clearWorkshop(db: SQLiteDatabase, universeId: Id): Promise<void> {
  await db.runAsync('DELETE FROM workshop WHERE universe_id = ?', universeId);
}
