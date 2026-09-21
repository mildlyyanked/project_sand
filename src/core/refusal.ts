const PATTERNS: RegExp[] = [
  /\bI(?:'m| am) (?:sorry|afraid)\b[^.]{0,80}\b(?:can(?:'t|not)|unable|won't)\b/i,
  /\bI (?:can(?:'t|not)|won't|am unable to|am not able to) (?:help|assist|write|continue|create|generate|produce|comply|fulfill)\b/i,
  /\b(?:as an AI|as a language model|as an assistant)\b/i,
  /\b(?:violates?|against) (?:my|our|the) (?:guidelines|policies|content policy|usage policy)\b/i,
  /\bI (?:must|have to|need to) (?:decline|refuse)\b/i,
  /\bnot (?:comfortable|appropriate) (?:for me )?to (?:write|continue|describe)\b/i,
  /\bI(?:'d| would) (?:prefer|rather) not\b/i,
];

/**
 * Heuristic refusal detector. A refusal is short, breaks voice, and talks about
 * the assistant instead of the story. Errs toward false negatives so genuine
 * prose with an apologetic character is not flagged.
 */
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const head = t.slice(0, 600);
  const hits = PATTERNS.filter((p) => p.test(head)).length;
  if (hits === 0) return false;
  // Long output with a single weak hit is probably prose.
  if (t.length > 1500 && hits < 2) return false;
  return true;
}
