import { formatDuration } from '../world/calendar';
import { hash, rng } from './rng';
import { findPath, scaleOf, SCALES, spotAt, terrainName, at, upScale, walkMinutes, type Scale } from './grid';
import { findPlace } from './ops';
import { facesAt, crowdAt } from './crowd';
import type { Kit, Resolution, SimState } from './types';
import type { WorldCalendar } from '../world/types';

/**
 * Moving on the map. Walking across a level, going into a place on it,
 * coming back out (up a scale), and travelling to somewhere known far off.
 * Plain moves are settled by rules and only logged; going in somewhere,
 * arriving somewhere new, and anything that happens on the way are
 * narrated. A walk can be interrupted: the longer and more dangerous, the
 * likelier someone or something stops you.
 */
export type MapAction =
  | { kind: 'walk'; x: number; y: number }
  | { kind: 'enter'; place: string }
  | { kind: 'leave'; to?: string }
  | { kind: 'travel'; to: string }
  | { kind: 'look' };

/** A map that has to be laid out before the move can happen. */
export type MapNeed = { mode: 'inside'; place: string; scale: Scale } | { mode: 'around'; place: string; scale: Scale };

export function mapNeeds(sim: SimState, a: MapAction): MapNeed[] {
  const here = sim.places[sim.here];
  if (!here) return [];
  const inside = (id: string): MapNeed[] => { const p = sim.places[id]; return p && !p.level ? [{ mode: 'inside', place: p.id, scale: scaleOf(p) }] : []; };
  switch (a.kind) {
    case 'look': case 'walk': return inside(here.id);
    case 'enter': { const p = findPlace(sim, a.place); return p ? inside(p.id) : []; }
    case 'travel': { const p = findPlace(sim, a.to); return p ? inside(p.id) : []; }
    case 'leave': {
      if (here.parent) return inside(here.parent);
      const up = upScale(scaleOf(here));
      return up ? [{ mode: 'around', place: here.id, scale: up }] : [];
    }
  }
}

export interface MapResolution extends Resolution {
  /** Worth a narrated passage: going in, somewhere new, something on the way. Otherwise a line in the journal. */
  narrate: boolean;
}

export function resolveMap(sim: SimState, a: MapAction, o: { kit: Kit; calendar?: WorldCalendar }): MapResolution {
  const here = sim.places[sim.here];
  const none = (action: string, outcome: string): MapResolution => ({ action, outcome, ops: [], narrate: false });
  if (!here) return none('You look about', 'You are nowhere the map knows.');
  const l = here.level;
  const pos = sim.pos ?? l?.entry ?? null;
  switch (a.kind) {
    case 'look':
      return { action: `You take in ${here.name}.`, outcome: `You look over ${here.name}: what is where, who is about.`, ops: [], narrate: false };
    case 'walk': {
      if (!l || !pos) return none('You look for the way', 'This place has no map yet.');
      const way = findPath(l, pos, { x: a.x, y: a.y });
      if (!way) return none('You look for a way across', `There is no way there from where you stand: ${terrainName(at(l, a.x, a.y))} in the way.`);
      if (!way.path.length) return none('You stay put', 'You are already there.');
      const spot = spotAt(sim, here.id, a.x, a.y);
      const r = rng(hash(sim.seed, 'enc', sim.clock, a.x, a.y));
      const chance = Math.min(0.4, way.path.length * 0.012 * (1 + here.danger) * (crowdAt(sim, here, o.calendar) > 20 ? 1.3 : 1));
      if (way.path.length >= 3 && r() < chance) {
        const stop = way.path[Math.floor(way.path.length / 2)]!;
        const part = findPath(l, pos, stop);
        const faces = facesAt(sim, o.kit, here, o.calendar);
        const what = here.danger >= 2 && r() < 0.5
          ? 'trouble: someone who looks like they mean you harm blocks the way'
          : faces.length ? `a ${faces[0]!.look} ${faces[0]!.role} steps into your path and wants a word` : 'something on the way makes you stop and look';
        return { action: `You set off${spot ? ` for ${spot.name}` : ''}.`, outcome: `Halfway, ${what}. Stop the walk there and let the player answer.`, ops: [{ op: 'step', x: stop.x, y: stop.y, minutes: walkMinutes(l, part?.cost ?? way.cost / 2) }], narrate: true };
      }
      const minutes = walkMinutes(l, way.cost);
      return { action: `You walk${spot ? ` to ${spot.name}` : ` ${terrainName(at(l, a.x, a.y)) === 'road' ? 'down the road' : 'across'}`} · ${formatDuration(minutes)}.`, outcome: spot ? `You reach the way into ${spot.name}.` : 'You get there.', ops: [{ op: 'step', x: a.x, y: a.y, minutes }], narrate: false };
    }
    case 'enter': {
      const p = findPlace(sim, a.place);
      if (!p || p.parent !== here.id) return none('You look for the way in', 'That is not here.');
      const ops: Resolution['ops'] = [];
      if (l && pos && p.x != null && p.y != null && (pos.x !== p.x || pos.y !== p.y)) {
        const way = findPath(l, pos, { x: p.x, y: p.y });
        if (!way) return none(`You look for a way to ${p.name}`, `There is no way to ${p.name} from where you stand.`);
        ops.push({ op: 'step', x: p.x, y: p.y, minutes: walkMinutes(l, way.cost) });
      }
      ops.push({ op: 'enter', place: p.id });
      return { action: `You go into ${p.name}.`, outcome: `You go into ${p.name}${p.visited ? '' : ', a place you have not been inside before'}. Describe what meets you as you come in: the space, who is there, what catches the eye.`, ops, narrate: true };
    }
    case 'leave': {
      const up = here.parent ? sim.places[here.parent] : undefined;
      const target = a.to ? findPlace(sim, a.to) : up;
      if (!target) return none('You look for a way out', 'There is nowhere further out.');
      return { action: `You leave ${here.name} for ${target.name}.`, outcome: `You come out of ${here.name} into ${target.name}.${target.visited ? '' : ' It is new to you: give a sense of its size and what lies around.'}`, ops: [{ op: 'leave', ...(a.to ? { to: target.id } : {}) }], narrate: !target.visited };
    }
    case 'travel': {
      const p = findPlace(sim, a.to);
      if (!p) return none('You think about where to go', 'There is no such place you know of.');
      return { action: `You travel to ${p.name}.`, outcome: `You make the journey to ${p.name}. Give the road in a line or two, then arriving: what meets you there.`, ops: [{ op: 'go', to: p.id }], narrate: true };
    }
  }
}

/** One journal line for a move that was not narrated. */
export function moveLine(res: Resolution, chips: string[]): string {
  const extra = chips.filter((c) => !c.startsWith('Walked')).join(' · ');
  return [res.action, extra].filter(Boolean).join(' ');
}

export function scaleLabel(s: Scale): string {
  return SCALES[s].label;
}
