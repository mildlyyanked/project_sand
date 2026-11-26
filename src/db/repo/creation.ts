import type { SQLiteDatabase } from 'expo-sqlite';
import type { Id } from '@/core/types';
import { newCreation, type Creation } from '@/core/world/creation';
import { now } from '@/core/ids';
import { j, pj } from './map';

interface CRow { id: string; universe_id: string | null; stage: string; data_json: string; created_at: number; updated_at: number }
const from = (r: CRow): Creation => ({
  ...newCreation({ id: r.id, model: '', now: r.created_at }),
  ...pj<Partial<Creation>>(r.data_json, {}),
  id: r.id, universeId: r.universe_id, stage: r.stage as Creation['stage'], createdAt: r.created_at, updatedAt: r.updated_at,
});

/** A world creation session: where it stands, what is on the table, what was decided. */
export async function getCreation(db: SQLiteDatabase, id: Id): Promise<Creation | null> {
  const r = await db.getFirstAsync<CRow>('SELECT * FROM creations WHERE id = ?', id);
  return r ? from(r) : null;
}

export async function saveCreation(db: SQLiteDatabase, c: Creation): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO creations (id, universe_id, stage, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?)', c.id, c.universeId, c.stage, j(c), c.createdAt, now());
}

/** Every session, the unfinished first, then the newest. */
export async function listCreations(db: SQLiteDatabase): Promise<Creation[]> {
  return (await db.getAllAsync<CRow>("SELECT * FROM creations ORDER BY (stage = 'done'), updated_at DESC LIMIT 100")).map(from);
}

/** The session that built, or is building, a world. */
export async function creationOf(db: SQLiteDatabase, universeId: Id): Promise<Creation | null> {
  const r = await db.getFirstAsync<CRow>("SELECT * FROM creations WHERE universe_id = ? ORDER BY (stage = 'done'), updated_at DESC LIMIT 1", universeId);
  return r ? from(r) : null;
}

export async function deleteCreation(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM creations WHERE id = ?', id);
}
