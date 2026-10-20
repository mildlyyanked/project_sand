import type { Beat } from '../types';
import { normName } from './drafts';
import { namedIn } from './portraits';

/**
 * Who is in the scene at the end of a path, not only who the last passage
 * names. With the chronicle on, its running list of who is present decides;
 * without it, anyone named since the scene last moved, over the last few
 * passages. RN-free.
 */
export function inScene<T extends { name: string }>(path: Beat[], people: T[], o: { lookback?: number } = {}): { people: T[]; others: string[] } {
  let state = null as Beat['state'];
  for (let i = path.length - 1; i >= 0 && !state; i--) state = path[i]!.state;
  if (state?.present) {
    const found = people.filter((c) => state!.present!.some((n) => normName(n) === normName(c.name) || namedIn(n, c.name)));
    const others = state.present.filter((n) => !found.some((c) => normName(n) === normName(c.name) || namedIn(n, c.name)));
    return { people: found, others };
  }
  const here = state?.locationName ?? '';
  const prose: Beat[] = [];
  for (let i = path.length - 1; i >= 0 && prose.length < (o.lookback ?? 6); i--) {
    const b = path[i]!;
    if (b.state && here && b.state.locationName && normName(b.state.locationName) !== normName(here)) break;
    if (b.role === 'prose') prose.push(b);
  }
  return { people: people.filter((c) => prose.some((b) => namedIn(b.text, c.name))), others: [] };
}
