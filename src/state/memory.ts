import type { SQLiteDatabase } from 'expo-sqlite';
import type { Beat, Session, Universe } from '@/core/types';
import type { WorldEvent } from '@/core/world/types';
import { indexBeats, pathTo } from '@/core/beatTree';
import { chapterOrder, chapterText, freshEntries, keeperPrompt, mergePeople, parseKeeper, renderEntries, renderPeople, renderPreviously, type InstanceEntry, type InstanceMemory, type Recap } from '@/core/world/memory';
import { newId, now } from '@/core/ids';
import { clockAt } from '@/core/world/timeline';
import { blankSession, listBeats, listSessions, upsertSession } from '@/db/repo/sessions';
import { getUniverse, listCharacters, listLore, listSpecies, newLore, saveLore } from '@/db/repo/library';
import { getInstance, instanceClock, listEntities } from '@/db/repo/world';
import { deleteEntry, loadMemory, savePerson, saveRecap, saveEntry } from '@/db/repo/memory';
import { helperJson } from './world';

/**
 * Chapters and their memory. A world's instance is a run of chapters (the
 * stories set in it, in the order they start in the world). Between
 * chapters a memory keeper writes what the instance must remember: a recap
 * of the chapter, what each person now knows and how they stand, and the
 * people, places and things the chapter made real here. The next chapter
 * reads it back. Never for the real world: it has no instances to remember.
 */
export async function memoryApplies(db: SQLiteDatabase, s: Pick<Session, 'universeId' | 'instanceId' | 'isTemplate'>): Promise<boolean> {
  if (!s.universeId || !s.instanceId || s.isTemplate) return false;
  const u = await getUniverse(db, s.universeId);
  return !!u && !u.isDefault;
}

export async function chaptersOf(db: SQLiteDatabase, instanceId: string): Promise<Session[]> {
  return chapterOrder((await listSessions(db)).filter((x) => x.instanceId === instanceId && !x.isTemplate));
}

async function proseOf(db: SQLiteDatabase, s: Session): Promise<Beat[]> {
  const beats = await listBeats(db, s.id);
  return pathTo(indexBeats(beats), s.currentBeatId);
}

/** Chapters with passages their recap has not caught up with. */
export async function staleChapters(db: SQLiteDatabase, instanceId: string, except?: string): Promise<Session[]> {
  const [chapters, mem] = await Promise.all([chaptersOf(db, instanceId), loadMemory(db, instanceId)]);
  return chapters.filter((c) => c.id !== except && c.currentBeatId && mem.recaps.find((r) => r.sessionId === c.id)?.upTo !== c.currentBeatId);
}

function worldLine(u: Universe | null): string {
  if (!u) return '';
  return [`World: ${u.name}`, u.description, u.data.genre && `Genre: ${u.data.genre}`, u.data.tone && `Tone: ${u.data.tone}`].filter(Boolean).join('\n');
}

/**
 * Write a chapter into its instance's memory: one helper call. Returns the
 * recap and the newcomers it kept as instance-only, or null when there is
 * nothing to remember yet.
 */
export async function keepChapter(db: SQLiteDatabase, s: Session, o: { apiKey: string; signal?: AbortSignal }): Promise<{ recap: Recap; fresh: InstanceEntry[] } | null> {
  if (!(await memoryApplies(db, s)) || !s.instanceId) return null;
  const path = await proseOf(db, s);
  const prose = path.filter((b) => b.role === 'prose').map((b) => b.text);
  if (!prose.length) return null;
  const [universe, instance, chapters, mem, chars, entities, species, lore] = await Promise.all([
    getUniverse(db, s.universeId!), getInstance(db, s.instanceId), chaptersOf(db, s.instanceId), loadMemory(db, s.instanceId), listCharacters(db), listEntities(db, s.universeId!), listSpecies(db, s.universeId!), listLore(db, s.universeId!),
  ]);
  const library = chars.filter((c) => c.universeId === s.universeId || c.universeId == null);
  const known = [...library.map((c) => c.name), ...entities.map((e) => e.name), ...species.map((x) => x.name), ...lore.map((l) => l.title), ...mem.entries.map((e) => e.name)];
  const cast = library.filter((c) => s.characterIds.includes(c.id) || c.id === s.pov?.characterId).map((c) => c.name);
  const number = chapters.findIndex((c) => c.id === s.id) + 1;
  const text = await helperJson({
    apiKey: o.apiKey, model: s.models.helper, zdr: s.zdr, signal: o.signal, maxTokens: 4000,
    messages: keeperPrompt({ world: worldLine(universe), instance: instance?.name ?? 'this instance', chapter: { title: s.title, number: number || 1, text: chapterText({ summary: s.summary, prose }) }, people: mem.people, known, cast }),
  });
  const r = parseKeeper(text);
  if (!r) throw new Error('The memory keeper could not read that chapter. Try again, or another helper model.');
  const recap: Recap = { sessionId: s.id, title: number ? `Chapter ${number}: ${s.title}` : s.title, summary: r.recap.summary, ending: r.recap.ending, open: r.recap.open, upTo: s.currentBeatId, at: clockAt(path, s.clockStart) };
  const people = mergePeople(mem.people, r.people, { sessionId: s.id, library: library.map((c) => ({ id: c.id, name: c.name })) });
  const fresh = freshEntries(r.newcomers, { known, entries: mem.entries, sessionId: s.id });
  await db.withTransactionAsync(async () => {
    await saveRecap(db, s.instanceId!, recap);
    for (const p of people) await savePerson(db, s.instanceId!, p);
    for (const e of fresh) await saveEntry(db, s.instanceId!, e);
  });
  return { recap, fresh };
}

/** What a chapter reads of its instance's memory: earlier chapters, the people in it, what is real only here. */
export async function memoryContext(db: SQLiteDatabase, s: Session, o: { focus: string[]; text: string }): Promise<{ previously: string; people: string; entries: string; recapped: Set<string> } | null> {
  if (!(await memoryApplies(db, s)) || !s.instanceId) return null;
  const [mem, chapters] = await Promise.all([loadMemory(db, s.instanceId), chaptersOf(db, s.instanceId)]);
  if (!mem.recaps.length && !mem.people.length && !mem.entries.length) return null;
  const mine = chapters.findIndex((c) => c.id === s.id);
  const before = new Set(chapters.slice(0, mine < 0 ? chapters.length : mine).map((c) => c.id));
  const order = new Map(chapters.map((c, i) => [c.id, i]));
  const recaps = mem.recaps.filter((r) => before.has(r.sessionId)).sort((a, b) => (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0));
  return {
    previously: renderPreviously(recaps, 1800),
    people: renderPeople(mem.people, o.focus, o.text, 1500),
    entries: renderEntries(mem.entries, o.focus, o.text, 600),
    recapped: new Set(mem.recaps.map((r) => r.sessionId)),
  };
}

/**
 * The next chapter in an instance: earlier chapters are written into memory
 * first, then a story starts where the instance's clock stands, with the
 * last chapter's voice, models and cast.
 */
export async function newChapter(db: SQLiteDatabase, instanceId: string, o: { apiKey: string; signal?: AbortSignal; title?: string; onKeeping?: (title: string) => void }): Promise<Session> {
  const inst = await getInstance(db, instanceId);
  if (!inst) throw new Error('No such instance.');
  const chapters = await chaptersOf(db, instanceId);
  const last = chapters[chapters.length - 1];
  if (o.apiKey) for (const c of await staleChapters(db, instanceId)) { o.onKeeping?.(c.title); await keepChapter(db, c, o); }
  const clock = await instanceClock(db, instanceId);
  const s = blankSession({
    ...(last ? { models: last.models, styleId: last.styleId, characterIds: last.characterIds, params: last.params, strategy: last.strategy, zdr: last.zdr, explicit: last.explicit, heat: last.heat, planFirst: last.planFirst } : { models: { writer: '', summarizer: '', helper: '' } }),
    id: newId(), title: o.title?.trim() || `Chapter ${chapters.length + 1}`, universeId: inst.universeId, instanceId, mode: 'writer', world: { continuity: true, chronicle: true }, clockStart: clock, createdAt: now(), updatedAt: now(),
  });
  await upsertSession(db, s);
  return s;
}

/** A timeline event made canon: it becomes world lore, true in every instance. */
export async function canonizeEvent(db: SQLiteDatabase, universeId: string, e: WorldEvent): Promise<void> {
  await saveLore(db, { ...newLore(universeId), title: e.title.slice(0, 80), text: e.text || e.title, category: 'history', keys: e.entities.map((x) => x.name.toLowerCase()).filter(Boolean).slice(0, 6) });
}

/** An instance-only entry, gone from memory once it is canon (or dropped). */
export async function dropEntry(db: SQLiteDatabase, instanceId: string, key: string): Promise<void> {
  await deleteEntry(db, instanceId, key);
}

export type { InstanceMemory };
