import type { GenerationParams, RepetitionLevel } from './types';

/**
 * Sampler penalties for each anti-repetition level. These shape the output
 * without a word of instruction in the prompt. Not every provider honors every
 * knob; OpenRouter drops the ones a model does not support.
 */
export const REPETITION_PENALTIES: Record<RepetitionLevel, Pick<GenerationParams, 'frequencyPenalty' | 'presencePenalty' | 'repetitionPenalty'>> = {
  off: {},
  light: { frequencyPenalty: 0.2, presencePenalty: 0.1, repetitionPenalty: 1.05 },
  medium: { frequencyPenalty: 0.45, presencePenalty: 0.3, repetitionPenalty: 1.1 },
  strong: { frequencyPenalty: 0.7, presencePenalty: 0.5, repetitionPenalty: 1.18 },
};

/** Session params win when set; otherwise the style's level fills the gaps. */
export function applyRepetition(params: GenerationParams, level: RepetitionLevel | undefined): GenerationParams {
  const p = REPETITION_PENALTIES[level ?? 'off'];
  return {
    ...params,
    frequencyPenalty: params.frequencyPenalty ?? p.frequencyPenalty,
    presencePenalty: params.presencePenalty ?? p.presencePenalty,
    repetitionPenalty: params.repetitionPenalty ?? p.repetitionPenalty,
  };
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'at', 'it', 'was', 'is', 'he', 'she', 'they', 'his', 'her', 'their', 'that', 'this', 'with', 'for', 'as', 'but', 'had', 'not', 'from', 'by', 'or', 'be', 'i', 'you']);

function ngrams(text: string, n: number): string[] {
  const words = text.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    const g = words.slice(i, i + n);
    if (g.every((w) => STOP.has(w))) continue;
    out.push(g.join(' '));
  }
  return out;
}

/**
 * Phrases of `n` words that the latest passage reuses from earlier passages,
 * or repeats within itself. Cheap and local; feeds the voice check.
 */
export function repeatedPhrases(latest: string, earlier: string, n = 3, limit = 5): string[] {
  const seen = new Set(ngrams(earlier, n));
  const counts = new Map<string, number>();
  for (const g of ngrams(latest, n)) counts.set(g, (counts.get(g) ?? 0) + 1);
  const hits: string[] = [];
  for (const [g, c] of counts) if (c > 1 || seen.has(g)) hits.push(g);
  return hits.slice(0, limit);
}
