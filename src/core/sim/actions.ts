import type { PovState, WorldCalendar } from '../world/types';
import { formatDuration } from '../world/calendar';
import { normName } from '../world/drafts';
import { findPlace, route, canStash } from './ops';
import { whereIs } from './crowd';
import { sellOffer, stockOf } from './economy';
import type { Kit, Resolution, SimAction, SimState } from './types';

/**
 * Tapped actions, settled by the rules alone: walking somewhere, waiting,
 * resting, buying and selling, a shift's work, a bed, a house, picking
 * something up, storing it. No model call; the narrator only tells it.
 */
export function resolveAction(sim: SimState, pov: PovState, a: SimAction, o: { kit: Kit; currency: string; calendar?: WorldCalendar }): Resolution {
  const cur = o.currency || 'coins';
  const here = sim.places[sim.here];
  const keeper = here ? Object.values(sim.actors).find((x) => x.staff && x.work === here.id) : undefined;
  const open = !!keeper && whereIs(keeper, sim, o.calendar) === here?.id && keeper.status === 'ok';
  const no = (action: string, outcome: string): Resolution => ({ action, outcome, ops: [] });
  switch (a.kind) {
    case 'go': {
      const to = findPlace(sim, a.to);
      if (!to) return no('You look for the way', 'There is no such place you know of.');
      const way = route(sim, sim.here, to.id);
      const via = way?.via.map((v) => sim.places[v]?.name).filter(Boolean) ?? [];
      return { action: `You head for ${to.name}.`, outcome: `You make your way to ${to.name}${via.length ? `, by way of ${via.join(', ')}` : ''}: ${formatDuration(way?.minutes ?? 5)} on the way. Describe arriving, and what meets you there.`, ops: [{ op: 'go', to: to.id }] };
    }
    case 'wait': {
      const m = Math.max(5, Math.min(720, Math.round(a.minutes)));
      return { action: `You wait ${formatDuration(m)}.`, outcome: `${formatDuration(m)} pass. Show what changes around you while you wait: who comes and goes, how the place shifts with the hour.`, ops: [{ op: 'time', minutes: m }] };
    }
    case 'rest': {
      const h = Math.max(1, Math.min(12, Math.round(a.hours)));
      const bed = (sim.lodging?.place === sim.here && sim.lodging.until > sim.clock) || here?.owner === 'player';
      const ops: Resolution['ops'] = [{ op: 'time', minutes: h * 60, resting: true }];
      if (!bed) ops.push({ op: 'vital', resource: 'energy', delta: -Math.round(h * 4) });
      return { action: `You rest for ${h} hour${h > 1 ? 's' : ''}.`, outcome: bed ? `You sleep ${h} hours in a bed of your own and wake rested.` : `You rest ${h} hours where you can, badly: no bed, half an ear open${(here?.danger ?? 0) >= 3 ? ', and this place is not safe' : ''}. You wake stiff.`, ops };
    }
    case 'buy': {
      const t = sim.things[a.thing];
      if (!t || t.price == null || t.holder !== sim.here || t.qty <= 0) return no('You look to buy', 'That is not for sale here.');
      if (!open) return no(`You try to buy ${t.name}.`, 'Nobody is behind the counter; the place is shut at this hour.');
      if (pov.money < t.price) return no(`You try to buy ${t.name}.`, `${keeper!.name} wants ${t.price} ${cur} for ${t.name}; you have ${pov.money}. No sale.`);
      return { action: `You buy ${t.name}.`, outcome: `${keeper!.name} sells you ${t.name} for ${t.price} ${cur}.`, speaker: keeper!.id, ops: [{ op: 'money', amount: -t.price, note: t.name }, { op: 'gain', item: t.name, qty: 1, from: sim.here }, { op: 'time', minutes: 3 }] };
    }
    case 'sell': {
      const has = pov.inventory.find((i) => normName(i.name) === normName(a.item));
      if (!has || !here) return no('You look for something to sell', 'You have nothing like that.');
      if (!open) return no(`You try to sell ${has.name}.`, 'Nobody is here to buy; the place is shut at this hour.');
      const offer = sellOffer(o.kit, sim, here, has.name, has.itemId);
      if (!offer) return no(`You offer ${has.name}.`, `${keeper!.name} shakes their head: they do not deal in that.`);
      return { action: `You sell ${has.name}.`, outcome: `${keeper!.name} buys ${has.name} for ${offer} ${cur}.`, speaker: keeper!.id, ops: [{ op: 'lose', item: has.name, qty: 1, to: sim.here }, { op: 'money', amount: offer, note: `sold ${has.name}` }, { op: 'time', minutes: 3 }] };
    }
    case 'work': {
      const w = here?.work;
      if (!w || !here) return no('You look for work', 'There is no work going here.');
      if (pov.resources.energy < 15) return no(`You ask for work at ${here.name}.`, 'You are too spent to do a shift; you would collapse. Rest first.');
      return { action: `You take a shift ${w.role} at ${here.name}.`, outcome: `You work ${w.hours} hours ${w.role}${keeper ? ` for ${keeper.name}` : ''} and are paid ${w.pay} ${cur}. Show the work in a few strokes and one thing you notice while doing it.`, speaker: keeper?.id ?? null, ops: [{ op: 'time', minutes: w.hours * 60 }, { op: 'vital', resource: 'energy', delta: -w.hours * 5 }, { op: 'money', amount: w.pay, note: w.role }] };
    }
    case 'rent': {
      const price = here?.lodging;
      if (!price || !here) return no('You ask for a bed', 'There are no beds to be had here.');
      const nights = Math.max(1, Math.min(30, Math.round(a.nights)));
      const total = price * nights;
      if (pov.money < total) return no(`You ask for a bed for ${nights} night${nights > 1 ? 's' : ''}.`, `A bed is ${price} ${cur} a night; ${nights} nights come to ${total} and you have ${pov.money}.`);
      return { action: `You take a bed at ${here.name}.`, outcome: `You pay ${total} ${cur}${keeper ? ` to ${keeper.name}` : ''} for a bed, ${nights} night${nights > 1 ? 's' : ''}.`, speaker: keeper?.id ?? null, ops: [{ op: 'money', amount: -total, note: 'lodging' }, { op: 'lodge', place: here.id, nights }, { op: 'time', minutes: 5 }] };
    }
    case 'buyPlace': {
      if (!here?.forSale) return no('You ask about buying the place', 'It is not for sale.');
      if (pov.money < here.forSale) return no(`You ask about buying ${here.name}.`, `${here.name} is for sale at ${here.forSale} ${cur}; you have ${pov.money}.`);
      return { action: `You buy ${here.name}.`, outcome: `You pay ${here.forSale} ${cur} and ${here.name} is yours: keys, papers, and every creak in it.`, ops: [{ op: 'money', amount: -here.forSale, note: here.name }, { op: 'own', place: here.id }, { op: 'time', minutes: 30 }] };
    }
    case 'take': {
      const t = sim.things[a.thing];
      if (!t || t.holder !== sim.here || t.price != null || (t.stashed && !canStash(sim))) return no('You reach for it', 'It is not there to take.');
      return { action: `You take ${t.name}.`, outcome: `You pick up ${t.name}.`, ops: [{ op: 'gain', item: t.name, qty: t.qty, from: sim.here }, { op: 'time', minutes: 1 }] };
    }
    case 'stash': {
      if (!canStash(sim)) return no('You look for somewhere to keep it', 'You have no place of your own here to keep things.');
      return { action: `You put ${a.item} away.`, outcome: `You store ${a.item} here.`, ops: [{ op: 'stash', item: a.item }, { op: 'time', minutes: 2 }] };
    }
    case 'unstash': {
      const t = sim.things[a.thing];
      if (!t || !t.stashed || t.holder !== sim.here) return no('You look for it', 'It is not here.');
      return { action: `You take ${t.name} from your things.`, outcome: `You take ${t.name} from where you keep it.`, ops: [{ op: 'unstash', item: t.name }, { op: 'time', minutes: 1 }] };
    }
  }
}

/** What the scene bar offers here: a shop, work, a bed, a sale, a stash. */
export function services(sim: SimState, cal?: WorldCalendar) {
  const here = sim.places[sim.here];
  if (!here) return null;
  const keeper = Object.values(sim.actors).find((x) => x.staff && x.work === here.id);
  const open = !!keeper && whereIs(keeper, sim, cal) === here.id && keeper.status === 'ok';
  return {
    keeper: keeper ?? null,
    open,
    stock: here.shop ? stockOf(sim, here.id) : [],
    work: here.work ?? null,
    lodging: here.lodging ?? null,
    forSale: here.forSale ?? null,
    stash: canStash(sim) ? Object.values(sim.things).filter((t) => t.holder === here.id && t.stashed) : null,
    lying: Object.values(sim.things).filter((t) => t.holder === here.id && t.price == null && !t.stashed),
  };
}
