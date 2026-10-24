import type { Character } from '../types';
import type { WorldCalendar, WorldEntity } from '../world/types';
import { dayIndex } from '../world/calendar';
import { hash, pick, rng } from './rng';
import { DEFAULT_KIT, LEG, LOOKS, STAFFED, WORK, goodValue, rolesFor, shopCategories, venueOf } from './kit';
import { restock } from './economy';
import type { Actor, Kit, Place, SimState, Thing, Venue } from './types';

/**
 * The world at the start of play, from the library: every location becomes a
 * place joined to the place that contains it, every character is put where
 * their home and work say, every shop, tavern and workshop gets someone
 * behind the counter, shops get stock, some homes are for sale. Deterministic
 * for the same library and seed.
 */
export function seedWorld(o: {
  entities: WorldEntity[];
  characters: Character[];
  player: Character | null;
  /** The story's own cast: put in the opening place when they have nowhere else to be. */
  castIds: string[];
  startId: string | null;
  startName: string;
  clock: number;
  calendar?: WorldCalendar;
  kit?: Kit;
  seed?: number;
}): SimState {
  const kit = o.kit ?? DEFAULT_KIT;
  const seed = o.seed ?? hash(o.entities.map((e) => e.id).join(','), o.player?.id ?? '');
  const locs = o.entities.filter((e) => e.kind === 'location');
  const places: Record<string, Place> = {};
  for (const e of locs) places[e.id] = placeFrom(e, o.entities, kit, seed);
  connect(places);

  // Where the player starts: a library place, or one made from the scene's name.
  let here = o.startId && places[o.startId] ? o.startId : '';
  if (!here) {
    const name = o.startName.trim() || 'Somewhere';
    const venue = venueOf(name, '', '');
    here = `p:start`;
    places[here] = { id: here, name, venue, type: '', parent: null, exits: [], note: '', danger: 0, known: true, visited: true, made: true };
    const settlement = Object.values(places).find((p) => p.venue === 'settlement' && p.id !== here);
    if (settlement) link(places, here, settlement.id, LEG[venue]);
  }
  reveal(places, here);

  const actors: Record<string, Actor> = {};
  const orgs = o.entities.filter((e) => e.kind === 'organization');
  for (const c of o.characters) {
    if (c.id === o.player?.id) continue;
    const a = actorFrom(c, orgs, places);
    if (!a.home && !a.work && o.castIds.includes(c.id)) a.at = here;
    actors[a.id] = a;
  }
  // Someone behind every counter: the same person every day they work.
  for (const p of Object.values(places)) {
    if (!STAFFED.has(p.venue)) continue;
    const a = staffFor(p, kit, seed);
    actors[a.id] = a;
  }

  const things: Record<string, Thing> = {};
  for (const e of o.entities.filter((x) => x.kind === 'item')) {
    const owner = e.data.owner ? String(e.data.owner) : '';
    if (owner && owner === o.player?.id) continue;
    const holder = owner && actors[owner] ? owner : e.data.location && places[String(e.data.location)] ? String(e.data.location) : '';
    if (!holder) continue;
    const value = Number(e.data.value) || goodValue(kit, e.name)?.price || 10;
    things[e.id] = { id: e.id, name: e.name, category: String(e.data.type ?? 'other'), value, qty: 1, holder, libId: e.id };
  }

  const state: SimState = { v: 1, seed, clock: o.clock, here, places, actors, things, leads: [], rep: {}, lodging: null, met: {}, day: dayIndex(o.calendar, o.clock), counter: 0 };
  for (const p of Object.values(places)) if (p.shop) restock(state, p, kit, state.day);
  return state;
}

function placeFrom(e: WorldEntity, entities: WorldEntity[], kit: Kit, seed: number): Place {
  const type = String(e.data.type ?? '');
  const venue = venueOf(e.name, type, `${e.summary} ${String(e.data.description ?? '')}`);
  const owner = e.data.controlledBy ? entities.find((x) => x.id === e.data.controlledBy)?.name : undefined;
  const parentOk = !!e.parentId && entities.some((x) => x.id === e.parentId && x.kind === 'location');
  const p: Place = {
    id: e.id, name: e.name, venue, type, parent: parentOk ? e.parentId : null, libId: e.id, exits: [],
    note: firstSentence(e.summary || String(e.data.description ?? '') || String(e.data.atmosphere ?? '')),
    danger: Math.max(0, Math.min(5, Number(e.data.danger) || 0)), known: false, visited: false,
    ...(owner ? { owner } : {}),
  };
  outfit(p, kit, seed);
  return p;
}

function actorFrom(c: Character, orgs: WorldEntity[], places: Record<string, Place>): Actor {
  const home = c.data.homeLocationId && places[c.data.homeLocationId] ? c.data.homeLocationId : undefined;
  const m = c.data.memberships?.[0];
  const org = m ? orgs.find((x) => x.id === m.orgId) : undefined;
  const hq = org?.data.headquarters ? String(org.data.headquarters) : '';
  const work = hq && places[hq] ? hq : undefined;
  return {
    id: c.id, name: c.name, libId: c.id, role: c.data.occupation || m?.role || 'local', look: firstSentence(c.data.appearance ?? ''), traits: c.summary,
    ...(home ? { home } : {}), ...(work ? { work } : {}), shift: work ? 'day' : 'none', status: 'ok', memory: [], met: false,
    ...(org ? { faction: org.name } : {}),
  };
}

/**
 * Library entries added since the world was made join it: new places by their
 * parent, new people on their rounds. Never changes what is already there.
 */
export function mergeLibrary(sim: SimState, o: { entities: WorldEntity[]; characters: Character[]; player: Character | null; kit?: Kit }): void {
  const kit = o.kit ?? DEFAULT_KIT;
  const fresh = o.entities.filter((e) => e.kind === 'location' && !sim.places[e.id]);
  for (const e of fresh) sim.places[e.id] = placeFrom(e, o.entities, kit, sim.seed);
  for (const e of fresh) {
    const p = sim.places[e.id]!;
    if (p.parent && sim.places[p.parent]) {
      link(sim.places, p.id, p.parent, LEG[p.venue]);
      if (sim.places[p.parent]!.visited) p.known = true;
    } else {
      const root = Object.values(sim.places).find((x) => !x.parent && x.id !== p.id);
      if (root) link(sim.places, p.id, root.id, Math.max(LEG[p.venue], LEG[root.venue]) * 3);
    }
    if (STAFFED.has(p.venue) && !sim.actors[`a:staff:${p.id}`]) { const a = staffFor(p, kit, sim.seed); sim.actors[a.id] = a; }
    if (p.shop) restock(sim, p, kit, sim.day);
  }
  const orgs = o.entities.filter((e) => e.kind === 'organization');
  for (const c of o.characters) if (c.id !== o.player?.id && !sim.actors[c.id]) sim.actors[c.id] = actorFrom(c, orgs, sim.places);
}

/** What a place offers by its kind: a shop, paid work, beds; some homes and businesses are for sale. */
export function outfit(p: Place, kit: Kit, seed: number): void {
  const r = rng(hash(seed, p.id));
  const work = WORK[p.venue];
  const cats = shopCategories(p.venue, p.name);
  if (cats) p.shop = { categories: cats, restockedDay: -1 };
  if (work) p.work = { role: work.role, hours: work.hours, pay: Math.max(1, Math.round((kit.wage * work.hours * work.rate) / 8)) };
  if (p.venue === 'inn') p.lodging = kit.bed;
  else if (p.venue === 'tavern' && r() < 0.5) p.lodging = Math.max(1, Math.round(kit.bed * 0.8));
  if (!p.owner && (p.venue === 'home' || p.venue === 'room') && r() < 0.5) p.forSale = Math.round(kit.house * (p.venue === 'room' ? 0.35 : 1) * (0.8 + r() * 0.5));
  else if (!p.owner && (p.venue === 'shop' || p.venue === 'workshop') && r() < 0.25) p.forSale = Math.round(kit.house * 1.6 * (0.8 + r() * 0.5));
}

/** The one who keeps a staffed place: the same person every day they work. */
export function staffFor(p: Place, kit: Kit, seed: number): Actor {
  const r = rng(hash(seed, 'staff', p.id));
  const name = `${pick(r, kit.given)}${r() < 0.6 ? ` ${pick(r, kit.family)}` : ''}`;
  return { id: `a:staff:${p.id}`, name, role: rolesFor(kit, p.venue)[0]!, look: pick(r, LOOKS), traits: '', home: p.parent ?? undefined, work: p.id, shift: p.venue === 'tavern' || p.venue === 'inn' ? 'night' : 'day', status: 'ok', memory: [], met: false, staff: true, made: true };
}

function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = /^(.{20,200}?[.!?])(\s|$)/.exec(t);
  return m ? m[1]! : t.slice(0, 200);
}

export function link(places: Record<string, Place>, a: string, b: string, minutes: number): void {
  const pa = places[a];
  const pb = places[b];
  if (!pa || !pb || a === b) return;
  if (!pa.exits.some((x) => x.to === b)) pa.exits.push({ to: b, minutes });
  if (!pb.exits.some((x) => x.to === a)) pb.exits.push({ to: a, minutes });
}

/** Join every place to the one that contains it, and the top-level places to each other. */
function connect(places: Record<string, Place>): void {
  const all = Object.values(places);
  for (const p of all) if (p.parent) link(places, p.id, p.parent, LEG[p.venue]);
  const roots = all.filter((p) => !p.parent);
  for (let i = 1; i < roots.length; i++) link(places, roots[i - 1]!.id, roots[i]!.id, Math.max(LEG[roots[i - 1]!.venue], LEG[roots[i]!.venue]) * 3);
}

const BIG = new Set<Venue>(['settlement', 'region', 'district']);
const BIG_TYPES = new Set(['district', 'city', 'town', 'village', 'station', 'region', 'province', 'nation']);

/** Put a place and its surroundings on the player's map: where it sits, what is next door, what is inside. */
export function reveal(places: Record<string, Place>, id: string): void {
  const p = places[id];
  if (!p) return;
  p.known = true;
  p.visited = true;
  for (const e of p.exits) { const q = places[e.to]; if (q) q.known = true; }
  // In a town or district, its streets and landmarks are common knowledge.
  let up = p.parent ? places[p.parent] : undefined;
  while (up) {
    up.known = true;
    if (BIG.has(up.venue) || BIG_TYPES.has(up.type)) for (const e of up.exits) { const q = places[e.to]; if (q && q.parent === up.id) q.known = true; }
    up = up.parent ? places[up.parent] : undefined;
  }
}
