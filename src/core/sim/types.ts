import type { Attribute } from '../world/types';

/**
 * The world simulation behind play. The world is the truth and the prose
 * renders it: places joined by exits with travel times, people with homes,
 * work and daily rounds, things with holders, shops, jobs, property and
 * leads. A turn resolves into ops that apply at once; the narrator then
 * writes what happened. RN-free.
 */

/** What a place is for: drives its crowd, its people, its shop, work and lodging. */
export type Venue =
  | 'tavern' | 'inn' | 'market' | 'shop' | 'workshop' | 'temple' | 'dock' | 'garrison' | 'square' | 'street'
  | 'home' | 'hall' | 'office' | 'palace' | 'clinic' | 'wild' | 'road' | 'ruin' | 'settlement' | 'district'
  | 'building' | 'room' | 'region' | 'vehicle' | 'other';

export interface Exit { to: string; minutes: number }

export interface Place {
  id: string;
  name: string;
  venue: Venue;
  /** The library's location type, when it came from the library. */
  type: string;
  parent: string | null;
  /** The library entry it is, if any. */
  libId?: string;
  exits: Exit[];
  /** One line: what it is like. */
  note: string;
  /** 0 safe to 5 lethal. */
  danger: number;
  /** On the player's map. */
  known: boolean;
  visited: boolean;
  /** Who owns it: 'player', an actor id, or a faction name. */
  owner?: string;
  /** Asking price to buy it outright. */
  forSale?: number;
  /** Price of a night's bed. */
  lodging?: number;
  /** Paid work here. */
  work?: { role: string; pay: number; hours: number };
  /** What the shop here sells and buys. */
  shop?: { categories: string[]; restockedDay: number };
  /** Generated in play rather than from the library. */
  made?: boolean;
}

export type Shift = 'day' | 'night' | 'none';

export interface Actor {
  id: string;
  name: string;
  libId?: string;
  role: string;
  look: string;
  /** One line of who they are, filled in when the player first deals with them. */
  traits: string;
  home?: string;
  work?: string;
  haunt?: string;
  shift: Shift;
  /** Where they are when the rounds do not say: a library character with no home, or one sent somewhere. */
  at?: string;
  /** Until when `at` holds over the rounds (in world minutes); absent means for good. */
  until?: number;
  follows?: boolean;
  status: 'ok' | 'hurt' | 'dead' | 'gone';
  /** What they remember of the player, newest last. */
  memory: string[];
  met: boolean;
  faction?: string;
  /** Works the shop or the counter where they work. */
  staff?: boolean;
  made?: boolean;
}

export interface Thing {
  id: string;
  name: string;
  category: string;
  /** Base value in the world's money. */
  value: number;
  qty: number;
  /** A place id (lying there, shop stock or stash) or an actor id. */
  holder: string;
  /** Shop stock: for sale at this price. */
  price?: number;
  /** Stored by the player in their own place. */
  stashed?: boolean;
  libId?: string;
}

export interface Lead {
  id: string;
  title: string;
  goal: string;
  giver: string;
  where: string;
  reward: string;
  money: number;
  /** World minute it must be done by; 0 for none. */
  deadline: number;
  status: 'open' | 'done' | 'failed' | 'dropped';
  notes: string[];
  /** The hidden thread it surfaced from, if any. */
  thread?: string;
}

export interface SimState {
  v: 1;
  seed: number;
  clock: number;
  here: string;
  places: Record<string, Place>;
  actors: Record<string, Actor>;
  things: Record<string, Thing>;
  leads: Lead[];
  /** Standing with factions, -10 to 10. */
  rep: Record<string, number>;
  /** Where the player has a bed, and until when. */
  lodging: { place: string; until: number } | null;
  /** Faces already turned into people: face key → actor id. */
  met: Record<string, string>;
  /** Last day the daily round ran (rent, income, restock). */
  day: number;
  counter: number;
}

/** A per-world kit, generated once: names, the people of each venue, goods and prices, the small life of places. */
export interface Kit {
  given: string[];
  family: string[];
  roles: Partial<Record<Venue, string[]>>;
  goods: Good[];
  ambient: Partial<Record<Venue, string[]>>;
  /** A day's wage for ordinary work. */
  wage: number;
  bed: number;
  house: number;
}

export interface Good { name: string; category: string; price: number }

/** One face in a crowd: a person who exists only while looked at, until the player deals with them. */
export interface Face { key: string; name: string; role: string; look: string; staff: boolean }

/**
 * A change to the world. Turns produce these; `applyOps` validates and applies them.
 * Refs are ids, a face key, or a name that resolves to one.
 */
export type SimOp =
  | { op: 'go'; to: string; minutes?: number }
  | { op: 'time'; minutes: number; resting?: boolean }
  | { op: 'money'; amount: number; note?: string }
  | { op: 'gain'; item: string; qty?: number; from?: string; category?: string; value?: number }
  | { op: 'lose'; item: string; qty?: number; to?: string }
  | { op: 'attitude'; who: string; delta: number; note?: string }
  | { op: 'remember'; who: string; note: string }
  | { op: 'meet'; who: string; name?: string; traits?: string }
  | { op: 'npc'; who: string; goes?: string | null; hours?: number; status?: Actor['status']; follows?: boolean }
  | { op: 'place'; name: string; venue?: Venue; within?: string; minutes?: number; note?: string; danger?: number }
  | { op: 'lead'; id?: string; title?: string; goal?: string; giver?: string; where?: string; reward?: string; money?: number; hours?: number; status?: Lead['status']; note?: string; thread?: string }
  | { op: 'rep'; faction: string; delta: number }
  | { op: 'vital'; resource: string; delta: number }
  | { op: 'condition'; add?: string; remove?: string }
  | { op: 'own'; place: string }
  | { op: 'lodge'; place: string; nights: number }
  | { op: 'stash'; item: string; qty?: number }
  | { op: 'unstash'; item: string; qty?: number };

/** A tapped action: resolved by rules, no model call. */
export type SimAction =
  | { kind: 'go'; to: string }
  | { kind: 'wait'; minutes: number }
  | { kind: 'rest'; hours: number }
  | { kind: 'buy'; thing: string }
  | { kind: 'sell'; item: string }
  | { kind: 'work' }
  | { kind: 'rent'; nights: number }
  | { kind: 'buyPlace' }
  | { kind: 'take'; thing: string }
  | { kind: 'stash'; item: string }
  | { kind: 'unstash'; thing: string };

/** What a resolved turn hands the narrator and the screen. */
export interface Resolution {
  /** What the player did, in a line. */
  action: string;
  /** What happened, from the world's side: the narrator writes exactly this. */
  outcome: string;
  ops: SimOp[];
  check?: { attribute: Attribute; difficulty: number; why: string } | null;
  /** Who answers, for talk. */
  speaker?: string | null;
  /** Hidden thread moves, passed through to the sheet. */
  threads?: unknown;
  newThread?: unknown;
}

/** What a turn did, kept on the passage. */
export interface TurnRecord {
  ops: SimOp[];
  chips: string[];
  facts: string[];
  /** The brief the narrator wrote from, for a rewrite of the same turn. */
  action?: string;
  outcome?: string;
}
