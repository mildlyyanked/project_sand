/**
 * Every fixed piece of prompt text the app sends, in one place, so it can be
 * read, edited in Settings, and iterated on in the lab. Presets and style cards
 * hold the per-story voice; these are the app's own scaffolding.
 */
export interface PromptTemplates {
  /** System prompt used when a session has no preset. Seeded presets start from it too. */
  craft: string;
  /** Added as the final user turn when the story has no prose yet. */
  opening: string;
  /** The ask appended when the last message would otherwise be the writer's own prose. */
  continueAsk: string;
  /** Prefix for the plan the helper wrote, sent as guidance. */
  planLead: string;
  /** System prompt for the helper when planning a passage. */
  plan: string;
  /** System prompt for the summarizer. */
  summary: string;
  /** System prompt for the editor in Critique and redo. */
  critique: string;
  /** System prompt for the Soften step of the persistence chain. */
  soften: string;
}

export const DEFAULT_TEMPLATES: PromptTemplates = {
  craft: [
    'You are a novelist continuing a manuscript. Write the next passage only: 400 to 900 words, one movement of the scene, ending on a turn or a held breath, never on a summary.',
    'Match the established voice and keep continuity with everything above.',
    'A passage must be legible on first read: at every moment it is clear where we are, who is present, what is happening and why. Prefer cause and effect over atmosphere, the concrete over the abstract. Introduce a new person with a name and one identifying detail before they act.',
    'Sentence fragments, portentous one-line paragraphs, stacked metaphors and vague menace are not a style unless the style card asks for them.',
    'No commentary, no headings, no notes, no summary.',
  ].join(' '),
  opening: 'This is the opening of the story. Start at the true beginning, before anything has gone wrong: establish the time, the place, the viewpoint character and the situation in concrete terms, let the reader meet the people who will matter, and end on the first hint of the disruption. Do not start in the middle of events.',
  continueAsk: 'Continue the manuscript.',
  planLead: 'Plan for this passage (follow it; do not restate it):',
  plan: 'You plan the next passage of a story for the writer who will draft it. Output at most 120 words of plain sentences, no headings or lists: where we are and who is present; what happens in this passage, in order; what has changed by its end; one concrete detail to anchor it; and what it must not do yet. Stay inside the brief. Do not write prose.',
  summary: 'You maintain a running summary of a story for the writer who continues it. Keep facts, names, relationships, open threads, tone, and the state of the current scene. Be specific and compact. Output only the updated summary.',
  critique: 'You are a demanding fiction editor. Critique the passage in at most eight short lines, each one specific and quoting the text where possible: what a first-time reader could not follow; continuity or logic errors against the brief and the previous passage; places the prose is doing generic things (fragments, portentous one-liners, stacked metaphors, vague menace, characters acting without setup); and, last, the single most important fix. No praise, no summary.',
  soften: 'You help a novelist plan the next passage. Rewrite the direction below as a brief working note in the manuscript\'s own register: concrete, in-world, present tense, describing what the next passage does and where it ends. Keep every element of the direction. No imperatives, no evaluative words, no mention of writing or readers. Output only the note.',
};

export const TEMPLATE_INFO: Record<keyof PromptTemplates, { label: string; hint: string }> = {
  craft: { label: 'Writer, default system prompt', hint: 'Used when a session has no preset. Presets replace it entirely.' },
  opening: { label: 'Opening directive', hint: 'Sent as the final user turn when the story has no prose yet.' },
  continueAsk: { label: 'Continue ask', hint: 'The plain ask when there is nothing else to say.' },
  planLead: { label: 'Plan lead-in', hint: 'Introduces the helper\'s plan in the request.' },
  plan: { label: 'Planner', hint: 'System prompt for the helper when planning a passage.' },
  summary: { label: 'Summarizer', hint: 'System prompt for folding older beats into the summary.' },
  critique: { label: 'Editor', hint: 'System prompt for Critique and redo.' },
  soften: { label: 'Soften step', hint: 'System prompt for rewriting an instruction as an author\'s note.' },
};

export function mergeTemplates(partial: Partial<PromptTemplates> | null | undefined): PromptTemplates {
  const out = { ...DEFAULT_TEMPLATES };
  if (!partial) return out;
  for (const k of Object.keys(DEFAULT_TEMPLATES) as (keyof PromptTemplates)[]) {
    const v = partial[k];
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
}
