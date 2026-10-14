/** Pictures kept on library entries, and who a passage names. RN-free. */
export interface EntryImageData { uri: string; prompt: string; model: string; at: number }

export function imageOf(data: Record<string, unknown> | undefined | null): EntryImageData | null {
  const v = data?.image as EntryImageData | undefined;
  return v && typeof v === 'object' && typeof v.uri === 'string' && v.uri ? v : null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a passage names someone: by full name, or by first name when it is distinctive enough. */
export function namedIn(text: string, name: string): boolean {
  const full = name.trim();
  if (!full) return false;
  const hit = (n: string) => new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, 'u').test(text);
  if (hit(full)) return true;
  const first = full.split(/\s+/)[0]!;
  return first.length >= 3 && first !== full && /^\p{Lu}/u.test(first) && hit(first);
}
