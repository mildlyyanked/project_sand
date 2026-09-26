import type { SQLiteDatabase } from 'expo-sqlite';
import type { CanonEvent, Character, Id, LoreEntry, ModelStat, Preset, Species, Style, Universe } from '@/core/types';
import { newId, now } from '@/core/ids';
import { b, ib, j, pj } from './map';

// Universes

interface URow { id: string; name: string; description: string; created_at: number; updated_at: number }
const uFrom = (r: URow): Universe => ({ id: r.id, name: r.name, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at });

export async function listUniverses(db: SQLiteDatabase): Promise<Universe[]> {
  return (await db.getAllAsync<URow>('SELECT * FROM universes ORDER BY updated_at DESC')).map(uFrom);
}
export async function getUniverse(db: SQLiteDatabase, id: Id): Promise<Universe | null> {
  const r = await db.getFirstAsync<URow>('SELECT * FROM universes WHERE id = ?', id);
  return r ? uFrom(r) : null;
}
export async function saveUniverse(db: SQLiteDatabase, u: Universe): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO universes (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)', u.id, u.name, u.description, u.createdAt, now());
}
export async function deleteUniverse(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM species WHERE universe_id = ?', id);
    await db.runAsync('DELETE FROM lore WHERE universe_id = ?', id);
    await db.runAsync('DELETE FROM canon WHERE universe_id = ?', id);
    await db.runAsync('UPDATE characters SET universe_id = NULL, species_id = NULL WHERE universe_id = ?', id);
    await db.runAsync('UPDATE sessions SET universe_id = NULL WHERE universe_id = ?', id);
    await db.runAsync('DELETE FROM universes WHERE id = ?', id);
  });
}
export const newUniverse = (name = 'New world'): Universe => ({ id: newId(), name, description: '', createdAt: now(), updatedAt: now() });

// Species

interface SRow { id: string; universe_id: string; name: string; adulthood: string; notes: string }
const sFrom = (r: SRow): Species => ({ id: r.id, universeId: r.universe_id, name: r.name, adulthood: r.adulthood, notes: r.notes });
export async function listSpecies(db: SQLiteDatabase, universeId?: Id | null): Promise<Species[]> {
  const rows = universeId ? await db.getAllAsync<SRow>('SELECT * FROM species WHERE universe_id = ? ORDER BY name', universeId) : await db.getAllAsync<SRow>('SELECT * FROM species ORDER BY name');
  return rows.map(sFrom);
}
export async function saveSpecies(db: SQLiteDatabase, s: Species): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO species (id, universe_id, name, adulthood, notes) VALUES (?,?,?,?,?)', s.id, s.universeId, s.name, s.adulthood, s.notes);
}
export async function deleteSpecies(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('UPDATE characters SET species_id = NULL WHERE species_id = ?', id);
  await db.runAsync('DELETE FROM species WHERE id = ?', id);
}
export const newSpecies = (universeId: Id): Species => ({ id: newId(), universeId, name: 'New species', adulthood: '', notes: '' });

// Lore

interface LRow { id: string; universe_id: string; title: string; keys_json: string; text: string; always_on: number; priority: number }
const lFrom = (r: LRow): LoreEntry => ({ id: r.id, universeId: r.universe_id, title: r.title, keys: pj(r.keys_json, []), text: r.text, alwaysOn: b(r.always_on), priority: r.priority });
export async function listLore(db: SQLiteDatabase, universeId: Id): Promise<LoreEntry[]> {
  return (await db.getAllAsync<LRow>('SELECT * FROM lore WHERE universe_id = ? ORDER BY priority DESC, title', universeId)).map(lFrom);
}
export async function saveLore(db: SQLiteDatabase, e: LoreEntry): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lore (id, universe_id, title, keys_json, text, always_on, priority) VALUES (?,?,?,?,?,?,?)', e.id, e.universeId, e.title, j(e.keys), e.text, ib(e.alwaysOn), e.priority);
}
export async function deleteLore(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM lore WHERE id = ?', id);
}
export const newLore = (universeId: Id): LoreEntry => ({ id: newId(), universeId, title: 'New entry', keys: [], text: '', alwaysOn: false, priority: 0 });

// Canon

interface CRow { id: string; universe_id: string; session_id: string | null; title: string; text: string; ord: number; created_at: number }
const cFrom = (r: CRow): CanonEvent => ({ id: r.id, universeId: r.universe_id, sessionId: r.session_id, title: r.title, text: r.text, order: r.ord, createdAt: r.created_at });
export async function listCanon(db: SQLiteDatabase, universeId: Id): Promise<CanonEvent[]> {
  return (await db.getAllAsync<CRow>('SELECT * FROM canon WHERE universe_id = ? ORDER BY ord, created_at', universeId)).map(cFrom);
}
export async function saveCanon(db: SQLiteDatabase, c: CanonEvent): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO canon (id, universe_id, session_id, title, text, ord, created_at) VALUES (?,?,?,?,?,?,?)', c.id, c.universeId, c.sessionId, c.title, c.text, c.order, c.createdAt);
}
export async function deleteCanon(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM canon WHERE id = ?', id);
}

// Characters

interface ChRow { id: string; universe_id: string | null; species_id: string | null; name: string; life_stage: string; adult: number; summary: string; voice: string; tells: string; relationships: string; limits: string; preferences: string; created_at: number; updated_at: number }
const chFrom = (r: ChRow): Character => ({ id: r.id, universeId: r.universe_id, speciesId: r.species_id, name: r.name, lifeStage: r.life_stage, adult: b(r.adult), summary: r.summary, voice: r.voice, tells: r.tells, relationships: r.relationships, limits: r.limits, preferences: r.preferences, createdAt: r.created_at, updatedAt: r.updated_at });
export async function listCharacters(db: SQLiteDatabase): Promise<Character[]> {
  return (await db.getAllAsync<ChRow>('SELECT * FROM characters ORDER BY name')).map(chFrom);
}
export async function getCharacters(db: SQLiteDatabase, ids: Id[]): Promise<Character[]> {
  if (!ids.length) return [];
  const rows = await db.getAllAsync<ChRow>(`SELECT * FROM characters WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const m = new Map(rows.map((r) => [r.id, chFrom(r)]));
  return ids.map((i) => m.get(i)).filter((c): c is Character => !!c);
}
export async function saveCharacter(db: SQLiteDatabase, c: Character): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO characters (id, universe_id, species_id, name, life_stage, adult, summary, voice, tells, relationships, limits, preferences, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', c.id, c.universeId, c.speciesId, c.name, c.lifeStage, ib(c.adult), c.summary, c.voice, c.tells, c.relationships, c.limits, c.preferences, c.createdAt, now());
}
export async function deleteCharacter(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM characters WHERE id = ?', id);
}
export const newCharacter = (): Character => ({ id: newId(), universeId: null, speciesId: null, name: 'New character', lifeStage: '', adult: true, summary: '', voice: '', tells: '', relationships: '', limits: '', preferences: '', createdAt: now(), updatedAt: now() });

// Styles

interface StRow { id: string; name: string; pov: string; tense: string; density: string; dialogue: string; register: string; vocabulary: string; influences: string; repetition: string; banned_json: string; samples_json: string; created_at: number; updated_at: number }
const stFrom = (r: StRow): Style => ({ id: r.id, name: r.name, pointOfView: r.pov, tense: r.tense, proseDensity: r.density, dialogueRatio: r.dialogue, register: r.register as Style['register'], vocabulary: r.vocabulary, influences: r.influences ?? '', repetition: (r.repetition as Style['repetition']) || 'light', bannedPhrases: pj(r.banned_json, []), samples: pj(r.samples_json, []), createdAt: r.created_at, updatedAt: r.updated_at });
export async function listStyles(db: SQLiteDatabase): Promise<Style[]> {
  return (await db.getAllAsync<StRow>('SELECT * FROM styles ORDER BY name')).map(stFrom);
}
export async function getStyle(db: SQLiteDatabase, id: Id | null): Promise<Style | null> {
  if (!id) return null;
  const r = await db.getFirstAsync<StRow>('SELECT * FROM styles WHERE id = ?', id);
  return r ? stFrom(r) : null;
}
export async function saveStyle(db: SQLiteDatabase, s: Style): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO styles (id, name, pov, tense, density, dialogue, register, vocabulary, influences, repetition, banned_json, samples_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', s.id, s.name, s.pointOfView, s.tense, s.proseDensity, s.dialogueRatio, s.register, s.vocabulary, s.influences, s.repetition, j(s.bannedPhrases), j(s.samples), s.createdAt, now());
}
export async function deleteStyle(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('UPDATE sessions SET style_id = NULL WHERE style_id = ?', id);
  await db.runAsync('DELETE FROM styles WHERE id = ?', id);
}
export const newStyle = (): Style => ({ id: newId(), name: 'New style', pointOfView: '', tense: '', proseDensity: '', dialogueRatio: '', register: 'blunt', vocabulary: '', influences: '', repetition: 'light', bannedPhrases: [], samples: [], createdAt: now(), updatedAt: now() });

// Presets

interface PRow { id: string; name: string; system: string; prefill: string; post_history: string; overrides_json: string; chain_json: string; system_as_user: number; provider_ignore_json: string; provider_order_json: string; created_at: number; updated_at: number }
const pFrom = (r: PRow): Preset => ({ id: r.id, name: r.name, system: r.system, prefill: r.prefill, postHistory: r.post_history, modelOverrides: pj(r.overrides_json, {}), refusalChain: pj(r.chain_json, []), systemAsUser: b(r.system_as_user), providerIgnore: pj(r.provider_ignore_json, []), providerOrder: pj(r.provider_order_json, []), createdAt: r.created_at, updatedAt: r.updated_at });
export async function listPresets(db: SQLiteDatabase): Promise<Preset[]> {
  return (await db.getAllAsync<PRow>('SELECT * FROM presets ORDER BY name')).map(pFrom);
}
export async function getPreset(db: SQLiteDatabase, id: Id | null): Promise<Preset | null> {
  if (!id) return null;
  const r = await db.getFirstAsync<PRow>('SELECT * FROM presets WHERE id = ?', id);
  return r ? pFrom(r) : null;
}
export async function savePreset(db: SQLiteDatabase, p: Preset): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO presets (id, name, system, prefill, post_history, overrides_json, chain_json, system_as_user, provider_ignore_json, provider_order_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', p.id, p.name, p.system, p.prefill, p.postHistory, j(p.modelOverrides), j(p.refusalChain), ib(p.systemAsUser), j(p.providerIgnore), j(p.providerOrder), p.createdAt, now());
}
export async function deletePreset(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('UPDATE sessions SET preset_id = NULL WHERE preset_id = ?', id);
  await db.runAsync('DELETE FROM presets WHERE id = ?', id);
}
export const newPreset = (): Preset => ({ id: newId(), name: 'New preset', system: '', prefill: '', postHistory: '', modelOverrides: {}, refusalChain: [], systemAsUser: false, providerIgnore: [], providerOrder: [], createdAt: now(), updatedAt: now() });

// Model stats: the refusal ledger

export async function listModelStats(db: SQLiteDatabase): Promise<ModelStat[]> {
  const rows = await db.getAllAsync<{ model: string; attempts: number; refusals: number; last_at: number }>('SELECT * FROM model_stats ORDER BY attempts DESC');
  return rows.map((r) => ({ model: r.model, attempts: r.attempts, refusals: r.refusals, lastAt: r.last_at }));
}
export async function recordAttempt(db: SQLiteDatabase, model: string, refused: boolean): Promise<void> {
  await db.runAsync('INSERT INTO model_stats (model, attempts, refusals, last_at) VALUES (?, 1, ?, ?) ON CONFLICT(model) DO UPDATE SET attempts = attempts + 1, refusals = refusals + excluded.refusals, last_at = excluded.last_at', model, refused ? 1 : 0, now());
}
export async function resetModelStats(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM model_stats');
}

// KV

export async function kvGet(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return r?.value ?? null;
}
export async function kvSet(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
}

// Revisions: history for presets, styles and briefs, so prompt iteration is traceable.

export type RevisionKind = 'preset' | 'style' | 'brief';
export interface Revision { id: Id; kind: RevisionKind; targetId: Id; payload: string; note: string; createdAt: number }

export async function addRevision(db: SQLiteDatabase, kind: RevisionKind, targetId: Id, payload: unknown, note: string): Promise<void> {
  await db.runAsync('INSERT INTO revisions (id, kind, target_id, payload, note, created_at) VALUES (?,?,?,?,?,?)', newId(), kind, targetId, typeof payload === 'string' ? payload : j(payload), note, now());
}
export async function listRevisions(db: SQLiteDatabase, kind: RevisionKind, targetId: Id): Promise<Revision[]> {
  const rows = await db.getAllAsync<{ id: string; kind: string; target_id: string; payload: string; note: string; created_at: number }>('SELECT * FROM revisions WHERE kind = ? AND target_id = ? ORDER BY created_at DESC', kind, targetId);
  return rows.map((r) => ({ id: r.id, kind: r.kind as RevisionKind, targetId: r.target_id, payload: r.payload, note: r.note, createdAt: r.created_at }));
}
