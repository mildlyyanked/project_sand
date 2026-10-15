import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, now } from '@/core/ids';

/** Spend outside writer passages. Pictures are 'image'; Forge, reforge, retcon and picture prompts are 'library'. */
export type SpendKind = 'image' | 'library';

export interface SpendEntry { kind: SpendKind; model: string; sessionId?: string | null; costUsd: number | null; promptTokens?: number | null; completionTokens?: number | null; note?: string }

export async function recordSpend(db: SQLiteDatabase, e: SpendEntry): Promise<void> {
  try {
    await db.runAsync('INSERT INTO spend (id, kind, model, session_id, cost_usd, prompt_tokens, completion_tokens, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)', newId(), e.kind, e.model, e.sessionId ?? null, e.costUsd, e.promptTokens ?? null, e.completionTokens ?? null, e.note ?? '', now());
  } catch {
    // Bookkeeping never breaks the work it records.
  }
}

export interface SpendStats {
  byKind: { kind: SpendKind; requests: number; costUsd: number; unpriced: number }[];
  byModel: { kind: SpendKind; model: string; requests: number; costUsd: number }[];
  byDay: { day: string; requests: number; costUsd: number }[];
  bySession: { sessionId: string; requests: number; costUsd: number }[];
}

export async function spendStats(db: SQLiteDatabase): Promise<SpendStats> {
  const byKind = (await db.getAllAsync<{ kind: SpendKind; n: number; cost: number | null; unpriced: number }>('SELECT kind, COUNT(*) as n, SUM(cost_usd) as cost, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) as unpriced FROM spend GROUP BY kind')).map((r) => ({ kind: r.kind, requests: r.n, costUsd: r.cost ?? 0, unpriced: r.unpriced }));
  const byModel = (await db.getAllAsync<{ kind: SpendKind; model: string; n: number; cost: number | null }>('SELECT kind, model, COUNT(*) as n, SUM(cost_usd) as cost FROM spend GROUP BY kind, model ORDER BY cost DESC, n DESC')).map((r) => ({ kind: r.kind, model: r.model, requests: r.n, costUsd: r.cost ?? 0 }));
  const byDay = (await db.getAllAsync<{ day: string; n: number; cost: number | null }>("SELECT date(created_at / 1000, 'unixepoch', 'localtime') as day, COUNT(*) as n, SUM(cost_usd) as cost FROM spend GROUP BY day ORDER BY day DESC LIMIT 30")).map((r) => ({ day: r.day, requests: r.n, costUsd: r.cost ?? 0 }));
  const bySession = (await db.getAllAsync<{ session_id: string; n: number; cost: number | null }>('SELECT session_id, COUNT(*) as n, SUM(cost_usd) as cost FROM spend WHERE session_id IS NOT NULL GROUP BY session_id')).map((r) => ({ sessionId: r.session_id, requests: r.n, costUsd: r.cost ?? 0 }));
  return { byKind, byModel, byDay, bySession };
}
