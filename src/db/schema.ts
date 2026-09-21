import type { SQLiteDatabase } from 'expo-sqlite';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE universes (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE species (id TEXT PRIMARY KEY, universe_id TEXT NOT NULL, name TEXT NOT NULL, adulthood TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
  CREATE INDEX species_universe ON species(universe_id);
  CREATE TABLE lore (id TEXT PRIMARY KEY, universe_id TEXT NOT NULL, title TEXT NOT NULL, keys_json TEXT NOT NULL DEFAULT '[]', text TEXT NOT NULL DEFAULT '', always_on INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX lore_universe ON lore(universe_id);
  CREATE TABLE canon (id TEXT PRIMARY KEY, universe_id TEXT NOT NULL, session_id TEXT, title TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE INDEX canon_universe ON canon(universe_id);
  CREATE TABLE characters (id TEXT PRIMARY KEY, universe_id TEXT, species_id TEXT, name TEXT NOT NULL, life_stage TEXT NOT NULL DEFAULT '', adult INTEGER NOT NULL DEFAULT 1, summary TEXT NOT NULL DEFAULT '', voice TEXT NOT NULL DEFAULT '', tells TEXT NOT NULL DEFAULT '', relationships TEXT NOT NULL DEFAULT '', limits TEXT NOT NULL DEFAULT '', preferences TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE styles (id TEXT PRIMARY KEY, name TEXT NOT NULL, pov TEXT NOT NULL DEFAULT '', tense TEXT NOT NULL DEFAULT '', density TEXT NOT NULL DEFAULT '', dialogue TEXT NOT NULL DEFAULT '', register TEXT NOT NULL DEFAULT 'blunt', vocabulary TEXT NOT NULL DEFAULT '', banned_json TEXT NOT NULL DEFAULT '[]', samples_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, system TEXT NOT NULL DEFAULT '', prefill TEXT NOT NULL DEFAULT '', post_history TEXT NOT NULL DEFAULT '', overrides_json TEXT NOT NULL DEFAULT '{}', chain_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, universe_id TEXT, style_id TEXT, preset_id TEXT, character_ids_json TEXT NOT NULL DEFAULT '[]', models_json TEXT NOT NULL, params_json TEXT NOT NULL, strategy_json TEXT NOT NULL, zdr INTEGER NOT NULL DEFAULT 0, explicit INTEGER NOT NULL DEFAULT 0, heat INTEGER NOT NULL DEFAULT 2, current_beat_id TEXT, summary TEXT NOT NULL DEFAULT '', summary_upto TEXT, variant_of TEXT, variant_note TEXT NOT NULL DEFAULT '', is_template INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE beats (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', model TEXT, direction TEXT, reasoning TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, created_at INTEGER NOT NULL);
  CREATE INDEX beats_session ON beats(session_id);
  CREATE INDEX beats_parent ON beats(parent_id);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let v = row?.user_version ?? 0;
  while (v < MIGRATIONS.length) {
    const sql = MIGRATIONS[v]!;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
    });
    v++;
    await db.execAsync(`PRAGMA user_version = ${v}`);
  }
}

export const DB_NAME = 'sand.db';
