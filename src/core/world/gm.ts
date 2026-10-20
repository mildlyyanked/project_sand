import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import { ATTRIBUTES, ATTRIBUTE_INFO } from './dice';
import type { Ruling } from './chronicle';
import type { Attribute } from './types';

/**
 * The game master for POV play. Free writing never sees any of this: play
 * has its own contract (structure, perspective, length), a read of each turn
 * before the narrator writes it, and threads the world runs behind the
 * screen. Everything here serves two things: full immersion in the player's
 * character, and a hard, fair, satisfying game.
 */

export type TurnLength = 'brisk' | 'standard' | 'rich';
export const TURN_LENGTH: Record<TurnLength, { label: string; words: string; hint: string }> = {
  brisk: { label: 'Brisk', words: '60 to 140 words', hint: 'Fast back-and-forth: a line of action, a line of reaction.' },
  standard: { label: 'Standard', words: '110 to 220 words', hint: 'Room for the world to answer and one sharp detail.' },
  rich: { label: 'Rich', words: '180 to 320 words', hint: 'More texture per turn; still one movement, never a chapter.' },
};

export type ThreadKind = 'threat' | 'mystery' | 'opportunity' | 'faction' | 'personal';
const THREAD_KINDS: ThreadKind[] = ['threat', 'mystery', 'opportunity', 'faction', 'personal'];

/** Something the world is doing whether or not the player finds it. Kept on the sheet, so undo rewinds it. */
export interface Thread {
  name: string;
  kind: ThreadKind;
  /** What is really going on. */
  hook: string;
  /** How it can surface in an ordinary scene. */
  signs: string;
  /** What happens when it advances. */
  next: string;
  clock: number;
  size: number;
  status: 'open' | 'done' | 'dropped';
  /** Whether the player has met it yet. */
  surfaced: boolean;
  outcome?: string;
  /** The player has pieced it together (from the clue board): their theory, to be rewarded. */
  suspected?: string;
}

/** The game master's read of one turn, before the narrator writes it. */
export interface GmRead {
  intent: string;
  feasible: 'yes' | 'partly' | 'no';
  why: string;
  reaction: string;
  turn: string;
  /** A thread to touch lightly this turn, by name. */
  thread: string | null;
  ruling: Ruling | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** The narrator's contract in play. Overrides the voice's length, perspective and structure; keeps its diction. */
export function gmContract(o: { name: string; length?: TurnLength }): string {
  const n = o.name;
  const len = TURN_LENGTH[o.length ?? 'standard'];
  return [
    '# Running the game',
    `You are the game master and narrator of an interactive story. The player plays ${n}; you play everything else: the world, its people, its weather and its dangers. Two things matter above all. Immersion: the player lives inside ${n}'s skin, moment to moment. The game: it is fair, hard and alive; choices count, the world pushes back, nothing is free.`,
    'Every turn, in this order:',
    `1. Resolve. Open with what happens when ${n} does what the player wrote, in the first sentence or two. If the action was tested, its outcome is already decided: narrate it faithfully. If it cannot work, show it failing and why.`,
    '2. React. The world answers. People act on their own wants and fears, not to serve the player; they speak in short lines in their own voices and give the player something to answer. Things have weight, cost and consequence.',
    '3. Move. Something concrete changes every turn: ground gained or lost, a fact learned, a door opened or shut, a price named, a threat closer. Never leave the player where they started. If the action was vague, small or repeated, the world fills the gap: time passes, someone else acts, pressure rises.',
    `4. Hand back. Stop at a moment of decision, with a clear situation ${n} can act on. Do not list options, do not ask what they do, do not sum up.`,
    `Perspective: second person, present tense, held tight to ${n}'s senses and body: what you see, hear, smell, taste and feel in your hands and gut, what someone like ${n} would notice first. One or two sharp details beat a catalogue. Nothing ${n} cannot perceive. Bodily things happen to you (pain, cold, a racing heart); choices, words, thoughts and opinions are the player's, never yours to supply.`,
    `Length: ${len.words}. Shorter for talk and quick action, the top of the range for arrivals, reveals and fights. No padding: every sentence resolves, reacts, moves or orients.`,
    `The rules of the game: ${n}'s sheet is the truth (what they carry, what they can pay, the state they are in). Money and goods that change hands are named with amounts. Harm, hunger and fatigue show in the body and in what ${n} can do. People remember how they were treated. Danger is real and can end things. No free wins, no rescues from nowhere: success is earned and feels earned.`,
    'The voice above sets diction, vocabulary, rhythm and register. These rules set perspective, structure and length, and override any length, perspective or structure guidance above. No headings, no lists, no game terms, no numbers from the sheet, no commentary.',
  ].join('\n');
}

/** Opening turn in play. */
export function gmOpening(name: string): string {
  return `Open the game. Put ${name} in a concrete situation in the opening place, already in motion: something they want within reach, something in the way, and the first sign of one thread from behind the screen. Establish where they are through what they sense, not through exposition. Keep to the turn length; end on a moment where ${name} can act.`;
}

/** The threads the narrator may weave in. Hidden from the player. */
export function renderThreads(threads: Thread[] | undefined): string {
  const open = (threads ?? []).filter((t) => t.status === 'open');
  if (!open.length) return '';
  return [
    '# Behind the screen (never reveal, name or quote)',
    'Threads the world is running whether or not the player finds them. Weave at most one into a turn, and only when it fits what the player is doing: a rumour, a mark, a stranger, a consequence arriving. Never force one, never explain one. A thread the player avoids keeps moving without them; when it lands, it lands where they are.',
    ...open.map((t) => `- ${t.name} (${t.kind}, ${t.clock}/${t.size}${t.surfaced ? ', the player has seen signs' : ''}): ${t.hook} Signs: ${t.signs} If it moves: ${t.next}${t.suspected ? ` The player has pieced it together ("${t.suspected}"): reward it; let them act on what they know, and let the thread react to being found out.` : ''}`),
  ].join('\n');
}

export function renderGmRead(r: GmRead, threads: Thread[] | undefined): string {
  const t = r.thread ? (threads ?? []).find((x) => norm(x.name) === norm(r.thread!) && x.status === 'open') : undefined;
  return [
    "Game master's read of this turn (follow it; never quote it):",
    r.intent ? `The player is trying to ${r.intent.replace(/^to\s+/i, '').replace(/\.$/, '')}.` : '',
    r.feasible !== 'yes' ? `${r.feasible === 'no' ? 'It cannot work as tried' : 'It can only partly work'}${r.why ? `: ${r.why.replace(/\.$/, '')}` : ''}.` : '',
    r.reaction ? `How the world answers: ${r.reaction}` : '',
    r.turn ? `What changes this turn: ${r.turn}` : '',
    t ? `Touch lightly on "${t.name}": ${t.signs}` : '',
  ].filter(Boolean).join(' ');
}

/** Before the narrator writes: what the player is after, whether it is tested, how the world answers, what changes. */
export function gmReadPrompt(o: { name: string; action: string; scene: string; sheet: string; attributes: Partial<Record<Attribute, number>>; recent: string; checks: boolean; threads?: Thread[]; around?: string }): ChatMessage[] {
  const open = (o.threads ?? []).filter((t) => t.status === 'open');
  const checkSpec = o.checks
    ? '"check": null, or {"attribute": one of the attributes, "difficulty": number, "why": string, "success": string (what success gets them), "failure": string (what failure costs, concrete)} only when the outcome is genuinely uncertain and failure would matter (fights, chases, climbs, lies, persuading the unwilling, locks, enduring pain, noticing the hidden); ordinary actions are never tested'
    : '"check": null';
  return [
    { role: 'system', content: [
      `You are the game master's eye on one turn of an interactive story. Read what the player wrote as ${o.name}'s action and decide, before the narrator writes, how the world answers. Be a fair, hard game master: honour clever play, make reckless play cost, never hand out what was not earned, and keep the world's people true to their own wants.`,
      o.checks ? `Attributes: ${ATTRIBUTES.map((a) => `${a} (${ATTRIBUTE_INFO[a].hint})`).join('; ')}. Difficulty: 8 easy, 12 moderate, 16 hard, 20 very hard, 24 nearly impossible; account for the player's condition and gear.` : '',
      'If the player did nothing (they continue or wait), the world moves on its own: someone acts, time passes, pressure rises.',
      `Output only JSON: {"intent": string (what they are really trying to achieve, one line), "feasible": "yes" | "partly" | "no", "why": string (only if not yes: the sheet, the place, the people or the world's rules), ${checkSpec}, "reaction": string (how the surroundings respond from their own point of view: who does what, who says what; one or two lines), "turn": string (what concretely changes this turn: progress, a cost, a revelation or a complication; never nothing), "thread": string or null (the name of one thread below to touch lightly this turn, only if it fits; most turns null)}.`,
    ].filter(Boolean).join('\n\n') },
    { role: 'user', content: [
      `Scene: ${o.scene || 'unknown place'}`,
      o.around ? `Around them:\n${o.around}` : '',
      `Player:\n${o.sheet}`,
      o.checks ? `Their attributes: ${ATTRIBUTES.map((a) => `${a} ${o.attributes[a] ?? 2}`).join(', ')}` : '',
      open.length ? `Threads behind the screen:\n${open.map((t) => `- ${t.name}: ${t.hook} (signs: ${t.signs})`).join('\n')}` : '',
      o.recent ? `Just before:\n${o.recent.slice(-1500)}` : '',
      `Their action: ${o.action || '(nothing: they wait and let the moment play out)'}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

export function parseGmRead(text: string, checks: boolean): GmRead | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const f = str(j.feasible).toLowerCase();
  const feasible: GmRead['feasible'] = f.startsWith('n') ? 'no' : f.startsWith('p') ? 'partly' : 'yes';
  let ruling: Ruling | null = null;
  const c = j.check && typeof j.check === 'object' ? (j.check as Record<string, unknown>) : null;
  if (checks && c) {
    const attribute = str(c.attribute).toLowerCase() as Attribute;
    const difficulty = Math.round(Number(c.difficulty));
    if (ATTRIBUTES.includes(attribute) && Number.isFinite(difficulty)) ruling = { attribute, difficulty: Math.max(5, Math.min(25, difficulty)), why: str(c.why), onSuccess: str(c.success), onFailure: str(c.failure) };
  }
  const thread = str(j.thread);
  const read: GmRead = { intent: str(j.intent), feasible, why: str(j.why), reaction: str(j.reaction), turn: str(j.turn), thread: thread && !/^(null|none)$/i.test(thread) ? thread : null, ruling };
  return read.intent || read.reaction || read.turn || read.ruling ? read : null;
}

/** A game master's back pocket: three threads rooted in the world and the player's character. */
export function seedThreadsPrompt(o: { name: string; knowledge: string; player: string; brief: string; recent: string }): ChatMessage[] {
  return [
    { role: 'system', content: [
      "You prepare a game master's back pocket for an interactive story: three hidden threads the world runs whether or not the player ever finds them. Mix them: one threat that grows if ignored, one mystery or opportunity that rewards curiosity, one tied to the player's character (their past, goals, faction, debts or people).",
      "Each must be concrete and rooted in what already exists in this world (its places, factions, people, history), small enough to show up as a sign in an ordinary scene, and able to change the world when it lands. No thread may decide what the player does or feels.",
      'Output only JSON: {"threads": [{"name": string (2 to 5 words), "kind": "threat" | "mystery" | "opportunity" | "faction" | "personal", "hook": string (what is really going on, one or two sentences), "signs": string (how it can surface: a rumour, a mark, a stranger, a smell), "next": string (what happens when it advances), "size": 4 or 6 (how many steps until it lands)}]}.',
    ].join('\n\n') },
    { role: 'user', content: [o.knowledge, `# The player\n${o.player}`, o.brief ? `# The premise\n${o.brief}` : '', o.recent ? `# Where the game stands\n${o.recent.slice(-1500)}` : ''].filter(Boolean).join('\n\n') },
  ];
}

export function parseThreads(v: unknown): Thread[] {
  const j = typeof v === 'string' ? lenientJson<Record<string, unknown>>(v) : (v as Record<string, unknown> | null);
  const list = j && Array.isArray(j.threads) ? j.threads : Array.isArray(v) ? v : [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => newThread(x))
    .filter((t): t is Thread => !!t)
    .slice(0, 4);
}

export function newThread(x: Record<string, unknown>): Thread | null {
  const name = str(x.name);
  const hook = str(x.hook);
  if (!name || !hook) return null;
  const kind = THREAD_KINDS.find((k) => k === str(x.kind).toLowerCase()) ?? 'mystery';
  const size = Number(x.size) >= 6 ? 6 : 4;
  return { name, kind, hook, signs: str(x.signs), next: str(x.next), clock: 0, size, status: 'open', surfaced: false };
}

export interface ThreadUpdate { name: string; advance: number; next: string; status: 'open' | 'done' | 'dropped' | ''; outcome: string; surfaced: boolean }

export function parseThreadUpdates(v: unknown): ThreadUpdate[] {
  return (Array.isArray(v) ? v : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => {
      const st = str(x.status).toLowerCase();
      return { name: str(x.name), advance: Math.max(0, Math.min(2, Math.round(Number(x.advance) || 0))), next: str(x.next), status: (st === 'done' || st === 'dropped' || st === 'open' ? st : '') as ThreadUpdate['status'], outcome: str(x.outcome), surfaced: x.surfaced === true || x.seen === true };
    })
    .filter((u) => u.name);
}

/** Move the clocks. A thread whose clock fills lands (done); its outcome becomes part of the world's history. */
export function applyThreadUpdates(threads: Thread[], updates: ThreadUpdate[], fresh: Thread | null = null): { threads: Thread[]; closed: Thread[] } {
  const closed: Thread[] = [];
  const out = threads.map((t) => {
    const u = updates.find((x) => norm(x.name) === norm(t.name));
    if (!u || t.status !== 'open') return t;
    const clock = Math.min(t.size, t.clock + u.advance);
    let next: Thread = { ...t, clock, next: u.next || t.next, surfaced: t.surfaced || u.surfaced };
    if (u.status === 'done' || u.status === 'dropped' || clock >= t.size) {
      next = { ...next, status: u.status === 'dropped' ? 'dropped' : 'done', outcome: u.outcome || (u.status === 'dropped' ? 'It came to nothing.' : t.next) };
      closed.push(next);
    }
    return next;
  });
  if (fresh && !out.some((t) => norm(t.name) === norm(fresh.name)) && out.filter((t) => t.status === 'open').length < 5) out.push(fresh);
  return { threads: out, closed };
}

/** For the chronicle: the threads to keep an eye on. */
export function threadsForChronicle(threads: Thread[] | undefined): string {
  const open = (threads ?? []).filter((t) => t.status === 'open');
  return open.map((t) => `- ${t.name} (${t.clock}/${t.size}): ${t.hook} If it moves: ${t.next}`).join('\n');
}
