import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import { ATTRIBUTES, ATTRIBUTE_INFO } from './dice';
import { parseDuration } from './calendar';
import type { PovDelta } from './survival';
import type { Attribute, EventKind, InventoryItem, Minutes } from './types';
import { parseNewcomers, type Newcomer } from './forge';

const EVENT_KINDS: EventKind[] = ['event', 'state', 'death', 'travel', 'item', 'relation', 'discovery'];

export interface ChronicleEvent { title: string; text: string; importance: 1 | 2 | 3; kind: EventKind; who: string[] }
export interface ChronicleChange { who: string; change: string; kind: EventKind }
export interface ChronicleResult {
  minutes: Minutes;
  resting: boolean;
  locationName: string | null;
  events: ChronicleEvent[];
  changes: ChronicleChange[];
  player: PovDelta | null;
  /** Named people, places, factions and things the passage brought in that the library does not have. */
  newcomers: Newcomer[];
}

/** After each passage: how much time passed, what happened, what changed, and in play what it did to the player. */
export function chroniclePrompt(o: {
  worldName: string;
  now: string;
  location: string;
  known: string[];
  passage: string;
  pov?: { name: string; sheet: string; action: string; ruling: string } | null;
}): ChatMessage[] {
  const player = o.pov
    ? `, "player": {"resources": {"health": 0, "energy": 0, "satiety": 0, "hydration": 0, "morale": 0} (only what the passage itself did: a wound, a meal eaten, a drink, exertion, a blow to the spirit; integers, negative for loss), "money": 0 (spent negative, gained positive), "gained": [{"name": string, "qty": number}], "lost": [{"name": string, "qty": number}], "conditionsAdded": string[] (lasting afflictions like "sprained ankle", "fever"), "conditionsRemoved": string[], "objectivesAdded": string[] (aims the player took on or was given), "objectivesDone": string[], "relations": [{"name": string, "delta": -2..2, "note": string}]}`
    : '';
  return [
    { role: 'system', content: [
      'You keep the chronicle of a story world. You read the newest passage and record, as JSON, what it did to the world. You are a clerk, not a critic: record only what the passage shows, never what might follow.',
      `Output only JSON: {"elapsed": string (how much in-world time the passage itself covers: "40 seconds", "20 minutes", "3 hours", "2 days"), "resting": boolean (true only if the passage is mostly sleep or rest), "location": string or null (where the scene is at the end, by its most specific name; null if unchanged), "events": [{"title": string (at most 8 words), "text": string (one sentence), "importance": 1 | 2 | 3, "kind": "event" | "death" | "travel" | "item" | "relation" | "discovery", "who": string[] (names involved)}], "changes": [{"who": string, "change": string (one line: a lasting change to that person, place, faction or thing), "kind": "state" | "death" | "travel" | "relation" | "item"}], "newcomers": [{"name": string, "kind": "character" | "location" | "organization" | "item", "note": string (one line from the passage)}] (named people, places, factions or things the passage treats as real that are not in the known names; [] if none)${player}}.`,
      'Most passages have zero to two events. Importance 3 is for what the whole world would remember: deaths of named people, wars, coronations, destructions, irreversible turns. Importance 1 is for small but concrete facts worth keeping (a promise made, a door left open). Do not record mood, description or conversation that changes nothing.',
      'Changes are lasting: injuries, deaths, new allegiances, someone moving house, an object changing hands, a place burned. Use the names exactly as given in the known list when they match.',
      o.pov ? 'Player bookkeeping: hunger, thirst and fatigue from time passing are handled by the app; record only direct effects in the passage. The ruling on the player’s action is already decided; record its consequences. Inventory changes only for what is clearly picked up, bought, given, used up, broken or lost.' : '',
    ].filter(Boolean).join('\n\n') },
    { role: 'user', content: [
      `World: ${o.worldName}. Time before the passage: ${o.now}. Location before the passage: ${o.location || 'unknown'}.`,
      o.known.length ? `Known names: ${o.known.slice(0, 120).join(', ')}` : '',
      o.pov ? `The player is ${o.pov.name}.\n${o.pov.sheet}\nTheir action: ${o.pov.action || '(continue)'}${o.pov.ruling ? `\nRuling: ${o.pov.ruling}` : ''}` : '',
      `Passage:\n${o.passage}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
const items = (v: unknown): InventoryItem[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? { name: x.trim(), qty: 1 } : x && typeof x === 'object' ? { name: str((x as { name?: unknown }).name), qty: Math.max(1, Math.round(Number((x as { qty?: unknown }).qty) || 1)) } : null)).filter((x): x is InventoryItem => !!x && !!x.name) : []);

export function parseChronicle(text: string): ChronicleResult | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const kind = (v: unknown, dflt: EventKind): EventKind => (EVENT_KINDS.includes(v as EventKind) ? (v as EventKind) : dflt);
  const events = (Array.isArray(j.events) ? j.events : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ title: str(e.title).slice(0, 80), text: str(e.text), importance: (Math.max(1, Math.min(3, Math.round(Number(e.importance) || 1))) as 1 | 2 | 3), kind: kind(e.kind, 'event'), who: strs(e.who) }))
    .filter((e) => e.title || e.text)
    .slice(0, 6);
  const changes = (Array.isArray(j.changes) ? j.changes : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ who: str(e.who), change: str(e.change), kind: kind(e.kind, 'state') }))
    .filter((c) => c.who && c.change)
    .slice(0, 8);
  let player: PovDelta | null = null;
  if (j.player && typeof j.player === 'object') {
    const p = j.player as Record<string, unknown>;
    const res: Record<string, number> = {};
    if (p.resources && typeof p.resources === 'object') for (const [k, v] of Object.entries(p.resources as Record<string, unknown>)) { const n = Math.round(Number(v)); if (Number.isFinite(n) && n) res[k] = n; }
    player = {
      resources: res,
      money: Math.round(Number(p.money) || 0),
      gained: items(p.gained),
      lost: items(p.lost),
      conditionsAdded: strs(p.conditionsAdded),
      conditionsRemoved: strs(p.conditionsRemoved),
      objectivesAdded: strs(p.objectivesAdded),
      objectivesDone: strs(p.objectivesDone),
      relations: (Array.isArray(p.relations) ? p.relations : []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object').map((r) => ({ name: str(r.name), delta: Math.max(-2, Math.min(2, Math.round(Number(r.delta) || 0))), note: str(r.note) })).filter((r) => r.name),
    };
  }
  const loc = str(j.location);
  return { minutes: parseDuration(j.elapsed ?? j.minutes), resting: j.resting === true, locationName: loc && !/^(null|none|unchanged|same)$/i.test(loc) ? loc : null, events, changes, player, newcomers: parseNewcomers({ newcomers: j.newcomers }, []) };
}

export interface Ruling { attribute: Attribute; difficulty: number; why: string; onSuccess: string; onFailure: string }

/** Before the narrator writes: does this action need a roll, and what rides on it. */
export function adjudicatePrompt(o: { action: string; scene: string; sheet: string; attributes: Partial<Record<Attribute, number>>; recent: string }): ChatMessage[] {
  return [
    { role: 'system', content: [
      'You are the referee of an interactive story. Decide whether the player’s action needs a test of skill or luck. Test only when the outcome is genuinely uncertain and failure would matter: fights, chases, climbs, lies, persuasion of the unwilling, picking locks, enduring pain, noticing what is hidden. Ordinary actions (walking, talking politely, looking around, eating) are not tested.',
      `Attributes: ${ATTRIBUTES.map((a) => `${a} (${ATTRIBUTE_INFO[a].hint})`).join('; ')}.`,
      'Difficulty: 8 easy, 12 moderate, 16 hard, 20 very hard, 24 nearly impossible. Account for the player’s condition and equipment.',
      'Output only JSON: {"check": null} or {"check": {"attribute": one of the attributes, "difficulty": number, "why": string (one line), "success": string (what success gets them, one line), "failure": string (what failure costs, concrete, one line)}}.',
    ].join('\n\n') },
    { role: 'user', content: [`Scene: ${o.scene}`, `Player:\n${o.sheet}`, `Their attributes: ${ATTRIBUTES.map((a) => `${a} ${o.attributes[a] ?? 2}`).join(', ')}`, o.recent ? `Just before:\n${o.recent.slice(-1200)}` : '', `Their action: ${o.action}`].filter(Boolean).join('\n\n') },
  ];
}

export function parseRuling(text: string): Ruling | null {
  const j = lenientJson<{ check?: Record<string, unknown> | null }>(text);
  const c = j?.check;
  if (!c || typeof c !== 'object') return null;
  const attribute = String(c.attribute ?? '').toLowerCase() as Attribute;
  if (!ATTRIBUTES.includes(attribute)) return null;
  const difficulty = Math.round(Number(c.difficulty));
  if (!Number.isFinite(difficulty)) return null;
  return { attribute, difficulty: Math.max(5, Math.min(25, difficulty)), why: str(c.why), onSuccess: str(c.success), onFailure: str(c.failure) };
}
