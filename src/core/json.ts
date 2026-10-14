/**
 * JSON as models actually write it: fenced, prefaced with a sentence, with
 * literal newlines inside strings, a trailing comma, or a stray tab. Strict
 * parsing first; repairs only when it fails.
 */
export function lenientJson<T = unknown>(text: string): T | null {
  const unfenced = text.replace(/^[\s\S]*?```(?:json)?\s*/m, (m) => (text.includes('```') ? '' : m)).replace(/```[\s\S]*$/m, '');
  const src = unfenced.trim() || text.trim();
  const start = src.indexOf('{');
  if (start < 0) return null;
  const end = src.lastIndexOf('}');
  if (end > start) {
    const slice = src.slice(start, end + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {}
    try {
      return JSON.parse(repair(slice)) as T;
    } catch {}
  }
  // A reply cut off by the token limit: keep every value that arrived whole.
  try {
    return JSON.parse(closeTruncated(repair(src.slice(start)))) as T;
  } catch {
    return null;
  }
}

/**
 * Cut a truncated object back to its last complete value and close whatever
 * is still open. Complete JSON comes back unchanged.
 */
export function closeTruncated(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let cut = { pos: 0, stack: [] as string[] };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      cut = { pos: i + 1, stack: [...stack] };
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) return s.slice(0, i + 1);
      cut = { pos: i + 1, stack: [...stack] };
    } else if (ch === ',') cut = { pos: i, stack: [...stack] };
  }
  return s.slice(0, cut.pos) + cut.stack.reverse().join('');
}

/**
 * Escape control characters inside string literals, escape quotes a model left
 * bare inside a string (a quote that is not followed by , : } ] or the end),
 * and drop trailing commas.
 */
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
        const next = /\S/.exec(s.slice(i + 1))?.[0];
        if (next === undefined || ',:}]'.includes(next)) {
          out += ch;
          inStr = false;
        } else out += '\\"';
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
