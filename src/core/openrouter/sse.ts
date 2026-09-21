/** Incremental Server-Sent Events parser. Feed chunks, get complete `data:` payloads. */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = raw
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) out.push(data);
      }
      return out;
    },
    flush(): string[] {
      const rest = buffer;
      buffer = '';
      return rest.trim() ? this.push(rest + '\n\n') : [];
    },
  };
}
