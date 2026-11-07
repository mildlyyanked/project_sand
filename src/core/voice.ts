import type { Character, ChatMessage, Style, VoiceSpec, VoiceStrength } from './types';
import { EMPTY_VOICE } from './types';
import { lenientJson } from './json';

/**
 * Voices that hold. Two levers make a model write like someone instead of
 * like itself: rules concrete enough to follow (sentence shapes, diction,
 * what the narration does and never does) with original passages that show
 * them, and a reminder at the very end of the prompt, right before it
 * writes, where instructions weigh most. The same holds for a character: a
 * voice in rules, lines they would say, who they play like, and a reminder of
 * every voice in the scene just before the passage. All pure; the voice
 * editor and the context assembler use it.
 */

export const STRENGTH: Record<VoiceStrength, { label: string; hint: string; prompt: string }> = {
  echo: { label: 'Echo', hint: 'A flavor of them in the story’s own voice.', prompt: 'a flavor: the story keeps its own voice and borrows their rhythm, diction and habits of attention lightly' },
  close: { label: 'Close', hint: 'Clearly theirs: a reader who knows them would tell within a page.', prompt: 'clearly theirs: a reader who knows their work would recognise it within a page' },
  pastiche: { label: 'Pastiche', hint: 'Unmistakable, tics and all.', prompt: 'unmistakable: every paragraph reads as theirs, their tics and obsessions included' },
};

export function voiceOf(s: Style | null | undefined): VoiceSpec {
  const v = { ...EMPTY_VOICE, ...(s?.voice ?? {}) };
  // Before voices were built from authors, the influences line said who.
  if (!v.authors.length && s?.influences?.trim()) v.authors = [s.influences.trim()];
  return v;
}

export const hasVoice = (v: VoiceSpec) => !!(v.authors.length || v.rules.trim() || v.anchor.trim() || v.tone.trim());
const authorLine = (v: VoiceSpec) => v.authors.join(' and ');

/** The voice's head for the writer's system prompt: who, how far, the mood, then the rules. */
export function renderVoice(name: string, v: VoiceSpec): string {
  if (!hasVoice(v)) return '';
  return [
    `# Voice: ${name}${v.authors.length ? `. Write like ${authorLine(v)}` : ''}`,
    v.authors.length ? `How far: ${STRENGTH[v.strength].prompt}. Their manner, never their sentences: do not quote or closely paraphrase their books, and never bring in their characters or settings.` : '',
    v.tone.trim() ? `Tone: ${v.tone.trim()}` : '',
    v.rules.trim() ? `How this voice writes:\n${v.rules.trim()}` : '',
    'This voice is not a suggestion. Every sentence should be recognisably it; where your own habits and the voice disagree, the voice wins.',
  ].filter(Boolean).join('\n');
}

/** Said again right before every passage: the voice in one breath. Empty when the voice says nothing. */
export function voiceAnchor(s: Style | null | undefined): string {
  if (!s) return '';
  const v = voiceOf(s);
  if (!hasVoice(v)) return '';
  const firstRules = v.rules.split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter((l) => l && !/:$/.test(l)).slice(0, 3).join(' ');
  const gist = v.anchor.trim() || firstRules;
  return [`Voice: ${v.authors.length ? `write this like ${authorLine(v)} (${STRENGTH[v.strength].label.toLowerCase()})` : `stay in the voice of ${s.name}`}.`, gist].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Building a voice

/** Two plain situations for sample passages: the voice is the only thing that varies. */
export const SAMPLE_SITUATIONS = [
  'A man waits at a bus stop in the rain; the bus is late, and someone he would rather not see sits down beside him.',
  'Two siblings argue in a kitchen over who keeps their late mother’s car.',
];

export interface VoiceBuild extends Partial<Pick<Style, 'name' | 'pointOfView' | 'tense' | 'proseDensity' | 'dialogueRatio' | 'register' | 'bannedPhrases' | 'samples'>> { voice: Partial<VoiceSpec> }

/**
 * Turn who a voice writes like (and, if given, a passage in it) into a voice
 * the writer can follow: rules, a one-line anchor, the form, phrases it
 * would never use, and two original sample passages in it.
 */
export function buildVoicePrompt(o: { authors: string[]; strength: VoiceStrength; tone: string; wish: string; sample?: string; current?: Style | null }): ChatMessage[] {
  const who = o.authors.filter((a) => a.trim()).join(' and ');
  return [
    { role: 'system', content: [
      'You are a prose stylist who can describe any writer’s voice so precisely that another writer could reproduce it. You write a voice sheet for a fiction writer’s tool: rules a language model will follow while writing new scenes.',
      'Rules must be concrete and checkable, never vague praise. Not "evocative prose" but "one long cumulative sentence per paragraph at most; the rest short and declarative". Cover: sentences (length, rhythm, syntax), diction (register, the words it reaches for and avoids), narration (distance, what it notices, how it handles time and interiority), dialogue (tags, attribution, how people talk), structure and pacing (paragraphing, scene breaks, digressions), tone and humor, and what the voice never does. 10 to 16 bullets under those headings.',
      `The sample passages are original: new sentences in the voice, on the situations given, never quoted or closely paraphrased from any book, with no characters or places from the author's work. Each 150 to 220 words. They are the strongest guide the writer gets, so make them unmistakably the voice.`,
      'The anchor is one sentence (at most 40 words) a writer could keep in mind while writing: the two or three things that most make the voice itself. The anchor and rules say nothing about point of view or tense; those are set separately.',
      `Output only JSON: {"name": string (2 to 4 words naming the voice), "tone": string (a few words), "rules": string (the bullets, grouped under short headings ending in a colon, one per line), "anchor": string, "pointOfView": string, "tense": string, "proseDensity": string (a few words), "dialogueRatio": string (a few words), "register": "clinical" | "euphemistic" | "blunt" (how bodies and acts are named), "bannedPhrases": string[] (5 to 10 phrases this voice would never use), "samples": [string, string]}. Inside string values quote with single quotes, never bare double quotes.`,
    ].join('\n\n') },
    { role: 'user', content: [
      who ? `Write like: ${who}. How far: ${STRENGTH[o.strength].prompt}.` : 'No author named: build the voice from the passage below.',
      o.tone.trim() ? `Tone: ${o.tone.trim()}` : '',
      o.sample?.trim() ? `A passage in the voice (learn from it; do not reuse it):\n${o.sample.trim().slice(0, 4000)}` : '',
      o.current && hasVoice(voiceOf(o.current)) && voiceOf(o.current).rules.trim() ? `The voice sheet so far (keep what is right, sharpen the rest):\n${voiceOf(o.current).rules.trim()}` : '',
      o.wish.trim() ? `What I want: ${o.wish.trim()}` : '',
      `Sample situations:\n1. ${SAMPLE_SITUATIONS[0]}\n2. ${SAMPLE_SITUATIONS[1]}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

export function parseVoiceBuild(text: string): VoiceBuild | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const rules = Array.isArray(j.rules) ? (j.rules as unknown[]).map(s).filter(Boolean).map((r) => (r.startsWith('-') || r.endsWith(':') ? r : `- ${r}`)).join('\n') : s(j.rules);
  if (!rules && !s(j.anchor)) return null;
  const reg = s(j.register).toLowerCase();
  const samples = Array.isArray(j.samples) ? (j.samples as unknown[]).map(s).filter((x) => x.length > 60).slice(0, 3) : [];
  return {
    ...(s(j.name) ? { name: s(j.name) } : {}),
    ...(s(j.pointOfView) ? { pointOfView: s(j.pointOfView) } : {}),
    ...(s(j.tense) ? { tense: s(j.tense) } : {}),
    ...(s(j.proseDensity) ? { proseDensity: s(j.proseDensity) } : {}),
    ...(s(j.dialogueRatio) ? { dialogueRatio: s(j.dialogueRatio) } : {}),
    ...(reg === 'clinical' || reg === 'euphemistic' || reg === 'blunt' ? { register: reg } : {}),
    ...(Array.isArray(j.bannedPhrases) ? { bannedPhrases: (j.bannedPhrases as unknown[]).map(s).filter(Boolean).slice(0, 12) } : {}),
    ...(samples.length ? { samples } : {}),
    voice: { rules, anchor: s(j.anchor), ...(s(j.tone) ? { tone: s(j.tone) } : {}) },
  };
}

/** The same test scene for every voice, so two voices can be told apart side by side. */
export const HEAR_SCENES = [
  'A woman returns a borrowed coat to a neighbour she has wronged. Neither of them mentions what happened. About 250 words.',
  'A night-shift guard finds a door open that he locked an hour ago. About 250 words.',
  'Three old friends meet at a funeral and disagree about whether the dead man was happy. About 250 words, mostly dialogue.',
];

/** A test passage: the voice exactly as the writer gets it, on a fixed scene. */
export function hearPrompt(voiceText: string, craft: string, scene: string): ChatMessage[] {
  return [
    { role: 'system', content: [craft, voiceText].filter((x) => x.trim()).join('\n\n') },
    { role: 'user', content: `Write this scene as a self-contained passage, prose only, no title: ${scene}` },
  ];
}

// ---------------------------------------------------------------------------
// Characters' voices

/** Lines they might say, one per line in the field. */
export const sayingsOf = (c: Character): string[] => String((c.data as Record<string, unknown>).sayings ?? '').split('\n').map((l) => l.trim().replace(/^[-•]\s*/, '')).filter(Boolean);

/** Who they play like, for the writer: the performance, not the source's story. Empty when they have no inspiration or it is kept off the page. */
export function playsLike(c: Character): string {
  const who = c.data.inspiredBy?.trim();
  if (!who || c.data.playsLike === false) return '';
  return `Plays like ${who}: their manner, rhythm, energy and way of talking, carried into this story. Never their lines, catchphrases, name or story.`;
}

const voiced = (c: Character) => !!(c.voice.trim() || sayingsOf(c).length || playsLike(c));

/** Named in a text: the full name anywhere, or the first name as a capitalised word ("Will", never "will"). */
export function namedIn(text: string, c: Pick<Character, 'name'>): boolean {
  const full = c.name.trim();
  if (!full) return false;
  if (text.toLowerCase().includes(full.toLowerCase())) return true;
  const first = full.split(/\s+/)[0] ?? '';
  return first.length >= 3 && new RegExp(`(^|[^\\p{L}])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(text);
}

/**
 * The people whose voices the next passage needs: those named in the last
 * passage first, then in the recent ones, then the ones present in the scene;
 * the cast when nothing names anyone yet. Only people with a voice to keep.
 */
export function voicesInScene(o: { cast: Character[]; people: Character[]; last: string; recent: string; present?: string[]; max?: number }): Character[] {
  const all = [...o.cast, ...o.people.filter((p) => !o.cast.some((c) => c.id === p.id))].filter(voiced);
  const present = (o.present ?? []).join('\n');
  const score = (c: Character) => (namedIn(o.last, c) ? 3 : 0) + (namedIn(o.recent, c) ? 2 : 0) + (present && namedIn(present, c) ? 2 : 0);
  const ranked = all.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
  const out = ranked.length ? ranked : o.recent.trim() ? [] : o.cast.filter(voiced);
  return out.slice(0, o.max ?? 5);
}

/** The reminder of every voice in the scene, said right before the passage. */
export function renderVoices(cs: Character[]): string {
  if (!cs.length) return '';
  const line = (c: Character) => {
    const voice = c.voice.trim().replace(/\s+/g, ' ').replace(/[.;\s]+$/, '');
    const lines = sayingsOf(c).slice(0, 2).map((l) => `“${l.replace(/^["“]|["”]$/g, '')}”`);
    const who = c.data.inspiredBy?.trim() && c.data.playsLike !== false ? `plays like ${c.data.inspiredBy.trim()}` : '';
    return `- ${c.name}: ${[who, voice.length > 220 ? `${voice.slice(0, 220).trimEnd()}…` : voice, lines.length ? `sounds like ${lines.join(' / ')}` : ''].filter(Boolean).join('; ')}`;
  };
  return `Voices in this scene: every line of dialogue and every gesture should sound like the person it belongs to, never like the narrator or each other.\n${cs.map(line).join('\n')}`;
}
