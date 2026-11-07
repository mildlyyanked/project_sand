import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, now } from '@/core/ids';
import { agentPrompt, coverage, dayOf, questionPrompt, type WorkshopMessage } from '@/core/world/agent';
import { knowledge, libraryDrafts, normName, type Draft, type LibKind } from '@/core/world/drafts';
import { worldLine } from '@/core/world/lines';
import { getAgent, listWorkshop, patchAgent, saveWorkshop } from '@/db/repo/agent';
import { useSettings } from './settings';
import { useJobs } from './jobs';
import { loadLibrary } from './library';

/** The model the agent thinks with: the strong editor model when one is set, else the writer. */
export function agentModel(): string {
  const d = useSettings.getState().defaults;
  return d.editorModel || d.models.writer;
}

export interface Focus { kind: LibKind; id: string; name: string }

/**
 * Say something to a world's agent: the message goes in the thread, a reply
 * waits under it, and a job writes the reply in the background with the
 * world, the brief, the conversation and the entry in focus.
 */
export async function askAgent(db: SQLiteDatabase, universeId: string, o: { text: string; focus?: Focus | null; intent?: string; answering?: string }): Promise<{ user: WorkshopMessage; reply: WorkshopMessage }> {
  const [lib, agent, thread] = await Promise.all([loadLibrary(db, universeId), getAgent(db, universeId), listWorkshop(db, universeId, 40)]);
  if (!lib.universe) throw new Error('No such world.');
  const pool = libraryDrafts(lib);
  const others = pool.filter((d) => d.kind !== 'world');
  const focus: Draft | null = o.focus ? pool.find((d) => d.id === o.focus!.id) ?? null : null;
  const user: WorkshopMessage = { id: newId(), universeId, role: 'user', text: o.text.trim(), data: { focus: o.focus ?? null, ...(o.answering ? { question: o.answering } : {}) }, createdAt: now() };
  const reply: WorkshopMessage = { id: newId(), universeId, role: 'agent', text: '', data: {}, createdAt: now() + 1 };
  const messages = agentPrompt({
    world: worldLine(lib.universe), knowledge: knowledge(pool, focus, o.text, 11000), coverage: coverage(others), brief: agent.brief,
    thread: thread.filter((m) => !m.data.error && (m.role === 'user' || m.text)), focus, intent: o.intent, message: o.text, answering: o.answering,
  });
  const job = await (async () => {
    await saveWorkshop(db, user);
    await saveWorkshop(db, reply);
    return useJobs.getState().enqueue(db, 'workshop', {
      universeId, title: o.answering ? `Answer: ${o.answering.slice(0, 60)}` : o.focus ? `${o.focus.name}: ${o.text.slice(0, 60)}` : o.text.slice(0, 70),
      input: { model: agentModel(), messages, replyTo: reply.id, focus: o.focus ?? null, taken: pool.map((d) => `${d.kind}:${normName(d.name)}`), maxTokens: 9000 },
    });
  })();
  const withJob = { ...reply, data: { ...reply.data, jobId: job.id } };
  await saveWorkshop(db, withJob);
  return { user, reply: withJob };
}

/** Ask the agent again for a reply that failed or was cancelled: the same prompt, a fresh job. */
export async function retryReply(db: SQLiteDatabase, m: WorkshopMessage): Promise<void> {
  if (!m.data.jobId) return;
  await useJobs.getState().retry(db, m.data.jobId);
  await saveWorkshop(db, { ...m, data: { ...m.data, error: undefined } });
}

/**
 * Make sure a world has today's question: asked once a day, in the
 * background, the first time anyone looks. Returns whether one is on its way.
 */
export async function ensureTodayQuestion(db: SQLiteDatabase, universeId: string, o: { force?: boolean } = {}): Promise<boolean> {
  const date = dayOf();
  const agent = await getAgent(db, universeId);
  if (!o.force && agent.today?.date === date) return false;
  const jobs = useJobs.getState().jobs;
  if (jobs.some((j) => j.universeId === universeId && j.kind === 'question' && (j.status === 'queued' || j.status === 'running'))) return true;
  if (!o.force && jobs.some((j) => j.universeId === universeId && j.kind === 'question' && j.status === 'failed' && dayOf(j.createdAt) === date && j.attempts >= 1)) return false;
  if (!useSettings.getState().apiKey) return false;
  const [lib, thread] = await Promise.all([loadLibrary(db, universeId), listWorkshop(db, universeId, 12)]);
  if (!lib.universe || lib.universe.isDefault) return false;
  const pool = libraryDrafts(lib);
  const others = pool.filter((d) => d.kind !== 'world');
  const messages = questionPrompt({ world: worldLine(lib.universe), knowledge: knowledge(pool, null, '', 7000), coverage: coverage(others), brief: agent.brief, asked: agent.asked, recent: thread.filter((m) => m.role === 'user').map((m) => m.text) });
  await useJobs.getState().enqueue(db, 'question', { universeId, title: `Today's question for ${lib.universe.name}`, input: { model: agentModel(), messages, date, maxTokens: 1500 } });
  return true;
}

export async function skipQuestion(db: SQLiteDatabase, universeId: string): Promise<void> {
  await patchAgent(db, universeId, (a) => (a.today ? { ...a, today: { ...a.today, skipped: true } } : a));
}

/** Answer today's question: it goes to the agent, who folds it into the world. */
export async function answerQuestion(db: SQLiteDatabase, universeId: string, answer: string): Promise<void> {
  const a = await getAgent(db, universeId);
  if (!a.today) return;
  await patchAgent(db, universeId, (x) => (x.today ? { ...x, today: { ...x.today, answered: true } } : x));
  await askAgent(db, universeId, { text: answer, answering: a.today.question });
}

export async function saveBrief(db: SQLiteDatabase, universeId: string, brief: string): Promise<void> {
  await patchAgent(db, universeId, (a) => ({ ...a, brief }));
}
