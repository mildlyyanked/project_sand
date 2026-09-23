import type {
  AssembledContext,
  Beat,
  Character,
  ChatMessage,
  ContextLayer,
  ContextStrategy,
  LoreEntry,
  Preset,
  Session,
  Species,
  Style,
  Universe,
} from '../types';
import { estimateTokens, trimToTokens } from '../tokens';
import { alwaysOnLore, triggeredLore } from './lorebook';
import { renderCharacter, renderHeat, renderStyle } from './cards';

export interface AssembleInput {
  session: Session;
  /** Root-to-current path. */
  path: Beat[];
  preset: Preset | null;
  style: Style | null;
  characters: Character[];
  species: Species[];
  universe: Universe | null;
  lore: LoreEntry[];
  /** The model the request will go to; selects preset overrides. */
  model: string;
  /** Extra one-shot direction (regenerate with direction). */
  direction?: string;
  /** Pinned or dropped layer keys chosen in the inspector. */
  dropped?: Set<string>;
  /** A plan for this passage from the helper, sent as guidance. */
  plan?: string;
}

export function resolvePreset(preset: Preset | null, model: string): Pick<Preset, 'system' | 'prefill' | 'postHistory'> {
  if (!preset) return { system: '', prefill: '', postHistory: '' };
  let out = { system: preset.system, prefill: preset.prefill, postHistory: preset.postHistory };
  for (const [pattern, ov] of Object.entries(preset.modelOverrides)) {
    const hit = pattern.endsWith('*') ? model.startsWith(pattern.slice(0, -1)) : model === pattern;
    if (hit) out = { ...out, ...ov };
  }
  return out;
}

export const CRAFT_SYSTEM = [
  'You are a novelist continuing a manuscript. Write the next passage only: 400 to 900 words, one movement of the scene, ending on a turn or a held breath, never on a summary.',
  'Match the established voice and keep continuity with everything above.',
  'A passage must be legible on first read: at every moment it is clear where we are, who is present, what is happening and why. Prefer cause and effect over atmosphere, the concrete over the abstract. Introduce a new person with a name and one identifying detail before they act.',
  'Sentence fragments, portentous one-line paragraphs, stacked metaphors and vague menace are not a style unless the style card asks for them.',
  'No commentary, no headings, no notes, no summary.',
].join(' ');

export const OPENING_DIRECTIVE = 'This is the opening of the story. Start at the true beginning, before anything has gone wrong: establish the time, the place, the viewpoint character and the situation in concrete terms, let the reader meet the people who will matter, and end on the first hint of the disruption. Do not start in the middle of events.';

const DEFAULT_SYSTEM = CRAFT_SYSTEM;

/**
 * Split the path into: beats already covered by the summary, older beats not yet
 * summarized, and the verbatim recent window that fits the budget.
 */
export function splitPath(path: Beat[], session: Session, strategy: ContextStrategy) {
  const prose = path.filter((b) => b.role !== 'note');
  let start = 0;
  if (session.summaryUpToBeatId) {
    const i = prose.findIndex((b) => b.id === session.summaryUpToBeatId);
    if (i >= 0) start = i + 1;
  }
  const unsummarized = prose.slice(start);
  // Take from the end until the recent budget is spent.
  let used = 0;
  let cut = unsummarized.length;
  for (let i = unsummarized.length - 1; i >= 0; i--) {
    const t = estimateTokens(unsummarized[i]!.text);
    if (used + t > strategy.recentBudget && cut < unsummarized.length) break;
    used += t;
    cut = i;
    if (used > strategy.recentBudget) break;
  }
  const recent = unsummarized.slice(cut);
  const overflow = unsummarized.slice(0, cut);
  return { summarized: prose.slice(0, start), overflow, recent, recentTokens: used };
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const { session, path, preset, style, characters, species, universe, lore, model } = input;
  const strategy = session.strategy;
  const dropped = input.dropped ?? new Set<string>();
  const log: string[] = [];
  const layers: ContextLayer[] = [];
  const p = resolvePreset(preset, model);

  const push = (l: Omit<ContextLayer, 'tokens'>) => {
    const layer: ContextLayer = { ...l, tokens: estimateTokens(l.text), dropped: l.dropped || dropped.has(l.key) };
    layers.push(layer);
    return layer;
  };

  push({ key: 'system', label: 'System', role: 'system', text: p.system.trim() || DEFAULT_SYSTEM });
  if (style) push({ key: 'style', label: `Style · ${style.name}`, role: 'system', text: renderStyle(style) });
  if (characters.length) {
    const text = ['# Characters', ...characters.map((c) => renderCharacter(c, species.find((s) => s.id === c.speciesId)))].join('\n\n');
    push({ key: 'characters', label: `Characters · ${characters.length}`, role: 'system', text });
  }
  if (session.brief.trim()) push({ key: 'brief', label: 'Brief', role: 'system', text: `# The story\n${session.brief.trim()}` });
  if (universe) {
    const always = alwaysOnLore(lore);
    const text = [`# World: ${universe.name}`, universe.description.trim(), ...always.map((e) => `## ${e.title}\n${e.text}`)].filter(Boolean).join('\n\n');
    push({ key: 'universe', label: `World · ${universe.name}`, role: 'system', text, detail: always.length ? `${always.length} always-on entries` : undefined });
  }

  const { summarized, overflow, recent, recentTokens } = splitPath(path, session, strategy);
  log.push(`recent window: ${recent.length} beats, ~${recentTokens} tokens (budget ${strategy.recentBudget})`);

  if (lore.length) {
    const scan = recent.slice(-strategy.loreScanBeats).map((b) => b.text).join('\n');
    const hits = triggeredLore(lore, scan);
    if (hits.length) {
      let budget = strategy.loreBudget;
      const kept: LoreEntry[] = [];
      for (const h of hits) {
        const t = estimateTokens(h.text);
        if (t > budget) continue;
        budget -= t;
        kept.push(h);
      }
      log.push(`lore: ${hits.length} triggered, ${kept.length} kept (${hits.map((h) => h.title).join(', ')})`);
      if (kept.length) push({ key: 'lore', label: `Lore · ${kept.length} triggered`, role: 'system', text: kept.map((e) => `## ${e.title}\n${e.text}`).join('\n\n'), detail: kept.map((k) => k.title).join(', ') });
    } else log.push('lore: no keyword hits');
  }

  if (session.summary.trim()) {
    push({ key: 'summary', label: `Summary · ${summarized.length} beats`, role: 'system', text: `# Story so far\n${trimToTokens(session.summary, strategy.summaryBudget)}` });
  }
  if (overflow.length) {
    const t = overflow.reduce((n, b) => n + estimateTokens(b.text), 0);
    log.push(`${overflow.length} beats (~${t} tokens) exceed the recent budget and are not yet summarized`);
    push({ key: 'overflow', label: `Unsummarized · ${overflow.length} beats`, role: 'system', text: overflow.map((b) => b.text).join('\n\n'), dropped: true, detail: 'dropped: over budget, needs summarizing' });
  }

  // Recent beats: prose becomes assistant turns, instructions become user turns.
  const recentLayers: ContextLayer[] = [];
  for (const b of recent) {
    recentLayers.push(push({ key: `beat:${b.id}`, label: b.role === 'prose' ? 'Prose' : 'Instruction', role: b.role === 'prose' ? 'assistant' : 'user', text: b.text }));
  }

  const tail: string[] = [];
  const opening = !recent.some((b) => b.role === 'prose') && !session.summary.trim();
  if (opening) tail.push(OPENING_DIRECTIVE);
  if (input.plan?.trim()) tail.push(`Plan for this passage (follow it; do not restate it):\n${input.plan.trim()}`);
  if (p.postHistory.trim()) tail.push(p.postHistory.trim());
  if (session.explicit) tail.push(renderHeat(session.heat));
  if (input.direction?.trim()) tail.push(`Direction for this passage: ${input.direction.trim()}`);
  if (tail.length) push({ key: 'post', label: opening ? 'Opening directive' : 'Post-history', role: 'user', text: tail.join('\n\n') });
  if (p.prefill.trim()) push({ key: 'prefill', label: 'Prefill', role: 'assistant', text: p.prefill });

  // Fold into messages: consecutive system layers merge; conversation stays ordered.
  const messages: ChatMessage[] = [];
  for (const l of layers) {
    if (l.dropped) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === l.role && (l.role === 'system' || l.key.startsWith('beat:') && last.role === 'assistant')) {
      last.content += '\n\n' + l.text;
    } else messages.push({ role: l.role, content: l.text });
  }
  // A conversation must contain at least one user turn for most providers.
  if (!messages.some((m) => m.role === 'user')) {
    messages.push({ role: 'user', content: recent.length ? 'Continue the manuscript.' : 'Begin the manuscript.' });
  } else if (messages[messages.length - 1]?.role === 'assistant' && !p.prefill.trim()) {
    messages.push({ role: 'user', content: 'Continue the manuscript.' });
  }
  // Prefill must be the final assistant message.
  if (p.prefill.trim() && messages[messages.length - 1]?.role !== 'assistant') {
    messages.push({ role: 'assistant', content: p.prefill });
  }

  // Some providers drop or dilute the system role. Optionally deliver it as the opening exchange instead.
  if (preset?.systemAsUser && messages[0]?.role === 'system') {
    const sys = messages.shift()!;
    messages.unshift({ role: 'user', content: sys.content }, { role: 'assistant', content: 'Understood. I will continue the manuscript in that voice.' });
    log.push('system prompt delivered as the first user turn');
  }

  const totalTokens = layers.filter((l) => !l.dropped).reduce((n, l) => n + l.tokens, 0);
  log.push(`total ~${totalTokens} tokens in ${messages.length} messages`);
  return { layers, messages, totalTokens, log };
}

export function summaryPrompt(existing: string, beats: Beat[]): ChatMessage[] {
  const text = beats.filter((b) => b.role === 'prose').map((b) => b.text).join('\n\n');
  return [
    { role: 'system', content: 'You maintain a running summary of a story for the writer who continues it. Keep facts, names, relationships, open threads, tone, and the state of the current scene. Be specific and compact. Output only the updated summary.' },
    { role: 'user', content: `${existing.trim() ? `Current summary:\n${existing.trim()}\n\n` : ''}New passages to fold in:\n${text}\n\nWrite the updated summary.` },
  ];
}
