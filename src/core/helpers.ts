import type { Character, ChatMessage, Style, Universe } from './types';
import { renderCharacter, renderStyle } from './context/cards';

/** Prompts for the helper model: scene generator, style analysis, reweave, wizard. */

export function scenePrompt(o: { universe: Universe | null; characters: Character[]; style: Style | null; summary: string; recent: string; wish?: string }): ChatMessage[] {
  const parts = [
    o.universe ? `World: ${o.universe.name}\n${o.universe.description}` : '',
    o.characters.length ? o.characters.map((c) => renderCharacter(c)).join('\n\n') : '',
    o.style ? renderStyle(o.style) : '',
    o.summary ? `Story so far:\n${o.summary}` : '',
    o.recent ? `Most recent passage:\n${o.recent}` : '',
    o.wish ? `The writer wants: ${o.wish}` : '',
  ].filter(Boolean);
  return [
    { role: 'system', content: 'You are a scene planner for a fiction writer. Propose the next scene as a compact plan: SETTING (one line), TENSION (what is at stake or unresolved), GOAL (what a character wants right now), TURN (how the scene could pivot), and OPENING (the first sentence or two, in the story\'s voice). Output only those five labelled lines.' },
    { role: 'user', content: parts.join('\n\n') || 'No context yet. Propose an opening scene.' },
  ];
}

export function styleFromSamplePrompt(sample: string): ChatMessage[] {
  return [
    { role: 'system', content: 'Analyze the passage and describe its style as a JSON object with keys: pointOfView, tense, proseDensity, dialogueRatio, register (one of clinical, euphemistic, blunt), vocabulary, influences (published writers this voice most resembles, with what it takes from each), bannedPhrases (array of phrases this voice would never use). Output only JSON.' },
    { role: 'user', content: sample },
  ];
}

export function premisePrompt(o: { genre: string; mood: string; seeds: string; universe: Universe | null; characters: Character[] }): ChatMessage[] {
  const ctx = [o.universe ? `World: ${o.universe.name}\n${o.universe.description}` : '', o.characters.length ? o.characters.map((c) => `${c.name}: ${c.summary}`).join('\n') : ''].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: 'You help a fiction writer find a premise. Offer five distinct premises. Each is 2 to 3 sentences: a situation, a pressure, and a hook. Number them 1 to 5. No titles, no commentary.' },
    { role: 'user', content: `Genre: ${o.genre || 'any'}\nMood: ${o.mood || 'any'}\nSeeds: ${o.seeds || 'none'}${ctx ? `\n\n${ctx}` : ''}` },
  ];
}

export function openingPrompt(premise: string, style: Style | null): ChatMessage[] {
  return [
    { role: 'system', content: `Write the opening passage of a story from the premise. 250 to 400 words. Start in scene, no preamble.${style ? `\n\n${renderStyle(style)}` : ''}` },
    { role: 'user', content: premise },
  ];
}

export function reweavePrompt(o: { original: string; edited: string; downstream: string }): ChatMessage[] {
  return [
    { role: 'system', content: 'A writer changed an earlier passage of a story. Rewrite the later passages with the minimum edits needed so they agree with the change. Keep everything that still works word for word. Preserve paragraph breaks. Output only the rewritten later passages, separated by a line containing exactly "---".' },
    { role: 'user', content: `Original passage:\n${o.original}\n\nChanged to:\n${o.edited}\n\nLater passages (separated by ---):\n${o.downstream}` },
  ];
}

/** Numbered premises in a reply. Only a real list counts: two or more items that each start with a number. */
export function parsePremises(text: string): string[] {
  const items = text
    .split(/\n(?=\s*\d+[.)]\s)/)
    .filter((s) => /^\s*\d+[.)]\s/.test(s))
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').replace(/\*\*/g, '').trim())
    .filter((s) => s.length > 20);
  return items.length >= 2 ? items : [];
}

/** Conversational workshop: the helper interviews the writer toward a full story brief. */
export function workshopSystem(o: { universe: Universe | null; characters: Character[]; style: Style | null }): ChatMessage {
  const ctx = [
    o.universe ? `World already chosen: ${o.universe.name}\n${o.universe.description}` : '',
    o.characters.length ? `Characters already chosen:\n${o.characters.map((c) => `- ${c.name}: ${c.summary || c.voice}`).join('\n')}` : '',
    o.style ? `Style already chosen:\n${renderStyle(o.style)}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    role: 'system',
    content: [
      'You are a story editor workshopping a new piece of fiction with a writer, in conversation. Your job is to draw out what they actually want to write and to make it concrete, not to pitch at them.',
      'You are working toward a brief with four parts: a premise with its ideas stated outright; the people in it, each with a rough setup; the world it happens in; and the voice it is told in.',
      'Rules:',
      '- Ask one question at a time, occasionally two. Short, specific, curious. Build on what they said and quote their own words back when useful.',
      '- Expect a long conversation. Do not rush. A good session runs ten or more exchanges before anything is settled.',
      '- Cover, in whatever order the conversation allows: the feeling the reader should be left with; the image or situation that started it; the protagonist and what presses on them; the other people who matter and what each wants; where and when this happens and what is strange or particular about that place; whose eyes we see through, in what tense, at what temperature of prose; how explicit or dark it should go and what to avoid; and what would make the writer bored.',
      '- When an area is thin, ask about it. When the writer gives you a person, ask for one concrete detail about them before moving on.',
      '- Offer premises only when asked, or once the feeling, the protagonist and the pressure are all clear. Then give three to five, numbered 1. 2. 3., each two or three sentences with the idea stated plainly. No titles. Keep asking afterwards; the writer may pick one at any point.',
      '- Never summarize the whole conversation unless asked. No headings, no bullet lists, no bold. Plain conversational prose.',
      ctx ? `\nAlready in place for this story (build on it, do not re-ask):\n${ctx}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export interface Brief {
  title: string;
  premise: string;
  ideas: string[];
  characters: { name: string; role: string; lifeStage: string; summary: string; voice: string; wants: string }[];
  world: { name: string; description: string } | null;
  style: { name: string; pointOfView: string; tense: string; register: 'clinical' | 'euphemistic' | 'blunt'; proseDensity: string; influences: string } | null;
  notes: string;
}

/** Ask the helper to compile the conversation into a structured brief. */
export function briefPrompt(transcript: ChatMessage[], chosenPremise: string | null): ChatMessage[] {
  const convo = transcript.filter((m) => m.role !== 'system').map((m) => `${m.role === 'user' ? 'Writer' : 'Editor'}: ${m.content}`).join('\n\n');
  return [
    { role: 'system', content: 'Compile a story workshop conversation into a brief as JSON. Be faithful to what the writer said; where they were silent, make one plausible, specific choice consistent with everything else and keep it modest. Output only JSON with this shape: {"title": string (2 to 5 words), "premise": string (3 to 5 sentences, the situation, the pressure, the hook), "ideas": string[] (the thematic ideas stated outright, 2 to 5 short lines), "characters": [{"name","role","lifeStage","summary","voice","wants"}] (every person who matters, 2 to 5), "world": {"name","description"} or null when the story is set in the ordinary present with nothing particular to say, "style": {"name","pointOfView","tense","register" (one of clinical, euphemistic, blunt),"proseDensity","influences"}, "notes": string (limits, what to avoid, what excites the writer, how explicit, as a few lines)}.' },
    { role: 'user', content: `${chosenPremise ? `The writer chose this premise:\n${chosenPremise}\n\n` : ''}Conversation:\n${convo}` },
  ];
}

export function parseBrief(text: string): Brief | null {
  const raw = text.replace(/^[\s\S]*?```(?:json)?/m, '').replace(/```[\s\S]*$/m, '').trim() || text.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as Partial<Brief>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const reg = (v: unknown): Brief['style'] extends infer S ? (S extends { register: infer R } ? R : never) : never => (v === 'clinical' || v === 'euphemistic' ? v : 'blunt');
    return {
      title: str(j.title) || 'Untitled',
      premise: str(j.premise),
      ideas: Array.isArray(j.ideas) ? j.ideas.map(str).filter(Boolean) : [],
      characters: Array.isArray(j.characters) ? j.characters.map((c) => ({ name: str(c?.name) || 'Unnamed', role: str(c?.role), lifeStage: str(c?.lifeStage), summary: str(c?.summary), voice: str(c?.voice), wants: str(c?.wants) })).filter((c) => c.name) : [],
      world: j.world && typeof j.world === 'object' && str((j.world as { name?: string }).name) ? { name: str((j.world as { name?: string }).name), description: str((j.world as { description?: string }).description) } : null,
      style: j.style && typeof j.style === 'object' ? { name: str((j.style as { name?: string }).name) || 'Story voice', pointOfView: str((j.style as { pointOfView?: string }).pointOfView), tense: str((j.style as { tense?: string }).tense), register: reg((j.style as { register?: string }).register), proseDensity: str((j.style as { proseDensity?: string }).proseDensity), influences: str((j.style as { influences?: string }).influences) } : null,
      notes: str(j.notes),
    };
  } catch {
    return null;
  }
}

export function briefNote(b: Brief): string {
  return [
    `Premise: ${b.premise}`,
    b.ideas.length ? `Ideas: ${b.ideas.join(' · ')}` : '',
    b.characters.length ? `People: ${b.characters.map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}${c.wants ? `, wants ${c.wants}` : ''}`).join('; ')}` : '',
    b.notes ? `Notes: ${b.notes}` : '',
  ].filter(Boolean).join('\n');
}

/** A compact record of what the workshop settled on, for the story's first note. */
export function workshopNotePrompt(transcript: ChatMessage[], premise: string): ChatMessage[] {
  return [
    { role: 'system', content: 'Condense a story workshop conversation into a note for the writer: the chosen premise, then the decisions and preferences that came up (tone, limits, what to avoid, what excites them), as 4 to 8 short lines. Output only the note.' },
    { role: 'user', content: `Chosen premise:\n${premise}\n\nConversation:\n${transcript.filter((m) => m.role !== 'system').map((m) => `${m.role === 'user' ? 'Writer' : 'Editor'}: ${m.content}`).join('\n\n')}` },
  ];
}

/** Ask the helper for a short plan before the writer drafts the passage. */
export function planPrompt(o: { brief: string; summary: string; recent: string; instruction?: string; opening: boolean; style: Style | null }): ChatMessage[] {
  return [
    { role: 'system', content: 'You plan the next passage of a story for the writer who will draft it. Output at most 120 words of plain sentences, no headings or lists: where we are and who is present; what happens in this passage, in order; what has changed by its end; one concrete detail to anchor it; and what it must not do yet. Stay inside the brief. Do not write prose.' },
    { role: 'user', content: [
      o.brief ? `Brief:\n${o.brief}` : '',
      o.style ? `Voice: ${[o.style.pointOfView, o.style.tense, o.style.register].filter(Boolean).join(', ')}` : '',
      o.summary ? `Story so far:\n${o.summary}` : '',
      o.recent ? `Most recent passage:\n${o.recent}` : '',
      o.instruction ? `The writer asks for: ${o.instruction}` : '',
      o.opening ? 'This is the opening passage: begin before anything goes wrong, introduce the people who matter, end on the first hint of trouble.' : 'Plan the next passage.',
    ].filter(Boolean).join('\n\n') },
  ];
}

/** A demanding editor's notes on one passage, used to regenerate it. */
export function critiquePrompt(o: { brief: string; style: Style | null; previous: string; passage: string }): ChatMessage[] {
  return [
    { role: 'system', content: 'You are a demanding fiction editor. Critique the passage in at most eight short lines, each one specific and quoting the text where possible: what a first-time reader could not follow; continuity or logic errors against the brief and the previous passage; places the prose is doing generic things (fragments, portentous one-liners, stacked metaphors, vague menace, characters acting without setup); and, last, the single most important fix. No praise, no summary.' },
    { role: 'user', content: [o.brief ? `Brief:\n${o.brief}` : '', o.style ? `Voice: ${renderStyle(o.style)}` : '', o.previous ? `Previous passage:\n${o.previous}` : '', `Passage to critique:\n${o.passage}`].filter(Boolean).join('\n\n') },
  ];
}
