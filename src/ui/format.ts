export function shortModel(id: string): string {
  if (!id) return 'no model';
  const tail = id.split('/').pop() ?? id;
  return tail.replace(/:.*$/, '');
}

export function relTime(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function usd(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function kTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
