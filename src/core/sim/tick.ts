import type { WorldCalendar } from '../world/types';
import { dayIndex } from '../world/calendar';
import { hash, pick, rng } from './rng';
import { ambientFor } from './kit';
import { peopleAt } from './crowd';
import { restock } from './economy';
import type { Kit, SimState } from './types';

/**
 * The world moving on by itself after a turn: a new day restocks the shops,
 * pays out what the player's businesses earn and lets lapsed beds go; leads
 * run out of time; people come and go on their rounds; and now and then the
 * place itself does something. Mutates `sim`; returns facts for the narrator
 * and chips for the screen.
 */
export function tick(sim: SimState, o: { kit: Kit; calendar?: WorldCalendar; currency: string; before: { clock: number; here: string } }): { facts: string[]; chips: string[]; money: number } {
  const facts: string[] = [];
  const chips: string[] = [];
  let money = 0;
  const today = dayIndex(o.calendar, sim.clock);
  if (today > sim.day) {
    const days = Math.min(30, today - sim.day);
    for (const p of Object.values(sim.places)) if (p.shop) restock(sim, p, o.kit, today);
    const businesses = Object.values(sim.places).filter((p) => p.owner === 'player' && (p.shop || p.work));
    if (businesses.length) {
      money = businesses.length * Math.round(o.kit.wage * 0.6) * days;
      facts.push(`Your ${businesses.length > 1 ? 'businesses earn' : `${businesses[0]!.name} earns`} ${money} ${o.currency || 'coins'}.`);
      chips.push(`+${money} ${o.currency || 'coins'} income`);
    }
    sim.day = today;
  }
  if (sim.lodging && sim.lodging.until <= sim.clock) {
    facts.push(`Your bed at ${sim.places[sim.lodging.place]?.name ?? 'the inn'} is no longer paid for.`);
    sim.lodging = null;
  }
  for (const l of sim.leads) {
    if (l.status === 'open' && l.deadline && l.deadline <= sim.clock) {
      l.status = 'failed';
      facts.push(`Time ran out on "${l.title}".`);
      chips.push(`Failed: ${l.title}`);
    }
  }
  // Comings and goings, when the player stayed put.
  if (o.before.here === sim.here) {
    const was = peopleAt({ ...sim, clock: o.before.clock }, sim.here, o.calendar).filter((a) => a.status !== 'dead').map((a) => a.id);
    const now = peopleAt(sim, sim.here, o.calendar).filter((a) => a.status !== 'dead');
    const left = was.filter((id) => !now.some((a) => a.id === id)).map((id) => sim.actors[id]?.name).filter(Boolean);
    const came = now.filter((a) => !was.includes(a.id)).map((a) => a.name);
    if (left.length) facts.push(`${left.join(', ')} ${left.length > 1 ? 'have' : 'has'} gone.`);
    if (came.length) facts.push(`${came.join(', ')} ${came.length > 1 ? 'have' : 'has'} arrived.`);
  }
  const place = sim.places[sim.here];
  if (place) {
    const r = rng(hash(sim.seed, 'ambient', place.id, Math.floor(sim.clock / 30)));
    const lines = ambientFor(o.kit, place.venue);
    if (lines.length && r() < 0.3) facts.push(`Around you, ${pick(r, lines)}.`);
  }
  return { facts, chips, money };
}
