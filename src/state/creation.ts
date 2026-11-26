import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, now } from '@/core/ids';
import type { CreateInput } from '@/core/jobs';
import { concluded, createBudget, creationKnowledge, decided, entryPrompt, lorePrompt, movedOn, newCreation, overviewPrompt, reopened, revisePrompt, undone, type CreateMode, type Creation } from '@/core/world/creation';
import { libraryDrafts, normName, type Draft, type Plan } from '@/core/world/drafts';
import type { ForgeKind } from '@/core/world/forge';
import { creationOf, deleteCreation, getCreation, saveCreation } from '@/db/repo/creation';
import { getUniverse } from '@/db/repo/library';
import { useJobs } from './jobs';
import { loadLibrary, saveDrafts } from './library';
import { useSettings } from './settings';

/**
 * Running a world creation session: every step reads the session as saved,
 * changes it, saves it, and (where the step calls for writing) queues one
 * background job whose result lands back in the session. So the screen is
 * only a view of it: leave, close the app, come back, and it is where it was
 * or further along.
 */
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function fresh(db: SQLiteDatabase, id: string): Promise<Creation> {
  const c = await getCreation(db, id);
  if (!c) throw new Error('This creation session is gone.');
  return c;
}

/** Stop whatever is being written for the table. */
async function stopJob(db: SQLiteDatabase, c: Creation): Promise<void> {
  const j = c.jobId ? useJobs.getState().jobs.find((x) => x.id === c.jobId) : null;
  if (j && (j.status === 'queued' || j.status === 'running')) await useJobs.getState().cancel(db, j.id);
}

/** Queue the writing of what comes next (or a rework), from the world as it stands now. */
async function write(db: SQLiteDatabase, c: Creation, mode: CreateMode, o: { steer?: string; more?: boolean; kind?: Exclude<ForgeKind, 'world'>; instruction?: string; base?: Draft } = {}): Promise<Creation> {
  if (!useSettings.getState().apiKey) throw new Error('Add your OpenRouter key in Settings first.');
  await stopJob(db, c);
  const lib = c.universeId ? await loadLibrary(db, c.universeId) : null;
  const pool = lib ? libraryDrafts(lib) : [];
  const order = c.log.filter((x) => x.decision === 'approved').map((x) => x.id);
  const world = c.name || 'the world';
  let kind: ForgeKind;
  let messages: CreateInput['messages'];
  let title: string;
  if (mode === 'overview') {
    kind = 'world';
    messages = overviewPrompt({ wish: c.wish });
    title = c.wish.trim() ? `World overview: ${short(c.wish.trim())}` : 'World overview';
  } else if (mode === 'lore') {
    kind = 'lore';
    messages = lorePrompt({ knowledge: creationKnowledge(pool, { extra: o.steer, order }), log: c.log, steer: o.steer, more: o.more });
    title = `Lore page for ${world}${o.steer?.trim() ? `: ${short(o.steer.trim(), 40)}` : ''}`;
  } else if (mode === 'entry') {
    kind = o.kind ?? 'mixed';
    messages = entryPrompt({ knowledge: creationKnowledge(pool, { extra: o.steer, order }), pool, log: c.log, steer: o.steer, kind: o.kind });
    title = `Next entry for ${world}${o.steer?.trim() ? `: ${short(o.steer.trim(), 40)}` : ''}`;
  } else {
    const base = o.base ?? c.pending;
    if (!base) throw new Error('There is nothing on the table to rework.');
    kind = base.kind;
    messages = revisePrompt({ draft: base, instruction: o.instruction ?? '', knowledge: creationKnowledge(pool.filter((d) => d.id !== base.id), { extra: `${base.name} ${o.instruction ?? ''}`, order }) });
    title = `Rework ${base.name}`;
    c = { ...c, pending: base };
  }
  const input: CreateInput = { model: c.model, messages, maxTokens: createBudget(kind), creationId: c.id, mode, kind, base: mode === 'revise' ? c.pending : null, taken: pool.map((d) => `${d.kind}:${normName(d.name)}`) };
  const j = await useJobs.getState().enqueue(db, 'create', { universeId: c.universeId, title, input });
  const next = { ...c, jobId: j.id, updatedAt: now() };
  await saveCreation(db, next);
  return next;
}

const nextMode = (c: Creation): CreateMode => (c.stage === 'overview' ? 'overview' : c.stage === 'lore' ? 'lore' : 'entry');

/** Begin a new world from a wish (or none): the session is saved, and its overview is being written. */
export async function startCreation(db: SQLiteDatabase, o: { wish: string; model: string }): Promise<Creation> {
  if (!useSettings.getState().apiKey) throw new Error('Add your OpenRouter key in Settings first.');
  const c = newCreation({ id: newId(), wish: o.wish.trim(), model: o.model, now: now() });
  await saveCreation(db, c);
  return write(db, c, 'overview');
}

/**
 * Take an existing world through the stages: back into the session that
 * built it, or a new one that starts at its lore (or at its entries when it
 * already has lore to stand on).
 */
export async function buildOn(db: SQLiteDatabase, universeId: string): Promise<Creation> {
  const was = await creationOf(db, universeId);
  if (was) {
    if (was.stage !== 'done') return was;
    const c = reopened(was, now());
    await saveCreation(db, c);
    return c;
  }
  const [u, lib] = await Promise.all([getUniverse(db, universeId), loadLibrary(db, universeId)]);
  const c = newCreation({ id: newId(), model: useSettings.getState().defaults.models.writer, now: now(), universeId, name: u?.name ?? '', stage: lib.lore.length >= 3 ? 'entries' : 'lore' });
  await saveCreation(db, c);
  return c;
}

/** Write what comes next for the stage: nothing is on the table, or what is there is being replaced. */
export async function writeNext(db: SQLiteDatabase, id: string, o: { steer?: string; more?: boolean; kind?: Exclude<ForgeKind, 'world'> } = {}): Promise<Creation> {
  const c = await fresh(db, id);
  if (c.stage === 'done') return c;
  return write(db, { ...c, pending: null, versions: [], enough: false }, nextMode(c), o);
}

/** Start the overview over, from another wish. */
export async function rewish(db: SQLiteDatabase, id: string, wish: string): Promise<Creation> {
  const c = await fresh(db, id);
  if (c.stage !== 'overview') return c;
  return write(db, { ...c, wish: wish.trim(), pending: null, versions: [] }, 'overview');
}

/** Workshop the entry on the table: the model rewrites it as asked. `draft` carries any edits made by hand. */
export async function rework(db: SQLiteDatabase, id: string, draft: Draft, instruction: string): Promise<Creation> {
  const c = await fresh(db, id);
  return write(db, c, 'revise', { base: draft, instruction });
}

/** Keep edits made by hand to the entry on the table. */
export async function keepEdits(db: SQLiteDatabase, id: string, draft: Draft): Promise<Creation> {
  const c = await fresh(db, id);
  if (!c.pending || c.pending.id !== draft.id) return c;
  const next = { ...c, pending: draft, name: c.stage === 'overview' ? draft.name : c.name, updatedAt: now() };
  await saveCreation(db, next);
  return next;
}

export async function undoRework(db: SQLiteDatabase, id: string): Promise<Creation> {
  const c = undone(await fresh(db, id), now());
  await saveCreation(db, c);
  return c;
}

/**
 * Approve the entry on the table: it goes into the library (the overview
 * becomes the world), and the next one starts being written. With
 * `andMoveOn`, an approved lore page also ends the lore stage.
 */
export async function approve(db: SQLiteDatabase, id: string, draft: Draft, o: { steer?: string; kind?: Exclude<ForgeKind, 'world'>; andMoveOn?: boolean; andConclude?: boolean } = {}): Promise<{ creation: Creation; plan: Plan }> {
  const c = await fresh(db, id);
  if (!c.pending || c.pending.id !== draft.id) throw new Error('That entry is no longer on the table.');
  if (!draft.name.trim()) throw new Error('Give it a name first.');
  const plan = await saveDrafts(db, [draft], c.stage === 'overview' ? null : c.universeId);
  let next = decided(c, draft, 'approved', now());
  if (o.andMoveOn) next = movedOn(next, now());
  if (o.andConclude) next = concluded(next, now());
  await saveCreation(db, next);
  if (next.stage === 'done') return { creation: next, plan };
  // The next one is written at once, so it is waiting when the writer looks again. A missing key or a full queue never undoes the approval.
  try { next = await write(db, next, nextMode(next), { steer: o.steer, kind: next.stage === 'entries' && !o.andMoveOn ? o.kind : undefined }); } catch { /* the screen offers to write it */ }
  return { creation: next, plan };
}

/** Drop the entry on the table: it is noted, so it is not offered again, and the next one is written. */
export async function drop(db: SQLiteDatabase, id: string, o: { steer?: string; kind?: Exclude<ForgeKind, 'world'>; andMoveOn?: boolean; andConclude?: boolean } = {}): Promise<Creation> {
  const c = await fresh(db, id);
  let next = c.pending ? decided(c, c.pending, 'dropped', now()) : c;
  if (o.andMoveOn) next = movedOn(next, now());
  if (o.andConclude) { await stopJob(db, c); next = concluded(next, now()); }
  await saveCreation(db, next);
  if (next.stage === 'done') return next;
  try { next = await write(db, next, nextMode(next), { steer: o.steer, kind: next.stage === 'entries' && !o.andMoveOn ? o.kind : undefined }); } catch { /* the screen offers to write it */ }
  return next;
}

/** Enough lore, with nothing on the table: on to what is concrete. */
export async function moveOn(db: SQLiteDatabase, id: string): Promise<Creation> {
  const c = await fresh(db, id);
  await stopJob(db, c);
  let next = movedOn(c, now());
  await saveCreation(db, next);
  try { next = await write(db, next, 'entry'); } catch { /* the screen offers to write it */ }
  return next;
}

/** Conclude with nothing on the table. */
export async function conclude(db: SQLiteDatabase, id: string): Promise<Creation> {
  const c = await fresh(db, id);
  await stopJob(db, c);
  const next = concluded(c, now());
  await saveCreation(db, next);
  return next;
}

/** Forget a session. A world it already made stays, with everything approved into it. */
export async function abandon(db: SQLiteDatabase, id: string): Promise<void> {
  const c = await getCreation(db, id);
  if (c) await stopJob(db, c);
  await deleteCreation(db, id);
}

export async function setCreationModel(db: SQLiteDatabase, id: string, model: string): Promise<Creation> {
  const c = { ...(await fresh(db, id)), model };
  await saveCreation(db, c);
  return c;
}
