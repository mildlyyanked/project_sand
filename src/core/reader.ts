import type { Beat, ChatMessage } from './types';

/**
 * Read with me: a reader follows the story as it is written and talks it
 * over with the writer in a side window, the way a friend texts while
 * reading. The reader knows only what is on the page: no brief, no notes,
 * no world, no plans; its guesses and surprises are a reader's. It speaks
 * up on its own now and then when new pages arrive, answers when spoken to,
 * and now and then has an idea the writer can send on to the next passage.
 */

export type ReaderKey = 'friend' | 'editor' | 'fan' | 'new' | 'custom';

export interface ReaderPersona {
  key: ReaderKey;
  /** What kind of reader, in a word or two. */
  label: string;
  /** What they are called in the chat. */
  name: string;
  /** One line for the picker. */
  blurb: string;
  /** Who they are and how they read and talk: for the model. */
  voice: string;
}

export const READERS: ReaderPersona[] = [
  {
    key: 'friend', label: 'A well-read friend', name: 'Jo',
    blurb: 'Warm and honest. Reads for pleasure, says when she is hooked and when she is drifting.',
    voice: 'You are a close friend of theirs who reads a lot, mostly for pleasure. Warm, funny, honest: you say when you are hooked and when your attention drifts, and you get attached to people in stories. You text casually, sometimes in fragments, sometimes all lower case.',
  },
  {
    key: 'editor', label: 'A blunt editor', name: 'Margot',
    blurb: 'Has read a thousand manuscripts. Dry, specific, notices slack and motive gaps.',
    voice: 'You are an editor who has read a thousand manuscripts and has no patience for flattery. Dry, precise, occasionally very funny. You notice slack sentences, unearned turns, motives that do not add up and scenes that run long, and you also say plainly when something works. You point at the exact line.',
  },
  {
    key: 'fan', label: 'A genre fan', name: 'Theo',
    blurb: 'Has read everything like this. Spots the tropes, loves it when they twist, guesses ahead.',
    voice: 'You have read everything in this kind of story and love it. You spot the tropes and the setups, get excited when one is twisted, groan when one is played straight, and keep guessing where it is going (often wrongly). Enthusiastic, a bit nerdy.',
  },
  {
    key: 'new', label: 'A first-time reader', name: 'Ivy',
    blurb: 'New to stories like this. Easily surprised, asks what things mean, honest when lost.',
    voice: 'You rarely read stories like this one, so everything lands fresh. You are easily surprised, ask what things mean when they are not clear, say honestly when you are lost, and care a lot about whether people are going to be all right.',
  },
];

export const personaOf = (key: ReaderKey, custom?: { name: string; description: string } | null): ReaderPersona => {
  if (key === 'custom' && custom?.description.trim()) {
    return { key: 'custom', label: 'Your reader', name: custom.name.trim() || 'Reader', blurb: custom.description.trim(), voice: `You are this reader: ${custom.description.trim()}` };
  }
  return READERS.find((r) => r.key === key) ?? READERS[0]!;
};

export interface ReaderMsg {
  id: string;
  from: 'reader' | 'writer';
  text: string;
  at: number;
  /** An idea the reader has for what could come next, ready to send to the writer. */
  idea?: string | null;
  /** The idea went to the writer. */
  used?: boolean;
}

export interface ReaderData {
  /** Reading along: off until the writer starts it. */
  on: boolean;
  persona: ReaderKey;
  custom: { name: string; description: string } | null;
  /** Only speaks when spoken to. */
  quiet: boolean;
  /** The last passage the reader has read. */
  readTo: string | null;
  /** Passages read since the reader last said something. */
  since: number;
  messages: ReaderMsg[];
  /** Reader messages not yet seen. */
  unread: number;
}

export const emptyReader = (): ReaderData => ({ on: false, persona: 'friend', custom: null, quiet: false, readTo: null, since: 0, messages: [], unread: 0 });

/** The prose on the page, in order: what a reader can see. Directions and notes are not on the page. */
export const pageOf = (path: Beat[]) => path.filter((b) => b.role === 'prose' && b.text.trim());

/** What of the page has not been read yet. */
export function unreadOf(path: Beat[], readTo: string | null): Beat[] {
  const page = pageOf(path);
  if (!readTo) return page;
  const i = page.findIndex((b) => b.id === readTo);
  // A passage read on another branch: the reader picks up from where this branch differs.
  return i >= 0 ? page.slice(i + 1) : page.slice(-1);
}

/**
 * The page as the reader holds it in mind: the opening of a long story
 * as remembered (the story's running summary, when there is one), the last
 * stretch word for word, and a mark where the new pages begin.
 */
export function pageText(path: Beat[], readTo: string | null, o: { budget?: number; remembered?: string } = {}): string {
  const page = pageOf(path);
  const fresh = new Set(unreadOf(path, readTo).map((b) => b.id));
  const budget = o.budget ?? 14000;
  const parts: string[] = [];
  let used = 0;
  let cut = false;
  for (let i = page.length - 1; i >= 0; i--) {
    const b = page[i]!;
    if (used + b.text.length > budget && parts.length) { cut = true; break; }
    const mark = fresh.has(b.id) && !fresh.has(page[i - 1]?.id ?? '') && fresh.size < page.length ? '\n[— new since you last said anything —]\n\n' : '';
    parts.unshift(`${mark}${b.text.trim()}`);
    used += b.text.length;
  }
  const head = cut ? (o.remembered?.trim() ? `[What you remember of the earlier pages: ${o.remembered.trim()}]\n\n[…]\n\n` : '[…earlier pages…]\n\n') : '';
  return page.length ? head + parts.join('\n\n') : '';
}

const RULES = [
  'How you talk:',
  '- Like texting someone you know while you read. Short: usually one to three messages, each a sentence or two; sometimes just a word or a reaction. Put a blank line between messages.',
  '- React the way a reader does: what you feel, what you noticed, what you suspect, what you want to happen, what bored or confused you. Be specific: point at the moment or quote a few words.',
  '- Have opinions and moods. Disagree when you disagree. Ask something back now and then, not every time.',
  '- No lists, no headings, no bold, no summaries of what happened, no compliments sandwiches, no "great question", no offers to help, no sign-offs. You are not an assistant and do not talk like one.',
  '- You know only what is on the page so far. You do not know what is planned; guess like a reader would, and be wrong sometimes.',
  '- Rarely, when you really want something to happen and it would make a good next passage, end with a line on its own: IDEA: followed by it, as a short instruction to the writer (for example: IDEA: let her find the letter before he can burn it). Most of the time, no idea.',
];

/** The conversation so far, as the model sees it: the writer as the user, the reader as itself. */
function history(messages: ReaderMsg[], keep = 30): ChatMessage[] {
  return messages.slice(-keep).map((m) => ({ role: m.from === 'writer' ? 'user' as const : 'assistant' as const, content: m.from === 'reader' && m.idea ? `${m.text}\n\nIDEA: ${m.idea}` : m.text }));
}

export type ReaderCue = { kind: 'reply' } | { kind: 'react' } | { kind: 'hello' };

/** The prompt for the reader's next turn: answering the writer, reacting to new pages, or saying hello. */
export function readerPrompt(o: { persona: ReaderPersona; title: string; page: string; messages: ReaderMsg[]; cue: ReaderCue }): ChatMessage[] {
  const sys = [
    `${o.persona.voice} Your name is ${o.persona.name}.`,
    `They are writing a story${o.title.trim() ? ` called "${o.title.trim()}"` : ''} and you are reading it as it is written, chatting with them in a little window beside the page.`,
    '',
    ...RULES,
    '',
    o.page ? `THE PAGES SO FAR (all you have read):\n\n${o.page}` : 'Nothing is written yet.',
  ].join('\n');
  const msgs: ChatMessage[] = [{ role: 'system', content: sys }, ...history(o.messages)];
  if (o.cue.kind === 'react') msgs.push({ role: 'user', content: '(New pages just came in and you have read them. Say something only if a reader really would: a reaction, a laugh, a worry, a guess, a gripe. If nothing is worth saying, reply with exactly: PASS)' });
  if (o.cue.kind === 'hello') msgs.push({ role: 'user', content: o.page ? '(You are starting to read along. Say hi in a few words and give your first reaction to what you have read.)' : '(You are starting to read along, but nothing is written yet. Say hi in a few words.)' });
  return msgs;
}

export interface ReaderReply { bubbles: string[]; idea: string | null; pass: boolean }

/** A reply as chat bubbles, with any idea taken out; PASS when the reader keeps quiet. */
export function parseReaderReply(text: string): ReaderReply {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (/^\(?\s*pass\s*\)?\.?$/i.test(t) || !t) return { bubbles: [], idea: null, pass: true };
  let idea: string | null = null;
  t = t.replace(/^\s*(?:IDEA|SUGGEST(?:ION)?)\s*:\s*(.+)$/gim, (_, v: string) => { idea = idea ?? v.trim().replace(/^["“]|["”]$/g, ''); return ''; });
  // Whatever slips through of an assistant's habits: markdown, bullets, a name tag.
  const clean = t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*\w+:\s(?=\S)/, (m) => (/^(me|reader|jo|margot|theo|ivy)\s*:/i.test(m.trim()) ? '' : m));
  const bubbles = clean.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).slice(0, 4);
  return { bubbles, idea, pass: !bubbles.length && !idea };
}

/**
 * Whether the reader might speak up about new pages: never when quiet,
 * always after a good stretch, sometimes after a single passage. The model
 * can still choose to say nothing.
 */
export function shouldReact(o: { quiet: boolean; fresh: number; freshChars: number; since: number; roll: number }): boolean {
  if (o.quiet || o.fresh <= 0) return false;
  if (o.since + o.fresh >= 3 || o.freshChars >= 2600) return true;
  return o.roll < 0.4;
}

/** How long a reader takes to type a message, so replies arrive like messages, not like a dump. */
export const typingMs = (text: string) => Math.min(2600, 450 + text.length * 22);
