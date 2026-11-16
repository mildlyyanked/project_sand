import type { SQLiteDatabase } from 'expo-sqlite';
import { emptyReader, type ReaderData } from '@/core/reader';
import { now } from '@/core/ids';
import { j, pj } from './map';

/** A story's reader: who they are, where they are up to, and the conversation. */
export async function getReader(db: SQLiteDatabase, sessionId: string): Promise<ReaderData> {
  const r = await db.getFirstAsync<{ data_json: string }>('SELECT data_json FROM reader WHERE session_id = ?', sessionId);
  return { ...emptyReader(), ...pj<Partial<ReaderData>>(r?.data_json, {}) };
}

export async function saveReader(db: SQLiteDatabase, sessionId: string, d: ReaderData): Promise<void> {
  // The last few hundred messages are plenty for a conversation beside a story.
  const keep = { ...d, messages: d.messages.slice(-300) };
  await db.runAsync('INSERT OR REPLACE INTO reader (session_id, data_json, updated_at) VALUES (?,?,?)', sessionId, j(keep), now());
}

export async function deleteReader(db: SQLiteDatabase, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM reader WHERE session_id = ?', sessionId);
}
