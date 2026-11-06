import type { SQLiteDatabase } from 'expo-sqlite';
import type { InstanceEntry, InstanceMemory, PersonMemory, Recap } from '@/core/world/memory';
import { now } from '@/core/ids';

/** An instance's memory: chapter recaps, people, and what is real only there. */
export async function loadMemory(db: SQLiteDatabase, instanceId: string): Promise<InstanceMemory> {
  const rows = await db.getAllAsync<{ kind: string; data_json: string }>('SELECT kind, data_json FROM memory WHERE instance_id = ? ORDER BY updated_at', instanceId);
  const out: InstanceMemory = { recaps: [], people: [], entries: [] };
  for (const r of rows) {
    try {
      const v = JSON.parse(r.data_json);
      if (r.kind === 'recap') out.recaps.push(v as Recap);
      else if (r.kind === 'person') out.people.push(v as PersonMemory);
      else if (r.kind === 'entry') out.entries.push(v as InstanceEntry);
    } catch {}
  }
  return out;
}

const put = (db: SQLiteDatabase, id: string, instanceId: string, kind: string, ref: string, data: unknown) =>
  db.runAsync('INSERT OR REPLACE INTO memory (id, instance_id, kind, ref, data_json, updated_at) VALUES (?,?,?,?,?,?)', id, instanceId, kind, ref, JSON.stringify(data), now());

export const saveRecap = (db: SQLiteDatabase, instanceId: string, r: Recap) => put(db, `recap:${r.sessionId}`, instanceId, 'recap', r.sessionId, r);
export const savePerson = (db: SQLiteDatabase, instanceId: string, p: PersonMemory) => put(db, `person:${instanceId}:${p.key}`, instanceId, 'person', p.key, p);
export const saveEntry = (db: SQLiteDatabase, instanceId: string, e: InstanceEntry) => put(db, `entry:${instanceId}:${e.key}`, instanceId, 'entry', e.key, e);

export async function deletePerson(db: SQLiteDatabase, instanceId: string, key: string): Promise<void> {
  await db.runAsync('DELETE FROM memory WHERE id = ?', `person:${instanceId}:${key}`);
}
export async function deleteEntry(db: SQLiteDatabase, instanceId: string, key: string): Promise<void> {
  await db.runAsync('DELETE FROM memory WHERE id = ?', `entry:${instanceId}:${key}`);
}
