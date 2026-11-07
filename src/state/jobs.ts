import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, now } from '@/core/ids';
import { awaiting, finishBible, finishForge, finishHear, finishInspire, finishReforge, finishVoice, type BibleInput, type InspireInput, type ForgeInput, type Job, type JobIO, type JobKind, type QuestionInput, type ReforgeInput, type WorkshopInput, type WorkshopOutput } from '@/core/jobs';
import { changeDrafts, parseAgentReply, parseQuestion, removing, retconChanges, type AgentRemove, type AgentRevise } from '@/core/world/agent';
import { affected, mergeEdits, parseRetcon, renameEdits, retconPrompt } from '@/core/world/retcon';
import { knowledge, libraryDrafts, normName, type Draft } from '@/core/world/drafts';
import { getJob, listJobs, requeueInterrupted, saveJob } from '@/db/repo/jobs';
import { getWorkshopMessage, patchAgent, saveWorkshop } from '@/db/repo/agent';
import { complete } from './paint';
import { runInForeground } from './foreground';
import { loadLibrary } from './library';

/**
 * The background queue for library work. Jobs are saved before they run and
 * after every change, so they survive the screen that asked for them and
 * the app itself: on start, anything cut off goes back in the queue. Two run
 * at a time (a quick question never waits behind a whole world), each kept
 * alive on Android by the foreground service while the app is in the
 * background. Results wait, undecided, until someone accepts or dismisses them.
 */
const CONCURRENCY = 2;
const TEMPERATURE: Record<JobKind, number> = { forge: 0.9, reforge: 0.85, bible: 0.6, workshop: 0.8, question: 0.95, inspire: 0.85, voice: 0.7, hear: 0.9 };

interface JobsState {
  jobs: Job[];
  /** Characters received, per running job; kept out of the database. */
  live: Record<string, number>;
  started: boolean;
  start(db: SQLiteDatabase): Promise<void>;
  refresh(db: SQLiteDatabase): Promise<void>;
  enqueue<K extends JobKind>(db: SQLiteDatabase, kind: K, o: { universeId: string | null; title: string; input: JobIO[K][0] }): Promise<Job<K>>;
  cancel(db: SQLiteDatabase, id: string): Promise<void>;
  retry(db: SQLiteDatabase, id: string): Promise<void>;
  /** Record a decision on one proposal of a job ('all' for jobs with one result). */
  decide(db: SQLiteDatabase, id: string, key: string, decision: 'accepted' | 'dismissed'): Promise<void>;
  /** Dismiss everything still undecided in a job. */
  dismissAll(db: SQLiteDatabase, id: string): Promise<void>;
}

const controllers = new Map<string, AbortController>();
let pumping = 0;

export const useJobs = create<JobsState>((set, get) => {
  const put = (j: Job) => set((s) => ({ jobs: s.jobs.some((x) => x.id === j.id) ? s.jobs.map((x) => (x.id === j.id ? j : x)) : [j, ...s.jobs] }));
  const write = async (db: SQLiteDatabase, j: Job) => { put(j); await saveJob(db, j); };

  async function run(db: SQLiteDatabase, job: Job): Promise<void> {
    const ac = new AbortController();
    controllers.set(job.id, ac);
    let j: Job = { ...job, status: 'running', error: null, updatedAt: now() };
    await write(db, j);
    let last = 0;
    try {
      const input = j.input as { model: string; messages: Parameters<typeof complete>[0]['messages']; maxTokens?: number };
      const { text, finish, thoughtOnly } = await runInForeground(j.title, () => complete({
        model: input.model, messages: input.messages, maxTokens: input.maxTokens ?? 4000, temperature: TEMPERATURE[j.kind], signal: ac.signal,
        onText: (n) => { if (n - last > 200) { last = n; set((s) => ({ live: { ...s.live, [job.id]: n } })); } },
        spend: { db, note: `${j.kind}: ${j.title}` },
      }));
      if (ac.signal.aborted) return;
      let output: unknown;
      try {
        output = await finishJob(db, j, text, finish);
      } catch (e) {
        // Thinking with no answer reads as nonsense to a parser: say what actually happened.
        if (thoughtOnly) throw new Error(`${input.model} spent its whole reply budget thinking and wrote no answer, even with a larger budget. Try again, or pick a model that does not think for the helper (Settings → Models).`);
        throw e;
      }
      j = { ...j, status: 'done', output: output as Job['output'], progress: text.length, updatedAt: now() };
      await write(db, j);
    } catch (e) {
      const cancelled = ac.signal.aborted;
      j = { ...j, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : e instanceof Error ? e.message : String(e), updatedAt: now() };
      await write(db, j);
      if (!cancelled) await failJob(db, j);
    } finally {
      controllers.delete(job.id);
      set((s) => { const live = { ...s.live }; delete live[job.id]; return { live }; });
    }
  }

  function pump(db: SQLiteDatabase) {
    while (pumping < CONCURRENCY) {
      const next = [...get().jobs].filter((x) => x.status === 'queued' && !controllers.has(x.id)).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!next) return;
      pumping++;
      controllers.set(next.id, new AbortController());
      void run(db, next).finally(() => { pumping--; pump(db); });
    }
  }

  return {
    jobs: [],
    live: {},
    started: false,
    async start(db) {
      if (get().started) return;
      set({ started: true });
      await requeueInterrupted(db);
      set({ jobs: await listJobs(db) });
      pump(db);
    },
    async refresh(db) {
      const fresh = await listJobs(db);
      // Running jobs are the runner's to report; the database lags them.
      set((s) => ({ jobs: fresh.map((f) => s.jobs.find((x) => x.id === f.id && x.status === 'running') ?? f) }));
    },
    async enqueue(db, kind, o) {
      const j: Job = { id: newId(), universeId: o.universeId, kind, title: o.title, status: 'queued', input: o.input, output: null, decisions: {}, error: null, attempts: 0, progress: 0, createdAt: now(), updatedAt: now() };
      await write(db, j);
      pump(db);
      return j as Job<typeof kind>;
    },
    async cancel(db, id) {
      const j = get().jobs.find((x) => x.id === id) ?? (await getJob(db, id));
      if (!j) return;
      controllers.get(id)?.abort();
      if (j.status === 'queued' || j.status === 'running') await write(db, { ...j, status: 'cancelled', updatedAt: now() });
    },
    async retry(db, id) {
      const j = get().jobs.find((x) => x.id === id) ?? (await getJob(db, id));
      if (!j || j.status === 'running' || j.status === 'queued') return;
      await write(db, { ...j, status: 'queued', error: null, output: null, decisions: {}, attempts: j.attempts + 1, updatedAt: now() });
      pump(db);
    },
    async decide(db, id, key, decision) {
      const j = get().jobs.find((x) => x.id === id) ?? (await getJob(db, id));
      if (!j) return;
      await write(db, { ...j, decisions: { ...j.decisions, [key]: decision }, updatedAt: now() });
    },
    async dismissAll(db, id) {
      const j = get().jobs.find((x) => x.id === id) ?? (await getJob(db, id));
      if (!j?.output) return;
      const keys = j.kind === 'forge' || j.kind === 'workshop' || j.kind === 'inspire' ? (j.output as { drafts: { id: string }[] }).drafts.map((d) => d.id) : ['all'];
      const decisions = { ...j.decisions };
      for (const k of keys) if (!decisions[k]) decisions[k] = 'dismissed';
      await write(db, { ...j, decisions, updatedAt: now() });
    },
  };
});

/** Turn a finished reply into the job's output, and do what else it implies (a thread message, the agent's state). */
async function finishJob(db: SQLiteDatabase, j: Job, text: string, finish?: string): Promise<unknown> {
  switch (j.kind) {
    case 'forge': return finishForge(j.input as ForgeInput, text, finish);
    case 'reforge': return finishReforge(j.input as ReforgeInput, text);
    case 'bible': return finishBible(j.input as BibleInput, text);
    case 'inspire': return finishInspire(j.input as InspireInput, text);
    case 'voice': return finishVoice(text);
    case 'hear': return finishHear(text);
    case 'question': {
      const q = parseQuestion(text);
      if (!q) throw new Error('The agent did not come up with a question. Try again.');
      const date = (j.input as QuestionInput).date;
      if (j.universeId) await patchAgent(db, j.universeId, (a) => ({ ...a, today: { date, question: q.question, why: q.why, about: q.about, answered: false }, asked: [...a.asked, q.question].slice(-60) }));
      return q;
    }
    case 'workshop': {
      const input = j.input as WorkshopInput;
      const r = parseAgentReply(text);
      if (!r.reply && !r.drafts.length && !r.changes.length && !r.revise.length && !r.remove.length) throw new Error('The agent said nothing. Try again, or another model.');
      const lib = await loadLibrary(db, j.universeId);
      const pool = libraryDrafts(lib);
      const taken = new Set(pool.map((d) => `${d.kind}:${normName(d.name)}`));
      const reworked = await reworkDrafts(db, input.model, pool, r.revise, r.remove);
      const reworkedIds = new Set(reworked.map((d) => d.id));
      const drafts = [...r.drafts.filter((d) => !taken.has(`${d.kind}:${normName(d.name)}`)), ...changeDrafts(pool, r.changes).filter((d) => !reworkedIds.has(d.id)), ...reworked];
      if (r.brief && j.universeId) await patchAgent(db, j.universeId, (a) => ({ ...a, brief: r.brief! }));
      const m = await getWorkshopMessage(db, input.replyTo);
      if (m) await saveWorkshop(db, { ...m, text: r.reply, data: { ...m.data, drafts, briefChanged: !!r.brief, error: undefined } });
      const out: WorkshopOutput = { reply: r.reply, drafts, brief: r.brief };
      return out;
    }
  }
}

const findEntry = (pool: Draft[], name: string) => pool.find((d) => d.kind !== 'world' && normName(d.name) === normName(name));

/**
 * What the agent wants reworked or removed, carried through the world the
 * way Retcon does: a rename rewrites every mention by rule, and the writer
 * model rewrites whatever else the change makes untrue. Removing an entry
 * proposes its removal, and rewrites every entry that mentions it so it no
 * longer exists there. Each touched entry becomes one change to accept.
 */
async function reworkDrafts(db: SQLiteDatabase, model: string, pool: Draft[], revise: AgentRevise[], remove: AgentRemove[]): Promise<Draft[]> {
  let out: Draft[] = [];
  const retcon = async (target: Draft, change: string, renameTo?: string, gone = false) => {
    const mech = renameTo ? renameEdits(pool, target, renameTo) : [];
    const others = pool.filter((d) => d.id !== target.id && d.kind !== 'world');
    const messages = retconPrompt({ target, change, renameTo, affected: affected(others, target, change), knowledge: knowledge(others, target, change, 5000) });
    const { text } = await complete({ model, messages, maxTokens: 12000, temperature: 0.4, spend: { db, note: `${gone ? 'remove' : 'rework'} ${target.name}` } });
    const edits = mergeEdits(mech, parseRetcon(text, pool)).filter((e) => !gone || e.id !== target.id);
    out = retconChanges(pool, edits, gone ? `Because ${target.name} is gone` : `Because ${target.name} was reworked`, out);
  };
  for (const x of remove) {
    const target = findEntry(pool, x.entry);
    if (!target) continue;
    out = [...out.filter((d) => d.id !== target.id), { ...target, existing: true, fields: { ...target.fields, _remove: true, _why: x.why } }];
    await retcon(target, `${target.name} is removed from the world${x.why ? ` (${x.why})` : ''}. Rewrite every other entry that mentions it or points at it so that it no longer exists there: drop it, or put something that fits in its place. Clear reference fields that point at it. Do not edit ${target.name} itself.`, undefined, true);
  }
  for (const x of revise) {
    const target = findEntry(pool, x.entry);
    if (!target || out.some((d) => d.id === target.id && removing(d))) continue;
    const to = x.rename && normName(x.rename) !== normName(target.name) ? x.rename : undefined;
    await retcon(target, x.change || `${target.name} is renamed to ${to}.`, to);
  }
  return out;
}

async function failJob(db: SQLiteDatabase, j: Job): Promise<void> {
  if (j.kind !== 'workshop') return;
  const m = await getWorkshopMessage(db, (j.input as WorkshopInput).replyTo);
  if (m) await saveWorkshop(db, { ...m, data: { ...m.data, error: j.error ?? 'The reply failed.' } });
}

/** Jobs of a world still waiting on a decision, newest first. */
export const inboxOf = (jobs: Job[], universeId: string | null | undefined) => jobs.filter((j) => j.universeId === universeId && awaiting(j));
