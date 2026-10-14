import type { Difficulty, InventoryItem, Minutes, PovState, Resource, SceneState } from './types';

/** Survival and resources for POV play. Pure and deterministic, so the app, not the model, keeps the books. */

export const RESOURCES: Resource[] = ['health', 'energy', 'satiety', 'hydration', 'morale'];

export const RESOURCE_INFO: Record<Resource, { label: string; low: string; empty: string }> = {
  health: { label: 'Health', low: 'badly hurt', empty: 'collapsing' },
  energy: { label: 'Energy', low: 'exhausted', empty: 'spent' },
  satiety: { label: 'Food', low: 'hungry', empty: 'starving' },
  hydration: { label: 'Water', low: 'thirsty', empty: 'parched' },
  morale: { label: 'Morale', low: 'shaken', empty: 'despairing' },
};

/** Change per hour while awake. Resting turns energy decay into recovery. */
const DECAY: Record<Difficulty, Record<Resource, number>> = {
  story: { health: 0, energy: 0, satiety: 0, hydration: 0, morale: 0 },
  survival: { health: 0, energy: -4, satiety: -3, hydration: -5, morale: 0 },
  hardcore: { health: 0, energy: -6, satiety: -4.5, hydration: -7.5, morale: -0.5 },
};
const REST_ENERGY_PER_HOUR = 14;
const REST_HEALTH_PER_HOUR = 2;
/** Health lost per hour while starving or parched. */
const STARVE = 4;
const PARCH = 6;
export const LOW = 25;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function initialPov(o: { money?: number; inventory?: string }): PovState {
  return {
    resources: { health: 100, energy: 85, satiety: 80, hydration: 80, morale: 70 },
    money: Math.max(0, Math.round(o.money ?? 0)),
    inventory: parseInventory(o.inventory ?? ''),
    conditions: [],
    objectives: [],
    relations: {},
    down: false,
    lastCheck: null,
  };
}

/** "2 × waterskin", "waterskin x2", "3 rations", "rope". */
export function parseInventory(text: string): InventoryItem[] {
  const out: InventoryItem[] = [];
  for (const raw of text.split(/\n|;/)) {
    const line = raw.replace(/^[-*•]\s*/, '').trim();
    if (!line) continue;
    let m = /^(\d+)\s*[x×*]?\s+(.+)$/i.exec(line);
    if (m) {
      out.push({ name: m[2]!.trim(), qty: Number(m[1]) });
      continue;
    }
    m = /^(.+?)\s*[x×*]\s*(\d+)$/i.exec(line);
    if (m) {
      out.push({ name: m[1]!.trim(), qty: Number(m[2]) });
      continue;
    }
    out.push({ name: line, qty: 1 });
  }
  return mergeInventory([], out);
}

const ALIASES: Record<string, Resource> = { health: 'health', hp: 'health', life: 'health', energy: 'energy', stamina: 'energy', fatigue: 'energy', satiety: 'satiety', food: 'satiety', hunger: 'satiety', hydration: 'hydration', water: 'hydration', thirst: 'hydration', morale: 'morale', spirit: 'morale', mood: 'morale', sanity: 'morale' };

/** "satiety +30, water +10", "health -5", "Heals 20 health" → { satiety: 30, hydration: 10 }. */
export function parseEffects(text: unknown): Partial<Record<Resource, number>> {
  if (text && typeof text === 'object' && !Array.isArray(text)) {
    const out: Partial<Record<Resource, number>> = {};
    for (const [k, v] of Object.entries(text as Record<string, unknown>)) {
      const r = ALIASES[k.toLowerCase()];
      const n = Number(v);
      if (r && Number.isFinite(n) && n) out[r] = (out[r] ?? 0) + n;
    }
    return out;
  }
  if (typeof text !== 'string') return {};
  const out: Partial<Record<Resource, number>> = {};
  const re = /([a-z]+)\s*([+-]\s*\d+)|([+-]?\d+)\s+([a-z]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = (m[1] ?? m[4] ?? '').toLowerCase();
    const num = Number((m[2] ?? m[3] ?? '0').replace(/\s/g, ''));
    const r = ALIASES[word];
    if (r && num) out[r] = (out[r] ?? 0) + num;
  }
  return out;
}

export function mergeInventory(inv: InventoryItem[], add: InventoryItem[]): InventoryItem[] {
  const out = inv.map((i) => ({ ...i }));
  for (const a of add) {
    if (!a.name.trim() || a.qty <= 0) continue;
    const hit = out.find((i) => i.name.toLowerCase() === a.name.trim().toLowerCase());
    if (hit) hit.qty += a.qty;
    else out.push({ ...a, name: a.name.trim() });
  }
  return out;
}

export function removeFromInventory(inv: InventoryItem[], remove: InventoryItem[]): InventoryItem[] {
  const out = inv.map((i) => ({ ...i }));
  for (const r of remove) {
    const key = r.name.trim().toLowerCase();
    const hit = out.find((i) => i.name.toLowerCase() === key) ?? out.find((i) => i.name.toLowerCase().includes(key) || key.includes(i.name.toLowerCase()));
    if (hit) hit.qty -= Math.max(1, r.qty);
  }
  return out.filter((i) => i.qty > 0);
}

/** Let time pass: hunger, thirst and fatigue in survival play; recovery while resting. Returns warnings crossed. */
export function passTime(state: PovState, minutes: Minutes, difficulty: Difficulty, resting = false): { state: PovState; notes: string[] } {
  const hours = Math.max(0, minutes) / 60;
  if (!hours) return { state, notes: [] };
  const d = DECAY[difficulty];
  const before = state.resources;
  const r = { ...before };
  const slow = resting ? 0.5 : 1;
  r.satiety = clamp(r.satiety + d.satiety * hours * slow);
  r.hydration = clamp(r.hydration + d.hydration * hours * slow);
  r.morale = clamp(r.morale + d.morale * hours);
  r.energy = clamp(resting ? r.energy + REST_ENERGY_PER_HOUR * hours : r.energy + d.energy * hours);
  if (difficulty !== 'story') {
    const starving = before.satiety === 0 ? hours : r.satiety === 0 && d.satiety ? Math.max(0, hours - before.satiety / -d.satiety / slow) : 0;
    const parched = before.hydration === 0 ? hours : r.hydration === 0 && d.hydration ? Math.max(0, hours - before.hydration / -d.hydration / slow) : 0;
    r.health = clamp(r.health - STARVE * starving - PARCH * parched + (resting && r.satiety > LOW && r.hydration > LOW ? REST_HEALTH_PER_HOUR * hours : 0));
    if (r.energy === 0) r.morale = clamp(r.morale - 2 * hours);
  }
  const next: PovState = { ...state, resources: r, down: state.down || r.health === 0 };
  return { state: next, notes: crossed(before, r) };
}

function crossed(before: Record<Resource, number>, after: Record<Resource, number>): string[] {
  const notes: string[] = [];
  for (const k of RESOURCES) {
    if (before[k] > 0 && after[k] === 0) notes.push(`${RESOURCE_INFO[k].label} ran out: ${RESOURCE_INFO[k].empty}.`);
    else if (before[k] >= LOW && after[k] < LOW) notes.push(`${RESOURCE_INFO[k].label} is low: ${RESOURCE_INFO[k].low}.`);
  }
  return notes;
}

export interface PovDelta {
  resources?: Partial<Record<Resource, number>>;
  money?: number;
  gained?: InventoryItem[];
  lost?: InventoryItem[];
  conditionsAdded?: string[];
  conditionsRemoved?: string[];
  objectivesAdded?: string[];
  objectivesDone?: string[];
  relations?: { name: string; delta: number; note?: string }[];
}

export function applyDelta(state: PovState, d: PovDelta): { state: PovState; notes: string[] } {
  const before = state.resources;
  const r = { ...before };
  for (const [k, v] of Object.entries(d.resources ?? {})) {
    const key = k as Resource;
    if (RESOURCES.includes(key) && Number.isFinite(v)) r[key] = clamp(r[key] + Math.max(-100, Math.min(100, v as number)));
  }
  let conditions = state.conditions.filter((c) => !(d.conditionsRemoved ?? []).some((x) => x.toLowerCase() === c.toLowerCase() || c.toLowerCase().includes(x.toLowerCase())));
  for (const c of d.conditionsAdded ?? []) if (c.trim() && !conditions.some((x) => x.toLowerCase() === c.trim().toLowerCase())) conditions = [...conditions, c.trim()];
  let objectives = state.objectives.map((o) => ((d.objectivesDone ?? []).some((x) => sameish(x, o.text)) ? { ...o, done: true } : o));
  for (const o of d.objectivesAdded ?? []) if (o.trim() && !objectives.some((x) => sameish(x.text, o))) objectives = [...objectives, { text: o.trim(), done: false }];
  const relations = { ...state.relations };
  for (const rel of d.relations ?? []) {
    if (!rel.name?.trim()) continue;
    const cur = relations[rel.name.trim()] ?? { attitude: 0, note: '' };
    relations[rel.name.trim()] = { attitude: Math.max(-3, Math.min(3, cur.attitude + (Number(rel.delta) || 0))), note: rel.note?.trim() || cur.note };
  }
  const inventory = removeFromInventory(mergeInventory(state.inventory, d.gained ?? []), d.lost ?? []);
  const next: PovState = { ...state, resources: r, money: Math.max(0, Math.round(state.money + (Number(d.money) || 0))), inventory, conditions, objectives, relations, down: state.down || r.health === 0 };
  return { state: next, notes: crossed(before, r) };
}

function sameish(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const x = n(a);
  const y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/** Use one of an inventory item: apply its effects, take one away. */
export function useItem(state: PovState, name: string, effects: Partial<Record<Resource, number>>): { state: PovState; notes: string[] } {
  return applyDelta(state, { resources: effects, lost: [{ name, qty: 1 }] });
}

function level(v: number): string {
  if (v >= 85) return 'excellent';
  if (v >= 60) return 'good';
  if (v >= 40) return 'fair';
  if (v >= LOW) return 'low';
  if (v > 0) return 'critical';
  return 'none';
}

/** The player's sheet as the writer reads it. Numbers plus plain words, so prose can reflect it without quoting it. */
export function renderPov(state: PovState, o: { name: string; currency: string; difficulty: Difficulty }): string {
  const r = state.resources;
  const lines = [
    `# ${o.name}, the player's character`,
    `Condition: ${RESOURCES.map((k) => `${RESOURCE_INFO[k].label.toLowerCase()} ${level(r[k])} (${r[k]})`).join(', ')}.`,
  ];
  const low = RESOURCES.filter((k) => r[k] < LOW).map((k) => (r[k] === 0 ? RESOURCE_INFO[k].empty : RESOURCE_INFO[k].low));
  if (low.length) lines.push(`They are ${low.join(', ')}; let it show in the body and in what they can do.`);
  if (state.conditions.length) lines.push(`Afflictions: ${state.conditions.join(', ')}.`);
  lines.push(state.inventory.length ? `Carrying: ${state.inventory.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(', ')}.` : 'Carrying nothing of note.');
  lines.push(`Money: ${state.money} ${o.currency || 'coins'}.`);
  const open = state.objectives.filter((x) => !x.done);
  if (open.length) lines.push(`Their open aims: ${open.map((x) => x.text).join('; ')}.`);
  const rel = Object.entries(state.relations).filter(([, v]) => v.attitude !== 0 || v.note);
  if (rel.length) lines.push(`Standing with people: ${rel.map(([n, v]) => `${n} ${v.attitude > 0 ? `+${v.attitude}` : v.attitude}${v.note ? ` (${v.note})` : ''}`).join('; ')}.`);
  if (state.down) lines.push(o.difficulty === 'hardcore' ? 'They have fallen. This is the end of their story unless something extraordinary intervenes; write it with weight.' : 'They are down: unconscious, captured or at someone’s mercy. Write what happens to them, then let them come round with a cost.');
  if (o.difficulty !== 'story') lines.push('Survival matters: food, water, rest and shelter are real needs and things run out.');
  return lines.join('\n');
}

export function sceneOf(state: SceneState | null | undefined): SceneState {
  return state ?? { locationId: null, locationName: '' };
}
