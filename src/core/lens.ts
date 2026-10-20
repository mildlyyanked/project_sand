import type { ChatMessage } from './types';
import { lenientJson } from './json';

/**
 * The Lens: on demand, a passage's points of interest (people, places,
 * things, factions, small details) become tappable, each with a card written
 * from the passage, the library and the timeline. What the Lens says is
 * flavour until pinned; pinned details are canon and reach the writer. In
 * play it sees only what the player's character could perceive, and the
 * threads behind the screen can leave clues in it.
 */
export type PointKind = 'person' | 'place' | 'thing' | 'faction' | 'detail';
const KINDS: PointKind[] = ['person', 'place', 'thing', 'faction', 'detail'];

export interface LensCard {
  text: string;
  facts: string[];
  /** In play: what the character does not know yet, and how they might find out. */
  unknown: string;
  /** Things to look closer at. */
  closer: LensPoint[];
  /** In play: a trace of a hidden thread, if this thing carries one. */
  clue: { text: string; thread: string } | null;
}

export interface LensPoint {
  name: string;
  kind: PointKind;
  /** The exact words in the passage that name it, for the inline highlight. */
  span: string;
  blurb: string;
  /** A library entry it is, by name, when it is one. */
  ref: string;
  card?: LensCard;
}

export interface LensData { points: LensPoint[]; at: number }

/** A detail made canon: it reaches the writer from the next passage on. */
export interface LensPin { id: string; name: string; text: string; beatId: string }
/** In play: a detail that may point at something behind the screen. Which thread stays hidden. */
export interface LensClue { id: string; name: string; text: string; beatId: string; thread: string; solved: boolean }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const kindOf = (v: unknown): PointKind => {
  const k = str(v).toLowerCase();
  if (KINDS.includes(k as PointKind)) return k as PointKind;
  if (/character|people|npc|creature/.test(k)) return 'person';
  if (/location|room|building|city/.test(k)) return 'place';
  if (/item|object|weapon|tool/.test(k)) return 'thing';
  if (/organi[sz]ation|group|guild/.test(k)) return 'faction';
  return 'detail';
};

const PERCEIVE = (name: string) => `Only what ${name} could perceive, remember or reasonably know from where they stand; nothing the player has not earned. What they cannot know stays unknown.`;

export function scanPrompt(o: { passage: string; known: string[]; pov?: { name: string } | null }): ChatMessage[] {
  return [
    { role: 'system', content: [
      'You mark the points of interest in a passage of fiction for a reader who wants to explore it: the people, places, things and groups it brings up, and the small concrete details worth a closer look (a scar, a smell, a mark on a wall). Choose 5 to 12 that would reward a second look; skip the trivial.',
      o.pov ? `This is interactive; the player is ${o.pov.name}. ${PERCEIVE(o.pov.name)} Never list ${o.pov.name} themself.` : '',
      'Output only JSON: {"points": [{"name": string (a short name for it), "kind": "person" | "place" | "thing" | "faction" | "detail", "span": string (the exact words in the passage that refer to it, copied verbatim, at most six words), "blurb": string (one line: what it is and why it is interesting), "ref": string (the exact name of a known entry it is, or "")}]}.',
    ].filter(Boolean).join('\n\n') },
    { role: 'user', content: [o.known.length ? `Known entries: ${o.known.slice(0, 200).join(', ')}` : '', `Passage:\n${o.passage}`].filter(Boolean).join('\n\n') },
  ];
}

export function parseScan(text: string, passage: string): LensPoint[] {
  const j = lenientJson<{ points?: unknown }>(text);
  const list = j && Array.isArray(j.points) ? j.points : [];
  const seen = new Set<string>();
  const out: LensPoint[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const name = str(r.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    let span = str(r.span);
    // The highlight needs words that are really there; fall back to the name if they are.
    if (!span || !passage.includes(span)) span = passage.includes(name) ? name : findLoose(passage, span) || findLoose(passage, name);
    out.push({ name, kind: kindOf(r.kind), span, blurb: str(r.blurb), ref: str(r.ref) });
  }
  return out.slice(0, 14);
}

/** The words as they actually appear in the passage, ignoring case; '' when they do not. */
function findLoose(passage: string, words: string): string {
  if (!words) return '';
  const i = passage.toLowerCase().indexOf(words.toLowerCase());
  return i >= 0 ? passage.slice(i, i + words.length) : '';
}

export function cardPrompt(o: { point: LensPoint; trail: string[]; passage: string; knowledge: string; history: string; pov?: { name: string; sheet: string } | null; threads?: string }): ChatMessage[] {
  const play = o.pov;
  return [
    { role: 'system', content: [
      `You write the card for one point of interest in a story, for a reader exploring it: ${o.point.name} (${o.point.kind}). Ground it in the passage, the library entries and the history given; where they are silent, add plausible, specific texture that fits, never contradicting them. Concrete and sensory, 60 to 140 words, no headings.`,
      play ? `This is interactive; the player is ${play.name}. ${PERCEIVE(play.name)} Write the card as what ${play.name} notices and knows.` : '',
      play && o.threads ? 'Threads run behind the screen (below). If one of them would plausibly leave a trace on this, include that trace as one small, concrete detail in the card and name the thread in "clue"; otherwise "clue" is null. Never explain the thread or name it in the text.' : '',
      `Output only JSON: {"text": string, "facts": string[] (2 to 4 short, specific facts a writer could pin), "unknown": string (${play ? `what ${play.name} cannot tell yet and how they might find out; ""` : '""'} if nothing), "closer": [{"name": string, "kind": "person" | "place" | "thing" | "faction" | "detail", "blurb": string}] (2 to 4 parts or details worth looking closer at), "clue": null${play && o.threads ? ' or {"text": string (the detail), "thread": string (the thread\'s name)}' : ''}}.`,
    ].filter(Boolean).join('\n\n') },
    { role: 'user', content: [
      o.knowledge,
      o.history ? `# What has happened\n${o.history}` : '',
      play ? `# The player\n${play.sheet}` : '',
      play && o.threads ? `# Behind the screen (hidden)\n${o.threads}` : '',
      `# The passage\n${o.passage}`,
      `# Look at: ${[...o.trail, o.point.name].join(' › ')}\n${o.point.blurb}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

export function parseCard(text: string): LensCard | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const body = str(j.text);
  if (!body) return null;
  const closer = (Array.isArray(j.closer) ? j.closer : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ name: str(x.name), kind: kindOf(x.kind), span: '', blurb: str(x.blurb), ref: '' }))
    .filter((x) => x.name)
    .slice(0, 5);
  const c = j.clue && typeof j.clue === 'object' ? (j.clue as Record<string, unknown>) : null;
  return {
    text: body,
    facts: (Array.isArray(j.facts) ? j.facts : []).map(str).filter(Boolean).slice(0, 5),
    unknown: str(j.unknown),
    closer,
    clue: c && str(c.text) && str(c.thread) ? { text: str(c.text), thread: str(c.thread) } : null,
  };
}

/** The player pins clues together and says what they think is going on. */
export function guessPrompt(o: { clues: LensClue[]; guess: string; threads: string }): ChatMessage[] {
  return [
    { role: 'system', content: 'You judge a player\'s theory in an interactive story against the threads the game master is running behind the screen. Be fair: a theory hits a thread when it grasps what is really going on in substance, even if details are off; it is close when it is on the right track but missing the heart of it. Output only JSON: {"thread": string (the name of the thread it is about, or ""), "verdict": "hit" | "close" | "miss", "nudge": string (one in-world sentence the player\'s character realises or senses; for a miss, something true that points elsewhere; never reveal more than the theory earned)}.' },
    { role: 'user', content: `# Behind the screen\n${o.threads}\n\n# The clues the player connected\n${o.clues.map((c) => `- ${c.name}: ${c.text}`).join('\n')}\n\n# The player's theory\n${o.guess.trim() || '(no words: they only connected the clues)'}` },
  ];
}

export function parseGuess(text: string): { thread: string; verdict: 'hit' | 'close' | 'miss'; nudge: string } | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const v = str(j.verdict).toLowerCase();
  return { thread: str(j.thread), verdict: v === 'hit' ? 'hit' : v === 'close' ? 'close' : 'miss', nudge: str(j.nudge) };
}

/** Pinned details, for the writer. */
export function renderPins(pins: LensPin[] | undefined): string {
  if (!pins?.length) return '';
  return ['# Details established in this story (keep to them)', ...pins.map((p) => `- ${p.name}: ${p.text}`)].join('\n');
}

export interface Segment { text: string; point?: number; link?: string }

/**
 * A passage cut into plain text and highlights: the first appearance of each
 * point's span, longest first so "the iron key" wins over "key", never
 * overlapping; then entry links (from `findMentions`) wherever the Lens left room.
 */
export function segments(text: string, points: LensPoint[], links: { start: number; end: number; id: string }[] = []): Segment[] {
  const taken: { start: number; end: number; point?: number; link?: string }[] = [];
  const order = points.map((p, i) => ({ p, i })).filter((x) => x.p.span).sort((a, b) => b.p.span.length - a.p.span.length);
  for (const { p, i } of order) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(p.span, from);
      if (at < 0) break;
      const end = at + p.span.length;
      if (!taken.some((t) => at < t.end && end > t.start)) {
        taken.push({ start: at, end, point: i });
        break;
      }
      from = at + 1;
    }
  }
  for (const l of links) if (!taken.some((t) => l.start < t.end && l.end > t.start)) taken.push({ start: l.start, end: l.end, link: l.id });
  taken.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const t of taken) {
    if (t.start > pos) out.push({ text: text.slice(pos, t.start) });
    out.push(t.link ? { text: text.slice(t.start, t.end), link: t.link } : { text: text.slice(t.start, t.end), point: t.point });
    pos = t.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
