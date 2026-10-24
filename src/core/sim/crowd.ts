import type { WorldCalendar } from '../world/types';
import { hourOfDay } from '../world/calendar';
import { hash, pick, rng } from './rng';
import { CROWD, LOOKS, STAFFED, rolesFor } from './kit';
import type { Actor, Face, Kit, Place, SimState } from './types';

/**
 * Who is where. Named people follow daily rounds (sleep at home, work their
 * shift, an evening haunt), worked out from the clock rather than stepped, so
 * a world of hundreds costs nothing. Everyone else is a crowd: a count that
 * rises and falls with the place and the hour, and a few faces drawn from it
 * that stay the same for the same place and hour. A face becomes a person,
 * with a name that sticks and a memory of the player, when the player deals
 * with them.
 */
export function whereIs(a: Actor, state: Pick<SimState, 'clock' | 'here'>, cal?: WorldCalendar): string | null {
  if (a.status === 'gone') return null;
  if (a.status === 'dead') return a.at || null;
  if (a.follows) return state.here;
  if (a.at !== undefined && (a.until == null || a.until > state.clock)) return a.at || null;
  const h = hourOfDay(cal, state.clock);
  const w = (hash(a.id) % 60) / 60;
  const at = (lo: number, hi: number) => (lo < hi ? h >= lo + w && h < hi + w : h >= lo + w || h < hi + w);
  if (a.work && a.shift === 'day' && at(8, 18)) return a.work;
  if (a.work && a.shift === 'night' && at(16, 2)) return a.work;
  const asleep = a.shift === 'night' ? at(3, 11) : at(23, 6.5);
  if (asleep) return a.home ?? a.at ?? null;
  if (a.haunt && at(18, 23)) return a.haunt;
  return a.home ?? a.haunt ?? a.at ?? a.work ?? null;
}

/** The named people at a place now, the dead included (they are where they fell). */
export function peopleAt(state: SimState, placeId: string, cal?: WorldCalendar): Actor[] {
  return Object.values(state.actors).filter((a) => whereIs(a, state, cal) === placeId);
}

/** How lively a place is at this hour: 1 in the working day, 0 deep in the night, ramps between. */
function dayness(h: number): number {
  if (h >= 9 && h < 17) return 1;
  if (h >= 17 && h < 22) return 1 - (h - 17) / 5;
  if (h >= 6 && h < 9) return (h - 6) / 3;
  return 0;
}

/** About how many people are here now, named or not. */
export function crowdAt(state: SimState, place: Place, cal?: WorldCalendar): number {
  const [day, night] = CROWD[place.venue];
  const h = hourOfDay(cal, state.clock);
  let n = night + (day - night) * dayness(h);
  if (h >= 2 && h < 6) n *= 0.3;
  const r = rng(hash(state.seed, 'crowd', place.id, Math.floor(state.clock / 120)));
  n *= 0.8 + r() * 0.4;
  return Math.max(0, Math.round(n));
}

/** How many faces stand out from a crowd of this size. */
export function faceCount(crowd: number): number {
  return Math.min(6, Math.round(Math.log2(crowd + 1)));
}

/** The faces in the crowd here now: the same for the same place and two-hour stretch, minus those already met. */
export function facesAt(state: SimState, kit: Kit, place: Place, cal?: WorldCalendar): Face[] {
  const bucket = Math.floor(state.clock / 120);
  const n = faceCount(crowdAt(state, place, cal));
  const roles = rolesFor(kit, place.venue);
  const pool = STAFFED.has(place.venue) && roles.length > 1 ? roles.slice(1) : roles;
  const out: Face[] = [];
  for (let i = 0; i < n; i++) {
    const key = `f:${place.id}:${bucket}:${i}`;
    if (state.met[key]) continue;
    out.push(faceFor(state.seed, kit, key, pool));
  }
  return out;
}

/** A face from its key, again and again the same. */
export function faceFor(seed: number, kit: Kit, key: string, roles: string[]): Face {
  const r = rng(hash(seed, key));
  const name = `${pick(r, kit.given)}${r() < 0.5 ? ` ${pick(r, kit.family)}` : ''}`;
  return { key, name, role: pick(r, roles.length ? roles : ['local']), look: pick(r, LOOKS), staff: false };
}

/** The place a face key belongs to. */
export function faceKeyPlace(key: string): string | null {
  const m = /^f:(.+):(\d+):(\d+)$/.exec(key);
  return m ? m[1]! : null;
}

/** Everyone the player can see here: the people, then the faces in the crowd, then how many more. */
export function sceneAt(state: SimState, kit: Kit, cal?: WorldCalendar): { place: Place; people: Actor[]; faces: Face[]; crowd: number } | null {
  const place = state.places[state.here];
  if (!place) return null;
  const people = peopleAt(state, place.id, cal);
  const crowd = Math.max(people.filter((a) => a.status !== 'dead').length, crowdAt(state, place, cal));
  return { place, people, faces: facesAt(state, kit, place, cal), crowd };
}
