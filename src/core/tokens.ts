/**
 * Cheap token estimate. Real counts come back in usage from OpenRouter and are
 * stored on the beat; this is only for budgeting before a request.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // English prose averages ~4 chars/token; punctuation-heavy text runs shorter.
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return Math.ceil(Math.max(chars / 4, words * 1.3));
}

export function trimToTokens(text: string, budget: number, fromEnd = false): string {
  if (estimateTokens(text) <= budget) return text;
  const approxChars = budget * 4;
  if (fromEnd) {
    const cut = text.slice(text.length - approxChars);
    const nl = cut.indexOf('\n');
    return nl > 0 && nl < cut.length / 3 ? cut.slice(nl + 1) : cut;
  }
  const cut = text.slice(0, approxChars);
  const nl = cut.lastIndexOf('\n');
  return nl > cut.length * 0.66 ? cut.slice(0, nl) : cut;
}
