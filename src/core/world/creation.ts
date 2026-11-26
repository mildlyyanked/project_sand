import type { ChatMessage, Id } from '../types';
import { lenientJson } from '../json';
import { coverage } from './agent';
import { KIND_NOUN, draftCard, fieldDef, related, roster, type Draft, type LibKind } from './drafts';
import { forgeLists, overviewMembers, parseForgeDrafts, type ForgeKind } from './forge';

/**
 * Creating a world in stages, one entry on the table at a time.
 *
 * 1. Overview: the world entry itself, workshopped until it is approved.
 * 2. Lore: core pages on the world's systems and basic concepts, written one
 *    by one, each taking every approved page as true, until the foundations
 *    are covered.
 * 3. Entries: what is concrete (places, factions, peoples, characters,
 *    things), one by one, from the large to the small; each is approved,
 *    workshopped or dropped, until the writer concludes.
 *
 * What is approved goes into the library at once, so the next entry is
 * written from the world as it really stands. The session itself is saved
 * after every step and its writing runs in the background queue, so it
 * survives leaving the screen or closing the app. Pure: state/creation.ts
 * runs it.
 */
export type CreationStage = 'overview' | 'lore' | 'entries' | 'done';

export const STAGES: { key: Exclude<CreationStage, 'done'>; label: string; blurb: string }[] = [
  { key: 'overview', label: 'Overview', blurb: 'The world entry everything else is built from.' },
  { key: 'lore', label: 'Lore', blurb: 'Its systems and basic concepts, one page at a time.' },
  { key: 'entries', label: 'World', blurb: 'Places, factions, peoples, characters and things, from the large to the small.' },
];

export interface CreationLog {
  /** The entry's id in the library when it was approved. */
  id: Id;
  kind: LibKind;
  name: string;
  /** A line about it: what was approved, or what was turned down. */
  line: string;
  decision: 'approved' | 'dropped';
  stage: CreationStage;
  at: number;
}

export interface Creation {
  id: Id;
  /** The world being built, once its overview is approved. */
  universeId: Id | null;
  /** The world's name, for lists. */
  name: string;
  stage: CreationStage;
  /** What the writer asked for at the start. */
  wish: string;
  model: string;
  /** The entry on the table: only one at a time. */
  pending: Draft | null;
  /** The model's line on why this entry, now. */
  why: string;
  /** What the model would write after this one: ways to steer. */
  then: string[];
  /** Earlier versions of the entry on the table, oldest first, so a rework can be undone. */
  versions: Draft[];
  /** The model judges this stage covered. */
  enough: boolean;
  /** The job writing, or that wrote, what is on the table. */
  jobId: Id | null;
  /** What was approved and what was dropped, oldest first. */
  log: CreationLog[];
  createdAt: number;
  updatedAt: number;
}

export function newCreation(o: { id: Id; model: string; now: number; wish?: string; universeId?: Id | null; name?: string; stage?: CreationStage }): Creation {
  return { id: o.id, universeId: o.universeId ?? null, name: o.name ?? '', stage: o.stage ?? 'overview', wish: o.wish ?? '', model: o.model, pending: null, why: '', then: [], versions: [], enough: false, jobId: null, log: [], createdAt: o.now, updatedAt: o.now };
}

/** A line about an entry, for the log and for lists. */
export function lineOf(d: Draft, max = 140): string {
  const f = d.fields;
  const s = ['summary', 'description', 'text', 'nature', 'appearance'].map((k) => (typeof f[k] === 'string' ? (f[k] as string).trim() : '')).find(Boolean) ?? '';
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export const approvedIn = (c: Creation, stage: CreationStage) => c.log.filter((x) => x.decision === 'approved' && x.stage === stage);

// ---------------------------------------------------------------------------
// What the model reads

/**
 * The world as the next entry must take it: the overview in full, every
 * lore page in full (they are the foundations; trimmed evenly only when
 * there are very many), a roster of everything concrete, and in full the
 * entries that bear on what is asked, then the newest, within a budget.
 */
export function creationKnowledge(pool: Draft[], o: { extra?: string; order?: Id[]; loreBudget?: number; cardBudget?: number } = {}): string {
  const at = (id: Id) => { const i = (o.order ?? []).indexOf(id); return i < 0 ? -1 : i; };
  const world = pool.find((d) => d.kind === 'world');
  const parts: string[] = [];
  if (world) parts.push(`# The world: ${world.name}\n${draftCard(world, { maxField: 2600 }).split('\n').slice(1).join('\n')}`);
  const lore = pool.filter((d) => d.kind === 'lore').sort((a, b) => at(a.id) - at(b.id));
  if (lore.length) {
    const room = o.loreBudget ?? 14000;
    const whole = lore.map((d) => draftCard(d));
    const cards = whole.join('\n\n').length > room ? lore.map((d) => draftCard(d, { maxField: Math.max(400, Math.floor(room / lore.length) - 120) })) : whole;
    parts.push(`# Core lore, settled (${lore.length} ${lore.length === 1 ? 'page' : 'pages'}, in the order they were written)\n${cards.join('\n\n')}`);
  }
  const rest = pool.filter((d) => d.kind !== 'world' && d.kind !== 'lore');
  if (rest.length) {
    parts.push(`# Already in this world\n${roster(rest, 4000)}`);
    const newest = [...rest].sort((a, b) => at(b.id) - at(a.id));
    const seen = new Set<Id>();
    const cards: string[] = [];
    let used = 0;
    for (const d of [...related(null, rest, o.extra ?? ''), ...newest]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const c = draftCard(d, { maxField: 500 });
      if (used + c.length > (o.cardBudget ?? 8000)) continue;
      cards.push(c);
      used += c.length;
    }
    if (cards.length) parts.push(`# In full\n${cards.join('\n\n')}`);
  }
  return parts.join('\n\n');
}

/** What the writer turned down, so it is not offered again. */
export function turnedDown(log: CreationLog[], stage?: CreationStage): string {
  const d = log.filter((x) => x.decision === 'dropped' && (!stage || x.stage === stage)).slice(-24);
  if (!d.length) return '';
  return `# Turned down\nThe writer did not want these. Do not offer them again, or anything close to them:\n${d.map((x) => `- ${KIND_NOUN[x.kind]}: ${x.name}${x.line ? ` — ${x.line}` : ''}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// Prompts

const QUOTES = 'Inside string values quote with single quotes, never bare double quotes.';
const CRAFT = "Write with the specificity of a good novelist, not a catalogue: concrete over adjectives, causes and costs over mood, the word people there actually use for it.";

/** An overview says more than a world card in a batch: it is all the later stages have to go on. */
const OVERVIEW_HINTS: Record<string, string> = {
  description: 'the premise in 150 to 260 words: where and when this is, what governs life there, what is strange or particular about it, what is at stake, the texture a writer needs to set a first scene',
  genre: 'one line: the kind of story and how it should feel',
  rules: '80 to 170 words: what is possible here that is not elsewhere (magic, technology, physics), its limits and what it costs; for a world like ours, how it differs from ours',
  society: '80 to 170 words: who holds power and how, how ordinary people live, what they fear, what is taboo',
  themes: 'one line',
  currency: 'what people pay with, in a few words',
};

/** A core lore page is a system explained, not a note. */
const LORE_HINTS: Record<string, string> = {
  text: '150 to 320 words a writer can use directly: how it works, what it costs or demands, who controls it, how it shows in ordinary life, and what people get wrong about it',
};

const OVERVIEW_SHAPE = () => `{${overviewMembers(OVERVIEW_HINTS)}}`;
const HEAD = (what: string) => `"why": string (one line to the writer: why this ${what}, now), "then": string[] (${what === 'page' ? 'the subjects still to cover after this one, most needed first' : 'what you would write after this one'}, at most 4, a few words each; empty when nothing is left)`;

/** Stage one: the world entry everything else is built from. */
export function overviewPrompt(o: { wish: string }): ChatMessage[] {
  const wish = o.wish.trim();
  return [
    { role: 'system', content: [
      "You begin a new world for a fiction writer's library by writing its overview: the one entry everything else will be built from. After it come the world's core lore pages, and then its places, factions, peoples and people, each written one at a time from this overview. So the overview carries the premise and the logic of the world, not its inventory: name no more places, factions or persons than the premise cannot be stated without.",
      `Everything is invented fiction for an adult author. ${CRAFT} Give the world one strange particular that makes it unlike its neighbours, and leave room in it: tensions that are not resolved, questions the later pages will answer.`,
      'Give it a calendar that suits it (real dates for a world like ours, its own reckoning otherwise) and a style bible for its pictures.',
      `Output only JSON of this shape: ${OVERVIEW_SHAPE()}. ${QUOTES}`,
    ].join('\n\n') },
    { role: 'user', content: wish ? `What I want: ${wish}` : 'No wish: surprise me with a world worth setting stories in. Pass over the first idea that comes to mind.' },
  ];
}

/** Stage two: the next core lore page, or word that the foundations are covered. */
export function lorePrompt(o: { knowledge: string; log: CreationLog[]; steer?: string; more?: boolean }): ChatMessage[] {
  const steer = o.steer?.trim() ?? '';
  return [
    { role: 'system', content: [
      'You are building a world with a fiction writer, one entry at a time. Its overview is settled. Now come its core lore pages: the systems and basic concepts everything concrete will stand on. How its magic, technology or strangeness works; its cosmology or faith; the history that still presses on the present; how power, law, money, class, travel and daily life work. Concepts and systems only: a page is never about one place, one faction, one people or one person (those come in the next stage, built on these pages, and may be named here only in passing).',
      `Write the one page the world most needs next, beginning with what the rest depends on. The overview and every page settled so far are true: build on them, use their terms, never contradict them, never repeat them. ${CRAFT}`,
      'Judge whether the foundations are covered: they are when a writer could set a scene anywhere in this world without having to invent how the world works. Most worlds need three to seven pages; a world close to ours needs fewer. When they are covered and the writer has not asked for a page, set "done" to true and leave "lore" empty.',
      `Output only JSON: {${HEAD('page')}, "done": boolean, ${forgeLists('lore', LORE_HINTS)} (exactly one page, or none when done)}. ${QUOTES}`,
    ].join('\n\n') },
    { role: 'user', content: [o.knowledge, turnedDown(o.log, 'lore'), steer ? `What I want next: ${steer}` : o.more ? 'Write one more page: the foundations are not covered enough for me yet.' : 'Write the next page, or tell me the foundations are covered.'].filter(Boolean).join('\n\n') },
  ];
}

const KIND_ASK: Partial<Record<ForgeKind, string>> = { location: 'a place', organization: 'a faction', species: 'a people', character: 'a character', item: 'a thing', lore: 'a lore page' };

/** Stage three: the next concrete entry, from the large to the small. */
export function entryPrompt(o: { knowledge: string; pool: Draft[]; log: CreationLog[]; steer?: string; kind?: Exclude<ForgeKind, 'world'> }): ChatMessage[] {
  const steer = o.steer?.trim() ?? '';
  const kind = o.kind ?? 'mixed';
  return [
    { role: 'system', content: [
      'You are building a world with a fiction writer, one entry at a time. Its overview and its core lore are settled. Now the world is filled in with what is concrete: places, factions, peoples, characters, things.',
      'Write the one entry the world most needs next, working from the large to the small. First what frames everything: its peoples (only if the world calls for them), its great regions and realms, the powers that contend for it. Then what sits inside those: cities and strongholds, institutions, the rivals and branches of its powers. Then districts and single sites. Then the people a story could turn on: rulers, rivals, the ones caught between. Then the things worth an entry. Look at what is already in the world before you choose: do not go down a level while the level above is thin, and do not pile entries into one corner of the world while another stands empty. When the writer asks for something, write that.',
      "The overview, the lore and every entry so far are true: stay consistent with them, use their terms, never repeat a name or an idea already there. When a field names another entry (within, home, faction, leader, headquarters, owner, species...), use the exact name of an entry that already exists; what does not exist yet belongs in the text, not in such a field. Tie the new entry to what exists wherever it makes the world denser: a place sits inside another or is held by someone, a person belongs somewhere, a thing has an owner or a home.",
      `The entry is a whole page of the library: fill every field that applies. ${CRAFT} One strange, memorable particular. A character must be someone a scene could turn on: a want, a flaw, a way of speaking that is theirs alone, and a name unlike the names already there.`,
      kind !== 'mixed' ? `The writer asked for ${KIND_ASK[kind]}: write that kind.` : 'Choose the kind yourself. A lore page only when the writer asks for one.',
      `Output only JSON: {${HEAD('entry')}, ${forgeLists(kind)}}, with exactly one entry${kind === 'mixed' ? ' in exactly one list; leave the other lists out' : ''}. ${QUOTES}`,
    ].join('\n\n') },
    { role: 'user', content: [o.knowledge, `# Where the world stands\n${coverage(o.pool)}`, turnedDown(o.log), steer ? `What I want next: ${steer}` : 'Write the next entry.'].filter(Boolean).join('\n\n') },
  ];
}

/** Workshop the entry on the table: the whole entry again, changed as asked. */
export function revisePrompt(o: { draft: Draft; instruction: string; knowledge: string }): ChatMessage[] {
  const d = o.draft;
  const shape = d.kind === 'world' ? OVERVIEW_SHAPE() : `{${forgeLists(d.kind as Exclude<LibKind, 'world'>, d.kind === 'lore' ? LORE_HINTS : {})}}`;
  const extra = d.kind === 'world' ? [d.fields.art ? `Style bible: ${JSON.stringify(d.fields.art)}` : '', d.fields.calendar ? `Calendar: ${JSON.stringify(d.fields.calendar)}` : ''].filter(Boolean).join('\n') : '';
  return [
    { role: 'system', content: [
      `You revise one entry of a world a fiction writer is building, as they ask: ${d.kind === 'world' ? "the world's overview, the entry everything else is built from" : `a ${KIND_NOUN[d.kind].toLowerCase()}${d.kind === 'lore' ? ' page' : ''}`}. Return the whole entry in the same shape. Change what the instruction asks for and carry the change through every field it touches; keep the rest, word for word where it still holds. Stay consistent with the world as it stands. ${CRAFT}`,
      `Output only JSON of this shape: ${shape}${d.kind === 'world' ? '' : ', with exactly one entry'}. ${QUOTES}`,
    ].join('\n\n') },
    { role: 'user', content: [o.knowledge, `# The entry as it stands\n${draftCard(d)}${extra ? `\n${extra}` : ''}`, `What should change: ${o.instruction.trim() || 'make it stronger: more specific, stranger, more useful to a writer.'}`].filter(Boolean).join('\n\n') },
  ];
}

// ---------------------------------------------------------------------------
// Replies

export type CreateMode = 'overview' | 'lore' | 'entry' | 'revise';

export interface CreateReply {
  draft: Draft | null;
  why: string;
  then: string[];
  /** The model judges the stage covered and wrote nothing. */
  done: boolean;
}

/** What a rework did not send back but the entry had: fields the model is never asked for. */
function carried(base: Draft, next: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base.fields)) {
    if (k in next.fields) continue;
    const def = fieldDef(base.kind, k);
    if (!def || def.forge === false || def.type === 'ties') out[k] = v;
  }
  return out;
}

/** A reply of any stage: the entry it wrote (a rework keeps the entry's identity), and what it said about it. Null when nothing can be read. */
export function parseCreateReply(mode: CreateMode, kind: ForgeKind, text: string, base?: Draft | null): CreateReply | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const then = (Array.isArray(j.then) ? j.then : []).map(s).filter(Boolean).slice(0, 4);
  const first = parseForgeDrafts(kind, text)?.[0] ?? null;
  let draft = first && (kind === 'world' ? first.kind === 'world' : first.kind !== 'world') ? first : null;
  if (mode === 'revise') {
    if (!draft || !base || draft.kind !== base.kind) return null;
    draft = { ...draft, id: base.id, existing: base.existing, fields: { ...carried(base, draft), ...draft.fields } };
  }
  return { draft, why: s(j.why), then, done: j.done === true && !draft };
}

/** A fair reply budget per kind of entry: a character has many fields, a thing few. */
export function createBudget(kind: ForgeKind): number {
  return kind === 'world' ? 9000 : kind === 'lore' ? 5000 : kind === 'character' || kind === 'mixed' ? 8000 : 6000;
}

// ---------------------------------------------------------------------------
// The session, step by step

const clearTable = (c: Creation): Creation => ({ ...c, pending: null, versions: [], why: '', enough: false });

/** A reply has come in: it goes on the table. A rework replaces what was there and keeps the old version. */
export function landed(c: Creation, mode: CreateMode, r: CreateReply, now: number): Creation {
  if (mode === 'revise') return r.draft && c.pending ? { ...c, versions: [...c.versions, c.pending].slice(-6), pending: r.draft, updatedAt: now } : c;
  return { ...c, pending: r.draft, versions: [], why: r.why, then: r.then, enough: r.done, name: c.stage === 'overview' && r.draft ? r.draft.name : c.name, updatedAt: now };
}

/** The entry on the table was approved (as `draft`, with any edits) or dropped. Approving the overview opens the lore stage. */
export function decided(c: Creation, draft: Draft, decision: CreationLog['decision'], now: number): Creation {
  const log: CreationLog[] = [...c.log, { id: draft.id, kind: draft.kind, name: draft.name, line: lineOf(draft), decision, stage: c.stage, at: now }];
  const next = { ...clearTable(c), log, updatedAt: now };
  if (c.stage === 'overview' && decision === 'approved') return { ...next, stage: 'lore', universeId: draft.id, name: draft.name, then: [] };
  return next;
}

/** Enough lore: on to what is concrete. */
export const movedOn = (c: Creation, now: number): Creation => (c.stage === 'lore' ? { ...clearTable(c), stage: 'entries', then: [], updatedAt: now } : c);

/** The writer concludes: the world is a world like any other. */
export const concluded = (c: Creation, now: number): Creation => ({ ...clearTable(c), stage: 'done', then: [], jobId: null, updatedAt: now });

/** Back into a concluded session, to add more. */
export const reopened = (c: Creation, now: number): Creation => (c.stage === 'done' ? { ...c, stage: 'entries', updatedAt: now } : c);

/** Take back the last rework. */
export function undone(c: Creation, now: number): Creation {
  const prev = c.versions[c.versions.length - 1];
  return prev ? { ...c, pending: prev, versions: c.versions.slice(0, -1), updatedAt: now } : c;
}

/** Where a session stands, in a line, for lists. */
export function creationStatus(c: Creation, job?: { status: string } | null): string {
  const busy = job?.status === 'queued' || job?.status === 'running';
  const lore = approvedIn(c, 'lore').length;
  const entries = approvedIn(c, 'entries').length;
  const what = c.stage === 'overview' ? 'the overview' : c.stage === 'lore' ? 'a lore page' : 'an entry';
  if (c.stage === 'done') return `Concluded · ${lore} lore, ${entries} entries`;
  const have = c.stage === 'overview' ? '' : c.stage === 'lore' ? `${lore} lore ${lore === 1 ? 'page' : 'pages'} · ` : `${lore} lore, ${entries} ${entries === 1 ? 'entry' : 'entries'} · `;
  if (busy) return `${have}writing ${what}…`;
  if (job?.status === 'failed') return `${have}${what} failed: open to try again`;
  if (c.pending) return `${have}${c.pending.name} waits for you`;
  if (c.enough) return `${have}the foundations look covered`;
  return `${have}ready for ${what}`;
}
