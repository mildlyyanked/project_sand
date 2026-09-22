import type { Style } from './types';
import { repeatedPhrases } from './repetition';

export interface DriftReport {
  /** 0 = on voice, 1 = fully drifted. */
  score: number;
  notes: string[];
}

const FILLER = ['delve', 'tapestry', 'testament to', 'a sense of', 'palpable', 'shivers down', 'couldn\'t help but', 'in a way that', 'it was as if', 'the air was thick'];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

function stats(text: string) {
  const s = sentences(text);
  const words = text.split(/\s+/).filter(Boolean);
  const avgLen = s.length ? words.length / s.length : 0;
  const dialogue = (text.match(/["“”]/g)?.length ?? 0) / Math.max(1, words.length);
  const adverbs = words.filter((w) => /ly[.,;:!?"”]*$/.test(w)).length / Math.max(1, words.length);
  return { avgLen, dialogue, adverbs, words: words.length };
}

/**
 * Cheap, local drift heuristic: compares the recent passage against the style
 * card's sample passages (if any) and flags banned phrases and common
 * model-default filler. Never blocks anything; it only informs.
 */
export function voiceDrift(recent: string, style: Style | null, earlier = ''): DriftReport {
  const notes: string[] = [];
  if (!recent.trim()) return { score: 0, notes };
  let score = 0;
  const lower = recent.toLowerCase();
  const repeats = repeatedPhrases(recent, earlier);
  if (repeats.length) {
    notes.push(`Repeated: ${repeats.map((r) => `“${r}”`).join(', ')}`);
    score += Math.min(0.3, repeats.length * 0.08);
  }
  const banned = (style?.bannedPhrases ?? []).filter((p) => p && lower.includes(p.toLowerCase()));
  if (banned.length) {
    notes.push(`Banned: ${banned.join(', ')}`);
    score += Math.min(0.5, banned.length * 0.2);
  }
  const filler = FILLER.filter((f) => lower.includes(f));
  if (filler.length) {
    notes.push(`Filler: ${filler.join(', ')}`);
    score += Math.min(0.3, filler.length * 0.1);
  }
  const samples = style?.samples.join('\n') ?? '';
  if (samples.trim().length > 200) {
    const a = stats(recent);
    const b = stats(samples);
    const lenDiff = Math.abs(a.avgLen - b.avgLen) / Math.max(1, b.avgLen);
    if (lenDiff > 0.4) {
      notes.push(a.avgLen > b.avgLen ? 'Sentences running long' : 'Sentences running short');
      score += Math.min(0.3, lenDiff * 0.3);
    }
    const dlg = Math.abs(a.dialogue - b.dialogue);
    if (dlg > 0.03) {
      notes.push(a.dialogue > b.dialogue ? 'More dialogue than the samples' : 'Less dialogue than the samples');
      score += 0.15;
    }
    if (a.adverbs > b.adverbs * 1.8 && a.adverbs > 0.03) {
      notes.push('Adverb-heavy');
      score += 0.1;
    }
  }
  return { score: Math.min(1, score), notes };
}
