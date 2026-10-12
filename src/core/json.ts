/**
 * JSON as models actually write it: fenced, prefaced with a sentence, with
 * literal newlines inside strings, a trailing comma, or a stray tab. Strict
 * parsing first; repairs only when it fails.
 */
export function lenientJson<T = unknown>(text: string): T | null {
  const unfenced = text.replace(/^[\s\S]*?```(?:json)?\s*/m, (m) => (text.includes('```') ? '' : m)).replace(/```[\s\S]*$/m, '');
  const src = unfenced.trim() || text.trim();
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = src.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {}
  try {
    return JSON.parse(repair(slice)) as T;
  } catch {
    return null;
  }
}

/** Escape control characters inside string literals and drop trailing commas. */
export function repair(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        out += ch;
        esc = true;
      } else if (ch === '"') {
        out += ch;
        inStr = false;
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    } else if (ch === '"') {
      out += ch;
      inStr = true;
    } else out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}
