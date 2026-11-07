import type { ChatMessage, Id } from '../types';
import { lenientJson } from '../json';
import { DRAFT_FIELDS, KIND_NOUN, KIND_NOUN_PLURAL, draftCard, hooks, normName, type Draft, type LibKind } from './drafts';
import { forgeShape, parseForgeDrafts } from './forge';

/**
 * Each world has an agent: a curious co-author that owns its forging. It
 * keeps a brief of what the writer wants for the world, reads what the world
 * already holds (so it never repeats itself), talks things through, and
 * proposes entries and changes for the writer to accept. It also asks one
 * question a day, aimed at what the world is thinnest on, and folds the
 * answer back in. Pure: prompts and parsing; state/agent.ts runs it.
 */
export interface AgentState {
  /** What the writer wants for this world: vision, must-haves, what to avoid, open questions. The agent keeps it; the writer can edit it. */
  brief: string;
  /** Today's question, once asked. */
  today: TodayQuestion | null;
  /** Questions already asked, newest last: never asked twice. */
  asked: string[];
}

export interface TodayQuestion {
  /** Local date, YYYY-MM-DD. */
  date: string;
  question: string;
  /** One line: what an answer would unlock. */
  why: string;
  /** The entry or theme it is about. */
  about: string;
  answered: boolean;
  skipped?: boolean;
}

export const EMPTY_AGENT: AgentState = { brief: '', today: null, asked: [] };

export interface WorkshopMessage {
  id: Id;
  universeId: Id;
  role: 'user' | 'agent';
  text: string;
  data: {
    /** The job writing this reply, while it runs. */
    jobId?: Id;
    /** An agent reply's proposals: new entries and changes to existing ones. Decided through the job. */
    drafts?: Draft[];
    /** What the conversation is about, when it was opened from an entry. */
    focus?: { kind: LibKind; id: Id; name: string } | null;
    /** A user message that answers a question of the day. */
    question?: string;
    /** The agent's reply failed. */
    error?: string;
    /** The brief changed with this reply. */
    briefChanged?: boolean;
  };
  createdAt: number;
}

// ---------------------------------------------------------------------------
// What the world has, and what it lacks

const MAJOR: Partial<Record<LibKind, string[]>> = {
  location: ['description', 'life', 'dangers'],
  organization: ['description', 'aims', 'leader', 'headquarters'],
  character: ['appearance', 'personality', 'drives', 'voice'],
  species: ['appearance', 'nature', 'culture'],
  item: ['description', 'powers'],
  lore: ['text'],
};

/**
 * Coverage in a few lines: how much of each kind there is, what is missing
 * altogether, which entries are thin, and the loose threads. The agent reads
 * it to aim its questions and proposals where the world needs them, and to
 * see what is already done.
 */
export function coverage(pool: Draft[]): string {
  const kinds: LibKind[] = ['location', 'organization', 'character', 'species', 'item', 'lore'];
  const counts = kinds.map((k) => [k, pool.filter((d) => d.kind === k).length] as const);
  const lines = [`Counts: ${counts.map(([k, n]) => `${n} ${KIND_NOUN_PLURAL[k].toLowerCase()}`).join(', ')}.`];
  const none = counts.filter(([k, n]) => !n && k !== 'species').map(([k]) => KIND_NOUN_PLURAL[k].toLowerCase());
  if (none.length) lines.push(`Nothing yet: ${none.join(', ')}.`);
  const thin = pool.filter((d) => MAJOR[d.kind]).map((d) => ({ d, missing: MAJOR[d.kind]!.filter((k) => !String(d.fields[k] ?? '').trim()) })).filter((x) => x.missing.length >= 2);
  if (thin.length) lines.push(`Thin entries: ${thin.slice(0, 10).map((x) => `${x.d.name} (no ${x.missing.map((k) => DRAFT_FIELDS[x.d.kind].find((f) => f.key === k)?.label.toLowerCase() ?? k).join(', ')})`).join('; ')}.`);
  const tied = new Set<string>();
  for (const d of pool) for (const t of Array.isArray(d.fields.ties) ? (d.fields.ties as { to: string }[]) : []) { tied.add(normName(d.name)); tied.add(normName(t.to)); }
  const lonely = pool.filter((d) => (d.kind === 'character' || d.kind === 'organization') && !tied.has(normName(d.name)) && !d.fields.faction && !d.fields.leader);
  if (lonely.length) lines.push(`Tied to no one: ${lonely.slice(0, 8).map((d) => d.name).join(', ')}.`);
  const h = hooks(pool, 6);
  if (h.length) lines.push(`Loose threads: ${h.join(' ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The conversation

const PERSONA = [
  "You are this world's keeper and co-author: a curious, generous, sharp collaborator helping a fiction writer build it. You love the world already and want to know more about it. You think like a novelist and a historian: causes, costs, who benefits, what it smells like, what people say about it when no one important is listening.",
  'How you work:',
  '- Listen first. Build on what the writer says; never steamroll it. When they are vague, offer two or three concrete, contrasting options and ask which feels right.',
  '- Ask at most two questions at a time, and make them good ones: specific, answerable in a few sentences, aimed at what would make stories happen.',
  '- Know the world. Everything already in it is below: stay consistent, never contradict it, never propose a name or an idea it already has, and never repeat yourself. Point out a contradiction or a gap when you see one.',
  '- Keep the brief: what the writer wants this world to be, the things they love, what to avoid, decisions made, questions still open. Update it when the conversation reveals something new; keep it short, plain and in their terms.',
  '- Propose entries when the conversation has earned them, not every turn: new ones, or changes to existing ones that fold in what was just decided. Proposals are suggestions; the writer accepts or dismisses each.',
  '- Be warm and brief. No flattery, no lists of everything you could do. Under 180 words of conversation.',
].join('\n');

const FORMAT = (shape: string) => [
  'Answer in two parts.',
  'First, your reply to the writer, in plain prose (no headings, no JSON).',
  'Then, only if you have proposals or the brief changed, one fenced ```json block:',
  `{"brief": string (the whole updated brief; leave out if unchanged), "proposals": ${shape}, "changes": [{"entry": string (an existing entry by exact name), "field": string (one of its field keys, listed below), "value": string (the whole new value of that field)}]}`,
  'Leave out "proposals" or "changes" when you have none. Inside string values quote with single quotes, never bare double quotes.',
].join('\n');

/** Field keys the agent may change on existing entries, per kind. */
function changeableFields(): string {
  const kinds: LibKind[] = ['location', 'organization', 'character', 'species', 'item', 'lore'];
  return kinds.map((k) => `${KIND_NOUN[k]}: ${DRAFT_FIELDS[k].filter((f) => f.type === 'text' || f.type === 'long').map((f) => f.key).join(', ')}`).join('\n');
}

export interface AgentTurn {
  world: string;
  /** World card, roster and relevant entries: from `knowledge`. */
  knowledge: string;
  coverage: string;
  brief: string;
  /** The conversation so far, oldest first. */
  thread: Pick<WorkshopMessage, 'role' | 'text' | 'data'>[];
  /** The entry the conversation is about, when opened from one. */
  focus?: Draft | null;
  /** What the writer wants from the focus, when opened from a forge point: "places inside", "people in their life". */
  intent?: string;
  /** The writer's message now. */
  message: string;
  /** The question of the day this message answers. */
  answering?: string;
}

export function agentPrompt(o: AgentTurn): ChatMessage[] {
  const system = [
    PERSONA,
    FORMAT(forgeShape('mixed')),
    `Fields you may change on existing entries:\n${changeableFields()}`,
  ].join('\n\n');
  const context = [
    `# The world: ${o.world}`,
    o.brief.trim() ? `# The brief (what the writer wants)\n${o.brief.trim()}` : '# The brief\nEmpty so far: start one as soon as you learn what the writer wants.',
    o.knowledge,
    `# Coverage\n${o.coverage}`,
    o.focus ? `# We are working on\n${draftCard(o.focus, { maxField: 900 })}${o.intent ? `\n\nThe writer wants: ${o.intent}. Tie whatever you propose to ${o.focus.name}.` : ''}` : '',
  ].filter(Boolean).join('\n\n');
  const thread: ChatMessage[] = o.thread.slice(-12).map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.role === 'agent' && m.data.drafts?.length ? `${m.text}\n\n(Proposed: ${m.data.drafts.map((d) => d.name).join(', ')})` : m.data.question ? `Answering “${m.data.question}”: ${m.text}` : m.text }));
  const now = o.answering
    ? `Today's question was: “${o.answering}”\nMy answer: ${o.message}\n\nFold the answer into the world: change the entries it touches, propose what it implies, update the brief if it says what I want, and ask a follow-up only if it is worth it.`
    : o.message;
  return [{ role: 'system', content: system }, { role: 'user', content: context }, { role: 'assistant', content: 'I have read the world, the brief and where it is thin.' }, ...thread, { role: 'user', content: now }];
}

export interface AgentChange { entry: string; field: string; value: string }

/** An agent reply: what it says, what it proposes, the new brief. */
export function parseAgentReply(text: string): { reply: string; drafts: Draft[]; changes: AgentChange[]; brief: string | null } {
  const fence = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(text);
  let reply = text;
  let json: Record<string, unknown> | null = null;
  if (fence) {
    reply = text.slice(0, fence.index);
    json = lenientJson<Record<string, unknown>>(fence[1] ?? '');
  } else {
    // A bare JSON object after the prose.
    const i = text.search(/\n\s*\{\s*"(brief|proposals|changes)"/);
    if (i >= 0) { reply = text.slice(0, i); json = lenientJson<Record<string, unknown>>(text.slice(i)); }
  }
  const drafts = json?.proposals && typeof json.proposals === 'object' ? parseForgeDrafts('mixed', JSON.stringify(json.proposals)) ?? [] : [];
  const changes: AgentChange[] = Array.isArray(json?.changes) ? (json!.changes as unknown[]).flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    const r = c as Record<string, unknown>;
    const entry = typeof r.entry === 'string' ? r.entry.trim() : '';
    const field = typeof r.field === 'string' ? r.field.trim() : '';
    const value = typeof r.value === 'string' ? r.value.trim() : '';
    return entry && field && value ? [{ entry, field, value }] : [];
  }) : [];
  const brief = typeof json?.brief === 'string' && json.brief.trim() ? json.brief.trim() : null;
  return { reply: reply.trim() || (drafts.length || changes.length ? 'Here is what I would add.' : ''), drafts, changes, brief };
}

/**
 * Changes to existing entries as drafts of them, one per entry with every
 * change applied, so accepting one is an ordinary edit. Changes to names or
 * fields the world does not have are dropped.
 */
export function changeDrafts(pool: Draft[], changes: AgentChange[]): Draft[] {
  const out = new Map<string, Draft>();
  for (const c of changes) {
    const base = out.get(normName(c.entry)) ?? pool.find((d) => d.kind !== 'world' && normName(d.name) === normName(c.entry));
    if (!base) continue;
    const def = DRAFT_FIELDS[base.kind].find((f) => f.key === c.field && (f.type === 'text' || f.type === 'long'));
    if (!def) continue;
    const changed = [...((base.fields._changed as string[] | undefined) ?? []), c.field];
    out.set(normName(c.entry), { ...base, existing: true, fields: { ...base.fields, [c.field]: c.value, _changed: [...new Set(changed)] } });
  }
  return [...out.values()];
}

/** The fields a change draft changes. */
export const changedFields = (d: Draft): string[] => (Array.isArray(d.fields._changed) ? (d.fields._changed as string[]) : []);

// ---------------------------------------------------------------------------
// Today's question

export function questionPrompt(o: { world: string; knowledge: string; coverage: string; brief: string; asked: string[]; recent: string[] }): ChatMessage[] {
  return [
    { role: 'system', content: [
      PERSONA,
      "Now ask the writer today's question: one question that would most enrich this world if they answered it in a few sentences. Aim at what is thin, unexplained or full of tension, or at a detail that would make a place, a person or a faction come alive. Specific beats general: not \"What is the religion like?\" but \"When the bells of the drowned chapel ring at low tide, who goes down to listen, and what are they forbidden to say?\". Never ask one already asked; vary what you ask about from day to day.",
      'Output only JSON: {"question": string (one or two sentences, addressed to the writer), "why": string (one line: what an answer would open up), "about": string (the entry by exact name, or a theme in two or three words)}',
    ].join('\n\n') },
    { role: 'user', content: [
      `# The world: ${o.world}`,
      o.brief.trim() ? `# The brief\n${o.brief.trim()}` : '',
      o.knowledge,
      `# Coverage\n${o.coverage}`,
      o.asked.length ? `# Already asked (never again)\n${o.asked.slice(-20).map((q) => `- ${q}`).join('\n')}` : '',
      o.recent.length ? `# Lately we talked about\n${o.recent.slice(-4).map((t) => `- ${t.slice(0, 200)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n') },
  ];
}

export function parseQuestion(text: string): { question: string; why: string; about: string } | null {
  const j = lenientJson<Record<string, unknown>>(text);
  const q = typeof j?.question === 'string' ? j.question.trim() : '';
  if (!q) {
    const line = text.trim().split('\n').find((l) => l.trim().endsWith('?'));
    return line ? { question: line.trim().replace(/^["“]|["”]$/g, ''), why: '', about: '' } : null;
  }
  return { question: q, why: typeof j?.why === 'string' ? j.why.trim() : '', about: typeof j?.about === 'string' ? j.about.trim() : '' };
}

/** A local date as YYYY-MM-DD. */
export function dayOf(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Which world's question to show on a day, when there are several: a different one each day, in turn. */
export function worldOfTheDay<T extends { id: string }>(worlds: T[], date: string): T | null {
  if (!worlds.length) return null;
  const n = [...date].reduce((a, c) => a + c.charCodeAt(0), 0) + Number(date.slice(8, 10) || 0);
  return [...worlds].sort((a, b) => a.id.localeCompare(b.id))[n % worlds.length] ?? null;
}
