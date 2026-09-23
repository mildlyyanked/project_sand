import type { GenerationParams, RepetitionLevel } from './types';

/**
 * Sampler penalties for each anti-repetition level. These shape the output
 * without a word of instruction in the prompt. Not every provider honors every
 * knob; OpenRouter drops the ones a model does not support.
 *
 * Frequency and repetition penalties grow with how often a token has appeared,
 * so over a long passage they hit the most frequent tokens first: articles,
 * then commas and full stops. The result is telegraphic prose sliding into one
 * run-on sentence. They stay tiny here. Presence penalty is a one-time nudge
 * per token and is the safe lever.
 */
export const REPETITION_PENALTIES: Record<RepetitionLevel, Pick<GenerationParams, 'frequencyPenalty' | 'presencePenalty' | 'repetitionPenalty'>> = {
  off: {},
  light: { presencePenalty: 0.15 },
  medium: { presencePenalty: 0.3, frequencyPenalty: 0.04 },
  strong: { presencePenalty: 0.45, frequencyPenalty: 0.08, repetitionPenalty: 1.03 },
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

const ARTICLES = /^(the|a|an|and|of|to|in|his|her|their|with|at|on|it|was|is)$/i;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?…"”])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Penalty degeneration shows up as a sentence that never ends, or as a run of
 * sentences with no function words. Returns the character offset where the
 * passage starts to break down, or -1 when it reads normally.
 */
export function degenerationOnset(text: string): number {
  const sentences = sentencesOf(text);
  if (sentences.length < 4) return -1;
  let offset = 0;
  let sparseRun = 0;
  let sparseStart = -1;
  for (const sentence of sentences) {
    const idx = text.indexOf(sentence, offset);
    const words = sentence.split(/\s+/).filter(Boolean);
    const functionWords = words.filter((w) => ARTICLES.test(w.replace(/[^a-z']/gi, ''))).length;
    // A single sentence beyond ~90 words with almost no commas is the run-on phase.
    if (words.length > 90 && (sentence.match(/,/g)?.length ?? 0) < words.length / 40) return sparseStart >= 0 ? sparseStart : idx;
    // Three long sentences in a row with almost no function words is the telegraphic phase.
    if (words.length >= 12 && functionWords / words.length < 0.09) {
      if (sparseRun === 0) sparseStart = idx;
      sparseRun++;
      if (sparseRun >= 3) return sparseStart;
    } else {
      sparseRun = 0;
      sparseStart = -1;
    }
    offset = idx + sentence.length;
  }
  return -1;
}

/** Cut a degenerate tail off, keeping the passage only if enough of it is sound. */
export function trimDegenerate(text: string): { text: string; trimmed: boolean } {
  const at = degenerationOnset(text);
  if (at < 0) return { text, trimmed: false };
  const head = text.slice(0, at).trimEnd();
  if (head.length < text.length * 0.35 || head.length < 300) return { text, trimmed: false };
  return { text: head, trimmed: true };
}
