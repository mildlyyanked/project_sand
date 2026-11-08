import type { SQLiteDatabase } from 'expo-sqlite';
import type { Id } from '@/core/types';
import type { MapDoc } from '@/core/map/types';
import { j, pj } from './map';

/** The world's maps, one per place. */
interface MRow { location_id: string; universe_id: string; data_json: string; updated_at: number }
const mFrom = (r: MRow): MapDoc | null => {
  const d = pj<MapDoc | null>(r.data_json, null);
  return d ? { ...d, locationId: r.location_id, universeId: r.universe_id, ground: d.ground ?? 'land', updatedAt: r.updated_at } : null;
};

export async function getMap(db: SQLiteDatabase, locationId: Id): Promise<MapDoc | null> {
  const r = await db.getFirstAsync<MRow>('SELECT * FROM maps WHERE location_id = ?', locationId);
  return r ? mFrom(r) : null;
}

export async function listMaps(db: SQLiteDatabase, universeId: Id): Promise<MapDoc[]> {
  return (await db.getAllAsync<MRow>('SELECT * FROM maps WHERE universe_id = ?', universeId)).map(mFrom).filter((m): m is MapDoc => !!m);
}

export async function saveMap(db: SQLiteDatabase, m: MapDoc): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO maps (location_id, universe_id, data_json, updated_at) VALUES (?,?,?,?)', m.locationId, m.universeId, j(m), m.updatedAt);
}

export async function deleteMap(db: SQLiteDatabase, locationId: Id): Promise<void> {
  await db.runAsync('DELETE FROM maps WHERE location_id = ?', locationId);
}
