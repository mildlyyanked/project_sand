import type { Difficulty, PovState, Resource, WorldCalendar } from '../world/types';
import { RESOURCES, applyDelta, mergeInventory, passTime, removeFromInventory } from '../world/survival';
import { dayIndex, formatDuration } from '../world/calendar';
import { normName } from '../world/drafts';
import { LEG, STAFFED, rolesFor, venueOf } from './kit';
import { faceFor, faceKeyPlace, whereIs } from './crowd';
import { link, outfit, reveal, staffFor } from './seed';
import { restock, worth } from './economy';
import type { Actor, Kit, Lead, Place, SimOp, SimState } from './types';

/**
 * The one way the world changes. Every op is checked against the world as it
 * is (you cannot pay what you do not have, drop what you do not carry, or talk
 * to someone who is not there) and applied, and each leaves a chip for the
 * screen and a plain fact for the narrator. Pure: returns new state.
 */
export interface SimContext { kit: Kit; calendar?: WorldCalendar; difficulty: Difficulty; currency: string; playerName: string }

export interface Applied {
  sim: SimState;
  pov: PovState;
  chips: string[];
  facts: string[];
  /** Survival warnings crossed. */
  notes: string[];
  /** Worth keeping on the world's timeline. */
  events: { title: string; kind: 'event' | 'death' | 'travel' | 'item' | 'relation' | 'discovery'; who: string[]; importance: 1 | 2 | 3 }[];
  /** Ops that applied, refs resolved: what the passage keeps for replay. */
  applied: SimOp[];
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function findActor(sim: SimState, ref: string | undefined | null, cal?: WorldCalendar): Actor | undefined {
  if (!ref) return undefined;
  if (sim.actors[ref]) return sim.actors[ref];
  if (sim.met[ref]) return sim.actors[sim.met[ref]!];
  const n = normName(ref);
  const all = Object.values(sim.actors).filter((a) => a.status !== 'gone');
  const first = (a: Actor) => n.split(' ').length === 1 && normName(a.name).split(' ')[0] === n;
  const here = (a: Actor) => whereIs(a, sim, cal) === sim.here;
  return all.find((a) => normName(a.name) === n && here(a)) ?? all.find((a) => normName(a.name) === n) ?? all.find((a) => first(a) && here(a)) ?? (all.filter(first).length === 1 ? all.find(first) : undefined);
}

export function findPlace(sim: SimState, ref: string | undefined | null): Place | undefined {
  if (!ref) return undefined;
  if (sim.places[ref]) return sim.places[ref];
  const n = normName(ref);
  const all = Object.values(sim.places);
  return all.find((p) => normName(p.name) === n && p.known) ?? all.find((p) => normName(p.name) === n) ?? all.find((p) => p.known && (normName(p.name).includes(n) || n.includes(normName(p.name))) && n.length > 3);
}

/** Shortest way between two places, in minutes, with the places passed through. */
export function route(sim: SimState, from: string, to: string): { minutes: number; via: string[] } | null {
  if (from === to) return { minutes: 0, via: [] };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let cur = '';
    let best = Infinity;
    for (const id of open) { const d = dist.get(id)!; if (d < best) { best = d; cur = id; } }
    open.delete(cur);
    if (cur === to) break;
    for (const e of sim.places[cur]?.exits ?? []) {
      const nd = best + e.minutes;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); open.add(e.to); }
    }
  }
  if (!dist.has(to)) return null;
  const via: string[] = [];
  for (let p = prev.get(to); p && p !== from; p = prev.get(p)) via.unshift(p);
  return { minutes: dist.get(to)!, via };
}

/** The places a step away that the player knows: the ways out, what is inside, and what is next door, nearest first. */
export function nearbyPlaces(sim: SimState, placeId: string, max = 10): { place: Place; minutes: number }[] {
  const p = sim.places[placeId];
  if (!p) return [];
  const ids = new Set<string>(p.exits.map((e) => e.to));
  for (const q of Object.values(sim.places)) if (q.id !== p.id && (q.parent === p.id || (p.parent && q.parent === p.parent))) ids.add(q.id);
  return [...ids].map((id) => sim.places[id]).filter((q): q is Place => !!q && q.known)
    .map((q) => ({ place: q, minutes: route(sim, p.id, q.id)?.minutes ?? 0 }))
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, max);
}

export function applyOps(simIn: SimState, povIn: PovState, ops: SimOp[], ctx: SimContext): Applied {
  const sim = clone(simIn);
  let pov = clone(povIn);
  const out: Applied = { sim, pov, chips: [], facts: [], notes: [], events: [], applied: [] };
  const cur = ctx.currency || 'coins';
  const nextId = (p: string) => `${p}:${++sim.counter}`;
  const time = (minutes: number, resting = false) => {
    if (minutes <= 0) return;
    const r = passTime(pov, minutes, ctx.difficulty, resting);
    pov = r.state;
    out.notes.push(...r.notes);
    sim.clock += Math.round(minutes);
  };

  for (const raw of ops) {
    const op = raw as SimOp;
    switch (op.op) {
      case 'go': {
        const to = findPlace(sim, op.to);
        if (!to || to.id === sim.here) break;
        const way = route(sim, sim.here, to.id);
        const minutes = Math.max(1, Math.round(op.minutes ?? way?.minutes ?? LEG[to.venue]));
        if (!way) link(sim.places, sim.here, to.id, minutes);
        sim.here = to.id;
        reveal(sim.places, to.id);
        time(minutes);
        out.chips.push(`→ ${to.name} · ${formatDuration(minutes)}`);
        out.facts.push(`You went to ${to.name}${way?.via.length ? ` by way of ${way.via.map((v) => sim.places[v]?.name).filter(Boolean).join(', ')}` : ''} (${formatDuration(minutes)}).`);
        out.applied.push({ op: 'go', to: to.id, minutes });
        break;
      }
      case 'time': {
        const m = Math.max(0, Math.min(60 * 24 * 14, Math.round(op.minutes)));
        if (!m) break;
        time(m, op.resting);
        if (m >= 30) out.chips.push(`${op.resting ? 'Rested' : 'Time'} · ${formatDuration(m)}`);
        out.applied.push({ op: 'time', minutes: m, ...(op.resting ? { resting: true } : {}) });
        break;
      }
      case 'money': {
        let amount = Math.round(Number(op.amount) || 0);
        if (!amount) break;
        if (amount < 0 && -amount > pov.money) {
          out.facts.push(`You could not pay ${-amount} ${cur}: you have ${pov.money}.`);
          amount = -pov.money;
          if (!amount) break;
        }
        pov = { ...pov, money: pov.money + amount };
        out.chips.push(`${amount > 0 ? '+' : '−'}${Math.abs(amount)} ${cur}`);
        out.facts.push(`${amount > 0 ? 'You received' : 'You paid'} ${Math.abs(amount)} ${cur}${op.note ? ` (${op.note})` : ''}.`);
        out.applied.push({ op: 'money', amount, ...(op.note ? { note: op.note } : {}) });
        break;
      }
      case 'gain': {
        const qty = Math.max(1, Math.round(op.qty ?? 1));
        const name = op.item.trim();
        if (!name) break;
        // Taken from someone or somewhere: it leaves them.
        const from = op.from ? findActor(sim, op.from, ctx.calendar)?.id ?? findPlace(sim, op.from)?.id ?? (op.from === sim.here ? sim.here : undefined) : undefined;
        const src = Object.values(sim.things).find((t) => (from ? t.holder === from : t.holder === sim.here) && normName(t.name) === normName(name));
        if (src) { src.qty -= qty; if (src.qty <= 0) delete sim.things[src.id]; }
        pov = { ...pov, inventory: mergeInventory(pov.inventory, [{ name: src?.name ?? name, qty, ...(src?.libId ? { itemId: src.libId } : {}) }]) };
        out.chips.push(`+ ${qty > 1 ? `${qty} × ` : ''}${src?.name ?? name}`);
        out.facts.push(`You now have ${qty > 1 ? `${qty} × ` : ''}${src?.name ?? name}.`);
        out.applied.push({ op: 'gain', item: src?.name ?? name, qty, ...(from ? { from } : {}), ...(op.value ? { value: op.value } : {}), ...(op.category ? { category: op.category } : {}) });
        break;
      }
      case 'lose': {
        const qty = Math.max(1, Math.round(op.qty ?? 1));
        const has = pov.inventory.find((i) => normName(i.name) === normName(op.item)) ?? pov.inventory.find((i) => normName(i.name).includes(normName(op.item)) || normName(op.item).includes(normName(i.name)));
        if (!has) break;
        const n = Math.min(qty, has.qty);
        pov = { ...pov, inventory: removeFromInventory(pov.inventory, [{ name: has.name, qty: n }]) };
        const to = op.to ? findActor(sim, op.to, ctx.calendar)?.id ?? findPlace(sim, op.to)?.id : undefined;
        if (to) {
          const id = nextId('t');
          sim.things[id] = { id, name: has.name, category: 'other', value: worth(ctx.kit, sim, has.name, has.itemId), qty: n, holder: to, ...(has.itemId ? { libId: has.itemId } : {}) };
        }
        out.chips.push(`− ${n > 1 ? `${n} × ` : ''}${has.name}`);
        out.facts.push(`You no longer have ${n > 1 ? `${n} × ` : ''}${has.name}${to ? ` (now with ${sim.actors[to]?.name ?? sim.places[to]?.name})` : ''}.`);
        out.applied.push({ op: 'lose', item: has.name, qty: n, ...(to ? { to } : {}) });
        break;
      }
      case 'attitude': {
        const a = findActor(sim, op.who, ctx.calendar);
        const delta = Math.max(-2, Math.min(2, Math.round(Number(op.delta) || 0)));
        if (!a || !delta) break;
        pov = applyDelta(pov, { relations: [{ name: a.name, delta, note: op.note }] }).state;
        if (op.note) a.memory = [...a.memory, op.note].slice(-8);
        a.met = true;
        out.chips.push(`${a.name.split(' ')[0]} ${delta > 0 ? '▲' : '▼'}`);
        out.facts.push(`${a.name} now thinks ${delta > 0 ? 'better' : 'worse'} of you${op.note ? `: ${op.note}` : ''}.`);
        out.applied.push({ op: 'attitude', who: a.id, delta, ...(op.note ? { note: op.note } : {}) });
        break;
      }
      case 'remember': {
        const a = findActor(sim, op.who, ctx.calendar);
        if (!a || !op.note?.trim()) break;
        a.memory = [...a.memory, op.note.trim()].slice(-8);
        a.met = true;
        out.applied.push({ op: 'remember', who: a.id, note: op.note.trim() });
        break;
      }
      case 'meet': {
        const existing = findActor(sim, op.who, ctx.calendar);
        if (existing) {
          existing.met = true;
          if (op.traits && !existing.traits) existing.traits = op.traits;
          if (op.name && existing.made && normName(op.name) !== normName(existing.name)) existing.name = op.name;
          out.applied.push({ op: 'meet', who: existing.id, ...(op.name ? { name: existing.name } : {}), ...(op.traits ? { traits: op.traits } : {}) });
          break;
        }
        const placeId = faceKeyPlace(op.who);
        const place = placeId ? sim.places[placeId] : undefined;
        if (!place) break;
        const face = faceFor(sim.seed, ctx.kit, op.who, STAFFED.has(place.venue) ? rolesFor(ctx.kit, place.venue).slice(1) : rolesFor(ctx.kit, place.venue));
        const id = nextId('a');
        sim.actors[id] = { id, name: op.name?.trim() || face.name, role: face.role, look: face.look, traits: op.traits ?? '', home: place.parent ?? place.id, haunt: place.id, at: place.id, until: sim.clock + 180, shift: 'none', status: 'ok', memory: [], met: true, made: true };
        sim.met[op.who] = id;
        out.applied.push({ op: 'meet', who: op.who, name: sim.actors[id]!.name, ...(op.traits ? { traits: op.traits } : {}) });
        break;
      }
      case 'npc': {
        const a = findActor(sim, op.who, ctx.calendar);
        if (!a) break;
        if (op.goes !== undefined) {
          const p = op.goes ? findPlace(sim, op.goes) : undefined;
          a.at = p?.id ?? '';
          a.until = op.hours ? sim.clock + Math.round(op.hours * 60) : undefined;
          out.facts.push(p ? `${a.name} goes to ${p.name}.` : `${a.name} leaves.`);
        }
        if (op.follows !== undefined) {
          a.follows = op.follows;
          out.chips.push(`${a.name.split(' ')[0]} ${op.follows ? 'is with you' : 'stays behind'}`);
          if (!op.follows) { a.at = sim.here; a.until = sim.clock + 240; }
        }
        if (op.status && op.status !== a.status) {
          a.status = op.status;
          if (op.status === 'dead') {
            a.at = whereIs({ ...a, status: 'ok' }, sim, ctx.calendar) ?? sim.here;
            a.follows = false;
            out.chips.push(`† ${a.name}`);
            out.events.push({ title: `${a.name} dies`, kind: 'death', who: [a.name], importance: a.libId ? 3 : 2 });
          }
          out.facts.push(`${a.name} is ${op.status === 'ok' ? 'well again' : op.status}.`);
        }
        out.applied.push({ ...op, who: a.id, ...(op.goes ? { goes: findPlace(sim, op.goes)?.id ?? null } : {}) });
        break;
      }
      case 'place': {
        const name = op.name?.trim();
        if (!name) break;
        const known = findPlace(sim, name);
        if (known) {
          if (!known.known) { known.known = true; out.chips.push(`Found: ${known.name}`); }
          out.applied.push({ op: 'place', name: known.name });
          break;
        }
        const parent = (op.within && findPlace(sim, op.within)) || sim.places[sim.places[sim.here]?.parent ?? ''] || sim.places[sim.here];
        const venue = op.venue ?? venueOf(name, '', op.note ?? '');
        const id = nextId('p');
        const p: Place = { id, name, venue, type: '', parent: parent?.id ?? null, exits: [], note: op.note?.trim() ?? '', danger: Math.max(0, Math.min(5, Math.round(op.danger ?? 0))), known: true, visited: false, made: true };
        outfit(p, ctx.kit, sim.seed);
        sim.places[id] = p;
        if (parent) link(sim.places, id, parent.id, Math.max(1, Math.round(op.minutes ?? LEG[venue])));
        if (STAFFED.has(venue)) { const s = staffFor(p, ctx.kit, sim.seed); sim.actors[s.id] = s; }
        if (p.shop) restock(sim, p, ctx.kit, dayIndex(ctx.calendar, sim.clock));
        out.chips.push(`New place: ${name}`);
        out.facts.push(`There is a place called ${name}${parent ? ` in ${parent.name}` : ''}${p.note ? `: ${p.note}` : ''}.`);
        out.events.push({ title: `Found ${name}`, kind: 'discovery', who: [name], importance: 1 });
        out.applied.push({ op: 'place', name, venue, ...(parent ? { within: parent.id } : {}), ...(op.minutes ? { minutes: op.minutes } : {}), ...(op.note ? { note: op.note } : {}), ...(op.danger ? { danger: op.danger } : {}) });
        break;
      }
      case 'lead': {
        const existing = op.id ? sim.leads.find((l) => l.id === op.id || normName(l.title) === normName(op.id!)) : op.title ? sim.leads.find((l) => normName(l.title) === normName(op.title!) && l.status === 'open') : undefined;
        if (existing) {
          if (op.status && op.status !== existing.status) {
            existing.status = op.status;
            out.chips.push(`${op.status === 'done' ? 'Done' : op.status === 'failed' ? 'Failed' : 'Dropped'}: ${existing.title}`);
            out.facts.push(`The lead "${existing.title}" is ${op.status}.`);
            if (op.status !== 'dropped') out.events.push({ title: `${existing.title}: ${op.status}`, kind: 'event', who: [existing.giver], importance: 2 });
          }
          if (op.note) existing.notes = [...existing.notes, op.note].slice(-6);
          out.applied.push({ op: 'lead', id: existing.id, ...(op.status ? { status: op.status } : {}), ...(op.note ? { note: op.note } : {}) });
          break;
        }
        if (!op.title?.trim()) break;
        const giver = findActor(sim, op.giver, ctx.calendar);
        const where = findPlace(sim, op.where);
        const lead: Lead = { id: nextId('l'), title: op.title.trim(), goal: op.goal?.trim() ?? '', giver: giver?.name ?? op.giver ?? '', where: where?.name ?? op.where ?? '', reward: op.reward?.trim() ?? '', money: Math.max(0, Math.round(op.money ?? 0)), deadline: op.hours ? sim.clock + Math.round(op.hours * 60) : 0, status: 'open', notes: op.note ? [op.note] : [], ...(op.thread ? { thread: op.thread } : {}) };
        sim.leads = [...sim.leads, lead].slice(-30);
        if (where && !where.known) where.known = true;
        out.chips.push(`New lead: ${lead.title}`);
        out.facts.push(`New lead: ${lead.title}${lead.goal ? ` (${lead.goal})` : ''}${lead.reward ? `, for ${lead.reward}` : ''}.`);
        out.applied.push({ op: 'lead', title: lead.title, goal: lead.goal, giver: lead.giver, where: lead.where, reward: lead.reward, money: lead.money, ...(op.hours ? { hours: op.hours } : {}), ...(op.note ? { note: op.note } : {}), ...(op.thread ? { thread: op.thread } : {}) });
        break;
      }
      case 'rep': {
        const f = op.faction?.trim();
        const delta = Math.max(-3, Math.min(3, Math.round(Number(op.delta) || 0)));
        if (!f || !delta) break;
        sim.rep[f] = Math.max(-10, Math.min(10, (sim.rep[f] ?? 0) + delta));
        out.chips.push(`${f} ${delta > 0 ? '▲' : '▼'}`);
        out.applied.push({ op: 'rep', faction: f, delta });
        break;
      }
      case 'vital': {
        const key = op.resource as Resource;
        const delta = Math.max(-60, Math.min(60, Math.round(Number(op.delta) || 0)));
        if (!RESOURCES.includes(key) || !delta) break;
        const r = applyDelta(pov, { resources: { [key]: delta } });
        pov = r.state;
        out.notes.push(...r.notes);
        out.applied.push({ op: 'vital', resource: key, delta });
        break;
      }
      case 'condition': {
        if (!op.add && !op.remove) break;
        pov = applyDelta(pov, { conditionsAdded: op.add ? [op.add] : [], conditionsRemoved: op.remove ? [op.remove] : [] }).state;
        if (op.add) out.chips.push(op.add);
        out.applied.push(op);
        break;
      }
      case 'own': {
        const p = findPlace(sim, op.place);
        if (!p || p.owner === 'player') break;
        p.owner = 'player';
        delete p.forSale;
        out.chips.push(`Yours: ${p.name}`);
        out.facts.push(`${p.name} is yours now.`);
        out.events.push({ title: `${ctx.playerName} takes ${p.name}`, kind: 'item', who: [ctx.playerName, p.name], importance: 2 });
        out.applied.push({ op: 'own', place: p.id });
        break;
      }
      case 'lodge': {
        const p = findPlace(sim, op.place);
        const nights = Math.max(1, Math.min(60, Math.round(op.nights || 1)));
        if (!p) break;
        const from = sim.lodging?.place === p.id ? Math.max(sim.lodging.until, sim.clock) : sim.clock;
        sim.lodging = { place: p.id, until: from + nights * 1440 };
        out.chips.push(`Bed at ${p.name} · ${nights} night${nights > 1 ? 's' : ''}`);
        out.facts.push(`You have a bed at ${p.name} for ${nights} night${nights > 1 ? 's' : ''}.`);
        out.applied.push({ op: 'lodge', place: p.id, nights });
        break;
      }
      case 'stash': {
        const has = pov.inventory.find((i) => normName(i.name) === normName(op.item));
        if (!has || !canStash(sim)) break;
        const n = Math.min(has.qty, Math.max(1, op.qty ?? has.qty));
        pov = { ...pov, inventory: removeFromInventory(pov.inventory, [{ name: has.name, qty: n }]) };
        const prev = Object.values(sim.things).find((t) => t.holder === sim.here && t.stashed && normName(t.name) === normName(has.name));
        if (prev) prev.qty += n;
        else { const id = nextId('t'); sim.things[id] = { id, name: has.name, category: 'other', value: worth(ctx.kit, sim, has.name, has.itemId), qty: n, holder: sim.here, stashed: true, ...(has.itemId ? { libId: has.itemId } : {}) }; }
        out.chips.push(`Stored ${has.name}`);
        out.applied.push({ op: 'stash', item: has.name, qty: n });
        break;
      }
      case 'unstash': {
        const t = Object.values(sim.things).find((x) => x.holder === sim.here && x.stashed && normName(x.name) === normName(op.item));
        if (!t) break;
        const n = Math.min(t.qty, Math.max(1, op.qty ?? t.qty));
        t.qty -= n;
        if (t.qty <= 0) delete sim.things[t.id];
        pov = { ...pov, inventory: mergeInventory(pov.inventory, [{ name: t.name, qty: n, ...(t.libId ? { itemId: t.libId } : {}) }]) };
        out.chips.push(`Took ${t.name}`);
        out.applied.push({ op: 'unstash', item: t.name, qty: n });
        break;
      }
    }
  }
  out.sim = sim;
  out.pov = pov;
  return out;
}

/** The player can keep things here: they own it, or have a bed here. */
export function canStash(sim: SimState): boolean {
  const p = sim.places[sim.here];
  return !!p && (p.owner === 'player' || (sim.lodging?.place === p.id && sim.lodging.until > sim.clock));
}
