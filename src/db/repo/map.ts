export const j = (v: unknown) => JSON.stringify(v);
export function pj<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
export const b = (v: number | null | undefined) => !!v;
export const ib = (v: boolean) => (v ? 1 : 0);
