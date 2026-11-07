import type { SQLiteDatabase } from 'expo-sqlite';
import { now } from '@/core/ids';
import { upgradeCharacter, upgradeEntity, upgradeSpecies, upgradeV3Character, upgradeV3Entity, upgradeWorld, type Candidates } from '@/core/world/upgrade';
import { listCharacters, listSpecies, listUniverses, saveCharacter, saveSpecies, saveUniverse } from './repo/library';
import { listEntities, saveEntity } from './repo/world';
import { addLinks, metaGet, metaSet } from './repo/links';

const KEY = 'library_v2';

/**
 * Once, after the schema migrations: fold every entry's old fields into the
 * consolidated ones and read its free-text ties into links. Runs in one
 * transaction per world; a world that fails is left as it was and tried again
 * on the next start.
 */
export async function upgradeLibrary(db: SQLiteDatabase): Promise<void> {
  await upgradeV2(db);
  await upgradeV3(db);
}

/** 0.18: threat levels and inspirations. */
async function upgradeV3(db: SQLiteDatabase): Promise<void> {
  if (await metaGet(db, 'library_v3')) return;
  const [worlds, people] = await Promise.all([listUniverses(db), listCharacters(db)]);
  await db.withTransactionAsync(async () => {
    for (const u of worlds) for (const e of await listEntities(db, u.id)) { const r = upgradeV3Entity(e); if (r.changed) await saveEntity(db, r.row); }
    for (const c of people) { const r = upgradeV3Character(c); if (r.changed) await saveCharacter(db, r.row); }
  });
  await metaSet(db, 'library_v3', String(now()));
}

async function upgradeV2(db: SQLiteDatabase): Promise<void> {
  if (await metaGet(db, KEY)) return;
  const t = now();
  let failed = false;
  const [worlds, people] = await Promise.all([listUniverses(db), listCharacters(db)]);
  for (const u of worlds) {
    try {
      const [entities, species] = await Promise.all([listEntities(db, u.id), listSpecies(db, u.id)]);
      const cast = people.filter((c) => c.universeId === u.id);
      const candidates: Candidates[] = [...cast, ...entities.filter((e) => e.kind !== 'item'), ...species].map((x) => ({ id: x.id, name: x.name }));
      await db.withTransactionAsync(async () => {
        const w = upgradeWorld(u);
        if (w.changed) await saveUniverse(db, w.row);
        for (const e of entities) {
          const r = upgradeEntity(e, candidates, t);
          if (r.changed) await saveEntity(db, r.row);
          if (r.links.length) await addLinks(db, r.links);
        }
        for (const sp of species) {
          const r = upgradeSpecies(sp, candidates, t);
          if (r.changed) await saveSpecies(db, r.row);
          if (r.links.length) await addLinks(db, r.links);
        }
        for (const c of cast) {
          const r = upgradeCharacter(c, candidates, t);
          if (r.changed) await saveCharacter(db, r.row);
          if (r.links.length) await addLinks(db, r.links);
        }
      });
    } catch (e) {
      failed = true;
      console.warn(`library upgrade: ${u.name}`, e);
    }
  }
  // Characters in no world keep their text; only their own fields fold.
  for (const c of people.filter((x) => !x.universeId)) {
    const r = upgradeCharacter(c, [], t);
    if (r.changed) await saveCharacter(db, r.row);
  }
  if (!failed) await metaSet(db, KEY, String(t));
}
