import type { SQLiteDatabase } from 'expo-sqlite';
import type { Id } from '@/core/types';
import type { StoredLink, StoredType } from '@/core/world/links';
import { sameTie } from '@/core/world/links';
import { newId, now } from '@/core/ids';

interface LRow { id: string; universe_id: string; from_id: string; to_id: string; type: string; note: string; created_at: number }
const lFrom = (r: LRow): StoredLink => ({ id: r.id, universeId: r.universe_id, from: r.from_id, to: r.to_id, type: r.type as StoredType, note: r.note, createdAt: r.created_at });

export async function listLinks(db: SQLiteDatabase, universeId: Id): Promise<StoredLink[]> {
  return (await db.getAllAsync<LRow>('SELECT * FROM links WHERE universe_id = ? ORDER BY created_at', universeId)).map(lFrom);
}

export async function linksOf(db: SQLiteDatabase, id: Id): Promise<StoredLink[]> {
  return (await db.getAllAsync<LRow>('SELECT * FROM links WHERE from_id = ? OR to_id = ? ORDER BY created_at', id, id)).map(lFrom);
}

export async function saveLink(db: SQLiteDatabase, l: StoredLink): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO links (id, universe_id, from_id, to_id, type, note, created_at) VALUES (?,?,?,?,?,?,?)', l.id, l.universeId, l.from, l.to, l.type, l.note, l.createdAt || now());
}

export async function deleteLink(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM links WHERE id = ?', id);
}

/** Every link touching an entry goes with it. */
export async function deleteLinksOf(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM links WHERE from_id = ? OR to_id = ?', id, id);
}

/** Add links that are not already there (the same tie either way counts as there). */
export async function addLinks(db: SQLiteDatabase, links: StoredLink[]): Promise<number> {
  let n = 0;
  const byUni = new Map<string, StoredLink[]>();
  for (const l of links) {
    const have = byUni.get(l.universeId) ?? (await listLinks(db, l.universeId));
    byUni.set(l.universeId, have);
    if (have.some((h) => sameTie(h, l))) continue;
    const row = { ...l, id: l.id && !have.some((h) => h.id === l.id) ? l.id : newId(), createdAt: l.createdAt || now() };
    await saveLink(db, row);
    have.push(row);
    n++;
  }
  return n;
}

/**
 * Make an entry's stored links what an editor says they are: new rows added,
 * changed rows rewritten, rows no longer there removed.
 */
export async function syncLinks(db: SQLiteDatabase, id: Id, next: StoredLink[]): Promise<void> {
  const before = await linksOf(db, id);
  await db.withTransactionAsync(async () => {
    for (const b of before) if (!next.some((n) => n.id === b.id)) await deleteLink(db, b.id);
    for (const n of next) {
      const b = before.find((x) => x.id === n.id);
      if (!b || b.type !== n.type || b.note !== n.note || b.to !== n.to || b.from !== n.from) await saveLink(db, n);
    }
  });
}

export async function metaGet(db: SQLiteDatabase, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value ?? null;
}
export async function metaSet(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}
