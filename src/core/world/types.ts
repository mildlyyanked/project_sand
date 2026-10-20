// World, instance and play types. RN-free.
import type { Id } from '../types';

/** In-world time: minutes since the world calendar's start. */
export type Minutes = number;

export interface WorldCalendar {
  /** gregorian: real dates from `start`. custom: years and days of the world's own reckoning. */
  kind: 'gregorian' | 'custom';
  /** gregorian: the moment minute 0 stands for, 'YYYY-MM-DDTHH:MM'. */
  start: string;
  /** custom: what years are called after the number ("AF", "of the Long Night"). */
  yearLabel: string;
  startYear: number;
  daysPerYear: number;
  /** custom: optional; the year is divided evenly between them. */
  monthNames: string[];
  hoursPerDay: number;
}

export interface WorldData {
  genre: string;
  tone: string;
  /** How the world works: magic, physics, what is possible and what it costs. */
  rules: string;
  technology: string;
  /** Social order in a line: who rules, what people fear, what is taboo. */
  society: string;
  themes: string;
  /** Name of the money, for POV play ("crowns", "credits"). */
  currency: string;
  /** Art direction for every picture of the world; not part of the writer's context. */
  artStyle?: string;
  /** How faction sigils are drawn. */
  sigilStyle?: string;
  calendar: WorldCalendar;
}

export type EntityKind = 'location' | 'organization' | 'item';

/** Places, factions and things. Hierarchy through parentId (a district in a city, a cell in a church). */
export interface WorldEntity {
  id: Id;
  universeId: Id;
  kind: EntityKind;
  name: string;
  parentId: Id | null;
  /** One or two lines the writer always sees when this comes up. */
  summary: string;
  /** Extra trigger words besides the name, lower-cased. */
  keys: string[];
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type Attribute = 'might' | 'agility' | 'wits' | 'presence' | 'resolve';

export interface Membership {
  orgId: Id;
  role: string;
}

export interface CharacterData {
  appearance?: string;
  personality?: string;
  backstory?: string;
  goals?: string;
  fears?: string;
  secrets?: string;
  skills?: string;
  occupation?: string;
  homeLocationId?: Id | null;
  memberships?: Membership[];
  /** POV play: 1 (poor) to 5 (exceptional); 2 is ordinary. */
  attributes?: Partial<Record<Attribute, number>>;
  /** POV play: one item per line, "2 × waterskin". */
  inventory?: string;
  money?: number;
}

export interface WorldInstance {
  id: Id;
  universeId: Id;
  name: string;
  /** How this version of the world differs from the template or from the instance it forked from. */
  description: string;
  forkedFrom: Id | null;
  forkAt: Minutes | null;
  isPrime: boolean;
  createdAt: number;
  updatedAt: number;
}

export type EventKind = 'event' | 'state' | 'death' | 'travel' | 'item' | 'relation' | 'discovery';
export type RefKind = 'character' | 'location' | 'organization' | 'item' | 'species';

export interface EntityRef {
  kind: RefKind | 'unknown';
  id: Id | null;
  name: string;
}

/** Something that happened in an instance. From a story (sessionId/beatId) or entered by hand. */
export interface WorldEvent {
  id: Id;
  instanceId: Id;
  sessionId: Id | null;
  beatId: Id | null;
  at: Minutes;
  kind: EventKind;
  title: string;
  text: string;
  entities: EntityRef[];
  /** 1 minor, 2 notable, 3 major (always remembered). */
  importance: 1 | 2 | 3;
  createdAt: number;
}

export type Resource = 'health' | 'energy' | 'satiety' | 'hydration' | 'morale';

export interface InventoryItem {
  name: string;
  qty: number;
  itemId?: Id | null;
  note?: string;
}

export interface Objective {
  text: string;
  done: boolean;
}

export type Outcome = 'crit-fail' | 'fail' | 'partial' | 'success' | 'crit-success';

export interface CheckResult {
  attribute: Attribute;
  difficulty: number;
  roll: number;
  modifier: number;
  total: number;
  outcome: Outcome;
  why: string;
  onSuccess: string;
  onFailure: string;
}

export interface PovState {
  resources: Record<Resource, number>;
  money: number;
  inventory: InventoryItem[];
  conditions: string[];
  objectives: Objective[];
  /** Attitude of named people toward the player, -3 hostile to +3 devoted. */
  relations: Record<string, { attitude: number; note: string }>;
  /** Health reached zero. */
  down: boolean;
  lastCheck?: CheckResult | null;
  /** The game master's read of the turn that led here: kept so a regenerate answers the same read. */
  lastRead?: import('./gm').GmRead | null;
  /** Threads the world runs behind the screen. */
  threads?: import('./gm').Thread[];
}

/** Where the scene is, and in POV mode the player's sheet. Stored on beats so branches and undo rewind it. */
export interface SceneState {
  locationId: Id | null;
  locationName: string;
  /** Who is in the scene besides the player, as the chronicle last had it. */
  present?: string[];
  pov?: PovState;
}

export type Difficulty = 'story' | 'survival' | 'hardcore';

export interface PovSettings {
  characterId: Id | null;
  difficulty: Difficulty;
  /** Roll for risky actions. */
  checks: boolean;
  startLocationId: Id | null;
  /** How long a narrated turn runs. */
  turnLength?: import('./gm').TurnLength;
  /** Threads prepared before the first passage; after that they live on the sheet. */
  threads?: import('./gm').Thread[];
}
