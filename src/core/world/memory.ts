import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import { estimateTokens } from '../tokens';
import { normName } from './drafts';
import { namedIn } from './portraits';

/**
 * Instance memory: what a version of a world remembers between its chapters,
 * apart from what is canon in the library. Three kinds of record:
 *
 * - a recap per chapter: what happened, where things were left, what is open;
 * - a record per person: where they stand now, what they know, how they stand
 *   with the others, what has changed about them for good;
 * - instance-only entries: people, places, factions and things a chapter
 *   brought in that are real in this instance but not (yet) canon.
 *
 * A memory keeper writes them at chapter boundaries; the next chapter reads
 * them. Canon stays in the library; this is what only happened here. RN-free.
 */
export interface Recap {
  sessionId: string;
  title: string;
  summary: string;
  /** Where things stand at the chapter's end. */
  ending: string;
  open: string[];
  /** The passage the recap was written up to, so it is known to be stale when the chapter grows. */
  upTo: string | null;
  at: number;
}

export interface Relation { with: string; stance: string }

export interface PersonMemory {
  /** The library character, or 'n:' and the name for someone only this instance knows. */
  key: string;
  name: string;
  libId?: string;
  /** Where they are and what they are doing, as of the latest chapter. */
  now: string;
  /** What they know, newest last. */
  knows: string[];
  relations: Relation[];
  /** Lasting changes: a scar, a title, a loss, a secret now out. */
  changes: string[];
  /** Chapters that touched them. */
  seen: string[];
}

export type EntryKind = 'character' | 'location' | 'organization' | 'item';
export interface InstanceEntry { key: string; kind: EntryKind; name: string; note: string; from: string }

export interface InstanceMemory { recaps: Recap[]; people: PersonMemory[]; entries: InstanceEntry[] }
export const emptyMemory: InstanceMemory = { recaps: [], people: [], entries: [] };

export const personKey = (name: string, libId?: string | null) => (libId ? libId : `n:${normName(name)}`);
export const entryKey = (name: string) => `n:${normName(name)}`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, n) : []);

/** Chapters of an instance in reading order: by when they start in the world, then when they were begun. */
export function chapterOrder<T extends { clockStart: number; createdAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.clockStart - b.clockStart || a.createdAt - b.createdAt);
}

export function keeperPrompt(o: { world: string; instance: string; chapter: { title: string; number: number; text: string }; people: PersonMemory[]; known: string[]; cast: string[] }): ChatMessage[] {
  return [
    { role: 'system', content: [
      `You keep the memory of one version of a story world ("${o.instance}") between its chapters. Read the chapter and record what later chapters must remember: what happened, where it was left, and for each person who matters, where they stand, what they now know, how they stand with the others and what has changed about them for good. Be faithful to the text; never invent. Keep it compact and concrete: names, places, facts, feelings that will matter.`,
      'People: include everyone who did or learned something that matters, the cast first. "knows" is only what they learned in this chapter (a secret, a name, a betrayal they saw); "relations" is how they stand now with someone, replacing what was before; "changes" is only what is lasting. Use the exact names given where they match.',
      'Newcomers: named people, places, factions and things the chapter treats as real that are not among the known names.',
      'Output only JSON: {"recap": {"summary": string (150 to 300 words, what happened, in order), "ending": string (one or two sentences: where things stand at the very end), "open": string[] (unresolved threads, promises, dangers; at most 6)}, "people": [{"name": string, "now": string (where they are and what they are about, one line), "knows": string[], "relations": [{"with": string, "stance": string}], "changes": string[]}], "newcomers": [{"name": string, "kind": "character" | "location" | "organization" | "item", "note": string (one line from the chapter)}]}.',
    ].join('\n\n') },
    { role: 'user', content: [
      o.world,
      o.cast.length ? `The cast: ${o.cast.join(', ')}` : '',
      o.known.length ? `Known names: ${o.known.slice(0, 160).join(', ')}` : '',
      o.people.length ? `# What was remembered before this chapter\n${renderPeopleFull(o.people)}` : '',
      `# Chapter ${o.chapter.number}: ${o.chapter.title}\n${o.chapter.text}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

export interface KeeperReply {
  recap: { summary: string; ending: string; open: string[] };
  people: { name: string; now: string; knows: string[]; relations: Relation[]; changes: string[] }[];
  newcomers: { name: string; kind: EntryKind; note: string }[];
}

const KINDS: EntryKind[] = ['character', 'location', 'organization', 'item'];

export function parseKeeper(text: string): KeeperReply | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const r = j.recap && typeof j.recap === 'object' ? (j.recap as Record<string, unknown>) : {};
  const summary = str(r.summary);
  if (!summary) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  return {
    recap: { summary, ending: str(r.ending), open: strs(r.open, 6) },
    people: list(j.people).map((p) => ({
      name: str(p.name),
      now: str(p.now),
      knows: strs(p.knows, 8),
      relations: list(p.relations).map((x) => ({ with: str(x.with), stance: str(x.stance) })).filter((x) => x.with && x.stance).slice(0, 8),
      changes: strs(p.changes, 6),
    })).filter((p) => p.name).slice(0, 30),
    newcomers: list(j.newcomers).map((n) => ({ name: str(n.name), kind: (KINDS.includes(str(n.kind) as EntryKind) ? str(n.kind) : 'character') as EntryKind, note: str(n.note) })).filter((n) => n.name).slice(0, 20),
  };
}

/**
 * Fold a chapter's updates into what was remembered: "now" moves on, what
 * they know and what changed accumulates (newest kept), a relation replaces
 * the old one with the same person.
 */
export function mergePeople(before: PersonMemory[], updates: KeeperReply['people'], o: { sessionId: string; library: { id: string; name: string }[] }): PersonMemory[] {
  const out = before.map((p) => ({ ...p, knows: [...p.knows], relations: [...p.relations], changes: [...p.changes], seen: [...p.seen] }));
  const libFor = (name: string) => o.library.find((c) => normName(c.name) === normName(name)) ?? o.library.find((c) => namedIn(name, c.name) && name.split(/\s+/).length === 1);
  const uniq = (xs: string[], n: number) => xs.filter((x, i) => xs.findIndex((y) => normName(y) === normName(x)) === i).slice(-n);
  for (const u of updates) {
    const lib = libFor(u.name);
    const key = personKey(lib?.name ?? u.name, lib?.id);
    let p = out.find((x) => x.key === key) ?? out.find((x) => normName(x.name) === normName(u.name));
    if (!p) {
      p = { key, name: lib?.name ?? u.name, ...(lib ? { libId: lib.id } : {}), now: '', knows: [], relations: [], changes: [], seen: [] };
      out.push(p);
    }
    if (u.now) p.now = u.now;
    p.knows = uniq([...p.knows, ...u.knows], 14);
    p.changes = uniq([...p.changes, ...u.changes], 10);
    for (const r of u.relations) p.relations = [...p.relations.filter((x) => normName(x.with) !== normName(r.with)), r].slice(-10);
    if (!p.seen.includes(o.sessionId)) p.seen.push(o.sessionId);
  }
  return out;
}

/** Newcomers that are new to both the library and this instance's memory. */
export function freshEntries(newcomers: KeeperReply['newcomers'], o: { known: string[]; entries: InstanceEntry[]; sessionId: string }): InstanceEntry[] {
  const known = new Set(o.known.map(normName));
  const have = new Set(o.entries.map((e) => e.key));
  const out: InstanceEntry[] = [];
  for (const n of newcomers) {
    const key = entryKey(n.name);
    if (known.has(normName(n.name)) || have.has(key) || out.some((e) => e.key === key)) continue;
    out.push({ key, kind: n.kind, name: n.name, note: n.note, from: o.sessionId });
  }
  return out;
}

function renderPeopleFull(people: PersonMemory[]): string {
  return people.map((p) => [`## ${p.name}`, p.now ? `Now: ${p.now}` : '', p.changes.length ? `For good: ${p.changes.join('; ')}` : '', p.knows.length ? `Knows: ${p.knows.join('; ')}` : '', p.relations.length ? `With others: ${p.relations.map((r) => `${r.with}: ${r.stance}`).join('; ')}` : ''].filter(Boolean).join('\n')).join('\n\n');
}

/** Earlier chapters, for the writer: the latest in full, older ones down to how they ended, within budget. */
export function renderPreviously(recaps: Recap[], budget: number): string {
  if (!recaps.length) return '';
  const head = ['# Previously, in this version of the world', 'Earlier chapters. All of it happened; people remember what they lived through. Do not retell it; build on it.'];
  const blocks: string[] = [];
  let used = estimateTokens(head.join('\n'));
  for (let i = recaps.length - 1; i >= 0; i--) {
    const r = recaps[i]!;
    const latest = i === recaps.length - 1;
    const full = `## ${r.title}\n${r.summary}${r.ending ? `\nIt ended: ${r.ending}` : ''}${latest && r.open.length ? `\nStill open: ${r.open.join('; ')}` : ''}`;
    const short = `## ${r.title}\n${r.ending || r.summary.slice(0, 300)}`;
    const pick = latest || used + estimateTokens(full) < budget * 0.6 ? full : short;
    const cost = estimateTokens(pick);
    if (used + cost > budget) break;
    used += cost;
    blocks.unshift(pick);
  }
  return [...head, ...blocks].join('\n\n');
}

/** The people this passage is about, as this instance remembers them. */
export function renderPeople(people: PersonMemory[], focus: string[], text: string, budget: number): string {
  const wanted = people.filter((p) => focus.some((f) => normName(f) === normName(p.name)) || namedIn(text, p.name));
  if (!wanted.length) return '';
  const head = '# What this version of the world remembers of them\nKeep them consistent with this: what they know, how they stand with each other, what has changed about them. They know only what they lived through or were told.';
  const out: string[] = [head];
  let used = estimateTokens(head);
  for (const p of wanted) {
    const block = renderPeopleFull([p]);
    const cost = estimateTokens(block);
    if (used + cost > budget) break;
    used += cost;
    out.push(block);
  }
  return out.length > 1 ? out.join('\n\n') : '';
}

/** Instance-only people, places and things the passage brings up. */
export function renderEntries(entries: InstanceEntry[], focus: string[], text: string, budget: number): string {
  const wanted = entries.filter((e) => focus.some((f) => normName(f) === normName(e.name)) || namedIn(text, e.name));
  if (!wanted.length) return '';
  const lines = ['# Real in this version of the world (not canon elsewhere)', ...wanted.map((e) => `- ${e.name} (${e.kind}): ${e.note}`)];
  let out = lines.join('\n');
  while (estimateTokens(out) > budget && lines.length > 2) { lines.pop(); out = lines.join('\n'); }
  return out;
}

/** A chapter's text for the keeper: its summary and as much of the end as fits. */
export function chapterText(o: { summary: string; prose: string[]; maxChars?: number }): string {
  const max = o.maxChars ?? 14000;
  const body = o.prose.join('\n\n');
  const tail = body.length > max ? `[…]\n${body.slice(-max)}` : body;
  return [o.summary.trim() ? `(Earlier in this chapter, in brief) ${o.summary.trim()}` : '', tail].filter(Boolean).join('\n\n');
}
