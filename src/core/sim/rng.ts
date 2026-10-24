/**
 * Seeded randomness, so the world is the same every time it is looked at:
 * the same faces in the same tavern at the same hour, the same stock on the
 * same day. Nothing here is stored; it is all recomputed from the seed.
 */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A generator of numbers in [0, 1) from a seed (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length) % list.length]!;
}

export function between(r: () => number, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}
