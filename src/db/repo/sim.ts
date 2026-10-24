import type { SQLiteDatabase } from 'expo-sqlite';
import type { SimState } from '@/core/sim/types';
import { now } from '@/core/ids';

/** World snapshots for a play story, by the passage they were taken at ('root' before the first). */
export async function listSnaps(db: SQLiteDatabase, sessionId: string): Promise<Map<string, SimState>> {
  const rows = await db.getAllAsync<{ beat_id: string; data_json: string }>('SELECT beat_id, data_json FROM sim_snap WHERE session_id = ?', sessionId);
  const out = new Map<string, SimState>();
  for (const r of rows) {
    try {
      out.set(r.beat_id, JSON.parse(r.data_json) as SimState);
    } catch {}
  }
  return out;
}

export async function saveSnap(db: SQLiteDatabase, sessionId: string, beatId: string, sim: SimState): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO sim_snap (session_id, beat_id, data_json, created_at) VALUES (?,?,?,?)', sessionId, beatId, JSON.stringify(sim), now());
}

export async function clearSnaps(db: SQLiteDatabase, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM sim_snap WHERE session_id = ?', sessionId);
}
