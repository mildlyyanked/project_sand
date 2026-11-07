import type { SQLiteDatabase } from 'expo-sqlite';
import type { Id } from '@/core/types';
import type { Job, JobKind, JobStatus } from '@/core/jobs';
import { now } from '@/core/ids';
import { j, pj } from './map';

interface JRow { id: string; universe_id: string | null; kind: string; title: string; status: string; input_json: string; output_json: string | null; error: string | null; attempts: number; progress: number; created_at: number; updated_at: number }
const jFrom = (r: JRow): Job => {
  const out = pj<{ result?: unknown; decisions?: Job['decisions'] } | null>(r.output_json, null);
  return { id: r.id, universeId: r.universe_id, kind: r.kind as JobKind, title: r.title, status: r.status as JobStatus, input: pj(r.input_json, {}) as Job['input'], output: (out?.result ?? null) as Job['output'], decisions: out?.decisions ?? {}, error: r.error, attempts: r.attempts, progress: r.progress, createdAt: r.created_at, updatedAt: r.updated_at };
};

export async function saveJob(db: SQLiteDatabase, x: Job): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO jobs (id, universe_id, kind, title, status, input_json, output_json, error, attempts, progress, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    x.id, x.universeId, x.kind, x.title, x.status, j(x.input), j({ result: x.output, decisions: x.decisions }), x.error, x.attempts, x.progress, x.createdAt, now(),
  );
}

export async function getJob(db: SQLiteDatabase, id: Id): Promise<Job | null> {
  const r = await db.getFirstAsync<JRow>('SELECT * FROM jobs WHERE id = ?', id);
  return r ? jFrom(r) : null;
}

/** Recent jobs, newest first: everything still open, plus the last month of finished ones. */
export async function listJobs(db: SQLiteDatabase): Promise<Job[]> {
  const since = now() - 30 * 24 * 3600 * 1000;
  return (await db.getAllAsync<JRow>("SELECT * FROM jobs WHERE status IN ('queued','running') OR updated_at > ? ORDER BY created_at DESC LIMIT 300", since)).map(jFrom);
}

/** Jobs cut off by the app closing go back in the queue. */
export async function requeueInterrupted(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("UPDATE jobs SET status = 'queued', progress = 0 WHERE status = 'running'");
}

export async function deleteJob(db: SQLiteDatabase, id: Id): Promise<void> {
  await db.runAsync('DELETE FROM jobs WHERE id = ?', id);
}
