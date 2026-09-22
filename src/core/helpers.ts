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

export function parsePremises(text: string): string[] {
  return text
    .split(/\n(?=\s*\d+[.)]\s)/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((s) => s.length > 20);
}

/** Conversational workshop: the helper interviews the writer toward a premise. */
export function workshopSystem(o: { universe: Universe | null; characters: Character[]; style: Style | null }): ChatMessage {
  const ctx = [
    o.universe ? `World: ${o.universe.name}\n${o.universe.description}` : '',
    o.characters.length ? `Characters on hand:\n${o.characters.map((c) => `- ${c.name}: ${c.summary || c.voice}`).join('\n')}` : '',
    o.style ? `Style the story will use:\n${renderStyle(o.style)}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    role: 'system',
    content: [
      'You are a story editor workshopping a premise with a writer, in conversation. Your job is to draw out what they actually want to write, not to pitch at them.',
      'Rules:',
      '- Ask one question at a time, occasionally two. Short, specific, curious. Build on what they said.',
      '- Reflect back what you are hearing in a sentence when it helps, then ask the next thing.',
      '- Cover, over the conversation: the feeling they want the reader to have, the situation or image that started it, who it is about, what presses on that person, what they want to avoid, and how explicit or dark it should go.',
      '- Do not offer premises until the writer asks, or until you have enough that a premise would surprise them in a good way. Then give three to five, numbered 1. 2. 3., each two or three sentences: situation, pressure, hook. No titles.',
      '- After offering premises, keep talking: refine, merge, push. The writer may pick one at any point.',
      '- Never summarize the whole conversation unless asked. Never use headings or bullet lists in replies. Plain conversational prose.',
      ctx ? `\nContext for this story:\n${ctx}` : '',
    ].filter(Boolean).join('\n'),
  };
}

/** A compact record of what the workshop settled on, for the story's first note. */
export function workshopNotePrompt(transcript: ChatMessage[], premise: string): ChatMessage[] {
  return [
    { role: 'system', content: 'Condense a story workshop conversation into a note for the writer: the chosen premise, then the decisions and preferences that came up (tone, limits, what to avoid, what excites them), as 4 to 8 short lines. Output only the note.' },
    { role: 'user', content: `Chosen premise:\n${premise}\n\nConversation:\n${transcript.filter((m) => m.role !== 'system').map((m) => `${m.role === 'user' ? 'Writer' : 'Editor'}: ${m.content}`).join('\n\n')}` },
  ];
}
