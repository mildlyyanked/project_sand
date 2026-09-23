import type { SQLiteDatabase } from 'expo-sqlite';
import type { Beat, Id, Session } from '@/core/types';
import { DEFAULT_PARAMS, DEFAULT_STRATEGY } from '@/core/types';
import { newId, now } from '@/core/ids';
import { b, ib, j, pj } from './map';

interface Row {
  id: string; title: string; universe_id: string | null; style_id: string | null; preset_id: string | null; character_ids_json: string; models_json: string; params_json: string; strategy_json: string;
  zdr: number; explicit: number; heat: number; current_beat_id: string | null; summary: string; summary_upto: string | null; variant_of: string | null; variant_note: string; is_template: number; brief: string; plan_first: number; created_at: number; updated_at: number;
}

function fromRow(r: Row): Session {
  return {
    id: r.id, title: r.title, universeId: r.universe_id, styleId: r.style_id, presetId: r.preset_id, characterIds: pj(r.character_ids_json, []),
    models: pj(r.models_json, { writer: '', summarizer: '', helper: '' }), params: { ...DEFAULT_PARAMS, ...pj(r.params_json, {}) }, strategy: { ...DEFAULT_STRATEGY, ...pj(r.strategy_json, {}) },
    zdr: b(r.zdr), explicit: b(r.explicit), heat: r.heat, currentBeatId: r.current_beat_id, summary: r.summary, summaryUpToBeatId: r.summary_upto,
    variantOf: r.variant_of, variantNote: r.variant_note, isTemplate: b(r.is_template), brief: r.brief ?? '', planFirst: r.plan_first == null ? true : b(r.plan_first), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const COLS = 'id, title, universe_id, style_id, preset_id, character_ids_json, models_json, params_json, strategy_json, zdr, explicit, heat, current_beat_id, summary, summary_upto, variant_of, variant_note, is_template, brief, plan_first, created_at, updated_at';
const vals = (s: Session) => [s.id, s.title, s.universeId, s.styleId, s.presetId, j(s.characterIds), j(s.models), j(s.params), j(s.strategy), ib(s.zdr), ib(s.explicit), s.heat, s.currentBeatId, s.summary, s.summaryUpToBeatId, s.variantOf, s.variantNote, ib(s.isTemplate), s.brief, ib(s.planFirst), s.createdAt, s.updatedAt];

export async function listSessions(db: SQLiteDatabase, opts: { templates?: boolean } = {}): Promise<Session[]> {
  const rows = await db.getAllAsync<Row>(`SELECT ${COLS} FROM sessions WHERE is_template = ? ORDER BY updated_at DESC`, ib(!!opts.templates));
  return rows.map(fromRow);
}

export async function getSession(db: SQLiteDatabase, id: Id): Promise<Session | null> {
  const r = await db.getFirstAsync<Row>(`SELECT ${COLS} FROM sessions WHERE id = ?`, id);
  return r ? fromRow(r) : null;
}

export async function upsertSession(db: SQLiteDatabase, s: Session): Promise<void> {
  const q = COLS.split(', ').map(() => '?').join(', ');
  await db.runAsync(`INSERT OR REPLACE INTO sessions (${COLS}) VALUES (${q})`, ...vals(s));
}

export async function patchSession(db: SQLiteDatabase, id: Id, patch: Partial<Session>): Promise<Session | null> {
  const cur = await getSession(db, id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: now() };
  await upsertSession(db, next);
  return next;
}

export async function deleteSession(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM beats WHERE session_id = ?', id);
    await db.runAsync('DELETE FROM sessions WHERE id = ?', id);
  });
}

export function blankSession(p: Partial<Session> & { models: Session['models'] }): Session {
  const t = now();
  return {
    id: newId(), title: 'Untitled', universeId: null, styleId: null, presetId: null, characterIds: [], params: DEFAULT_PARAMS, strategy: DEFAULT_STRATEGY,
    zdr: false, explicit: false, heat: 2, currentBeatId: null, summary: '', summaryUpToBeatId: null, variantOf: null, variantNote: '', isTemplate: false, brief: '', planFirst: true, createdAt: t, updatedAt: t, ...p,
  };
}

/** Copy a session. `withBeats=false` makes a template-like empty copy. */
export async function copySession(db: SQLiteDatabase, id: Id, o: { title: string; withBeats: boolean; isTemplate?: boolean; variantNote?: string }): Promise<Session | null> {
  const src = await getSession(db, id);
  if (!src) return null;
  const t = now();
  const copy: Session = { ...src, id: newId(), title: o.title, isTemplate: !!o.isTemplate, createdAt: t, updatedAt: t, variantOf: o.variantNote !== undefined ? id : null, variantNote: o.variantNote ?? '' };
  if (!o.withBeats) {
    copy.currentBeatId = null;
    copy.summary = '';
    copy.summaryUpToBeatId = null;
  }
  await db.withTransactionAsync(async () => {
    if (o.withBeats) {
      const beats = await listBeats(db, id);
      const idMap = new Map<string, string>();
      for (const bt of beats) idMap.set(bt.id, newId());
      for (const bt of beats) {
        const nb: Beat = { ...bt, id: idMap.get(bt.id)!, sessionId: copy.id, parentId: bt.parentId ? idMap.get(bt.parentId) ?? null : null };
        await insertBeat(db, nb);
      }
      copy.currentBeatId = src.currentBeatId ? idMap.get(src.currentBeatId) ?? null : null;
      copy.summaryUpToBeatId = src.summaryUpToBeatId ? idMap.get(src.summaryUpToBeatId) ?? null : null;
    }
    await upsertSession(db, copy);
  });
  return copy;
}

// Beats

interface BeatRow { id: string; session_id: string; parent_id: string | null; role: string; text: string; model: string | null; direction: string | null; reasoning: string | null; plan: string | null; prompt_tokens: number | null; completion_tokens: number | null; cost_usd: number | null; created_at: number }

const beatFromRow = (r: BeatRow): Beat => ({ id: r.id, sessionId: r.session_id, parentId: r.parent_id, role: r.role as Beat['role'], text: r.text, model: r.model, direction: r.direction, reasoning: r.reasoning, plan: r.plan ?? null, promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens, costUsd: r.cost_usd, createdAt: r.created_at });

export async function listBeats(db: SQLiteDatabase, sessionId: Id): Promise<Beat[]> {
  const rows = await db.getAllAsync<BeatRow>('SELECT * FROM beats WHERE session_id = ? ORDER BY created_at ASC', sessionId);
  return rows.map(beatFromRow);
}

export async function insertBeat(db: SQLiteDatabase, bt: Beat): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO beats (id, session_id, parent_id, role, text, model, direction, reasoning, plan, prompt_tokens, completion_tokens, cost_usd, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', bt.id, bt.sessionId, bt.parentId, bt.role, bt.text, bt.model, bt.direction, bt.reasoning, bt.plan, bt.promptTokens, bt.completionTokens, bt.costUsd, bt.createdAt);
}

export async function updateBeatText(db: SQLiteDatabase, id: Id, text: string): Promise<void> {
  await db.runAsync('UPDATE beats SET text = ? WHERE id = ?', text, id);
}

export async function deleteBeats(db: SQLiteDatabase, ids: Id[]): Promise<void> {
  if (!ids.length) return;
  await db.runAsync(`DELETE FROM beats WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export function makeBeat(p: Partial<Beat> & { sessionId: Id; parentId: Id | null; role: Beat['role']; text: string }): Beat {
  return { id: newId(), model: null, direction: null, reasoning: null, plan: null, promptTokens: null, completionTokens: null, costUsd: null, createdAt: now(), ...p };
}

export async function sessionStats(db: SQLiteDatabase, sessionId: Id): Promise<{ beats: number; cost: number; words: number }> {
  const r = await db.getFirstAsync<{ n: number; cost: number | null }>('SELECT COUNT(*) as n, SUM(cost_usd) as cost FROM beats WHERE session_id = ?', sessionId);
  const rows = await db.getAllAsync<{ text: string }>("SELECT text FROM beats WHERE session_id = ? AND role = 'prose'", sessionId);
  const words = rows.reduce((n, x) => n + x.text.split(/\s+/).filter(Boolean).length, 0);
  return { beats: r?.n ?? 0, cost: r?.cost ?? 0, words };
}
