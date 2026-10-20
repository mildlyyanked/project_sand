import type { SQLiteDatabase } from 'expo-sqlite';
import type { LensData } from '@/core/lens';
import { now } from '@/core/ids';

export async function getLens(db: SQLiteDatabase, beatId: string): Promise<LensData | null> {
  const r = await db.getFirstAsync<{ data_json: string }>('SELECT data_json FROM lens WHERE beat_id = ?', beatId);
  if (!r) return null;
  try {
    return JSON.parse(r.data_json) as LensData;
  } catch {
    return null;
  }
}

/** Which passages of a story have been looked at, for their highlights. */
export async function listLens(db: SQLiteDatabase, sessionId: string): Promise<Map<string, LensData>> {
  const rows = await db.getAllAsync<{ beat_id: string; data_json: string }>('SELECT beat_id, data_json FROM lens WHERE session_id = ?', sessionId);
  const out = new Map<string, LensData>();
  for (const r of rows) {
    try {
      out.set(r.beat_id, JSON.parse(r.data_json) as LensData);
    } catch {}
  }
  return out;
}

export async function saveLens(db: SQLiteDatabase, beatId: string, sessionId: string, data: LensData): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lens (beat_id, session_id, data_json, created_at) VALUES (?,?,?,?)', beatId, sessionId, JSON.stringify(data), now());
}
