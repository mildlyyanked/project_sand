import { hash, rng } from './rng';
import { goodValue } from './kit';
import type { Kit, Place, SimState, Thing } from './types';

/**
 * Shops and money: what a shop has on its shelves today (restocked each
 * morning, the same for the same day), what it will pay for what the player
 * carries, and what something is worth.
 */
export function restock(state: SimState, place: Place, kit: Kit, day: number): void {
  if (!place.shop) return;
  for (const t of Object.values(state.things)) if (t.holder === place.id && t.price != null) delete state.things[t.id];
  const r = rng(hash(state.seed, 'stock', place.id, day));
  const pool = kit.goods.filter((g) => place.shop!.categories.includes(g.category));
  const list = (pool.length ? pool : kit.goods).slice();
  const n = Math.min(list.length, 4 + Math.floor(r() * 4));
  for (let i = 0; i < n; i++) {
    const g = list.splice(Math.floor(r() * list.length), 1)[0]!;
    const id = `t:${place.id}:${day}:${i}`;
    state.things[id] = { id, name: g.name, category: g.category, value: g.price, qty: 1 + Math.floor(r() * 4), holder: place.id, price: Math.max(1, Math.round(g.price * (0.9 + r() * 0.35))) };
  }
  place.shop.restockedDay = day;
}

export function stockOf(state: SimState, placeId: string): Thing[] {
  return Object.values(state.things).filter((t) => t.holder === placeId && t.price != null && t.qty > 0).sort((a, b) => a.price! - b.price!);
}

/** What something the player carries is worth, by its library entry or the goods list; 0 when nobody can say. */
export function worth(kit: Kit, state: SimState, name: string, itemId?: string | null): number {
  if (itemId && state.things[itemId]) return state.things[itemId]!.value;
  return goodValue(kit, name)?.price ?? 0;
}

/** What this shop will pay for one: half its worth, and only for the kinds of thing it deals in. */
export function sellOffer(kit: Kit, state: SimState, place: Place, name: string, itemId?: string | null): number {
  if (!place.shop) return 0;
  const g = goodValue(kit, name);
  const category = itemId && state.things[itemId] ? state.things[itemId]!.category : g?.category ?? '';
  if (!place.shop.categories.includes(category) && category !== 'luxury') return 0;
  return Math.floor(worth(kit, state, name, itemId) * 0.5);
}
