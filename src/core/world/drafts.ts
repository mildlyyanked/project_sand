import type { Character, LoreEntry, Species, Universe } from '../types';
import { now } from '../ids';
import type { FieldDef } from './schema';
import { CHARACTER_FIELDS, ITEM_FIELDS, LOCATION_FIELDS, LORE_CATEGORIES, ORGANIZATION_FIELDS, SPECIES_FIELDS, WORLD_FIELDS } from './schema';
import type { EntityKind, Membership, WorldCalendar, WorldEntity } from './types';

/**
 * Library entries as drafts: every kind as a flat record of fields, with
 * references held as names instead of ids. Forge writes drafts, the draft
 * editor edits them, existing entries convert to drafts so the model can read
 * them, and `planDrafts` turns drafts back into library rows, resolving names
 * and filling the links on both sides.
 */
export type LibKind = 'world' | 'species' | 'lore' | 'character' | EntityKind;

export interface Library {
  universe: Universe | null;
  entities: WorldEntity[];
  characters: Character[];
  species: Species[];
  lore: LoreEntry[];
}

export interface Draft {
  /** The library id for an existing entry; a fresh id, kept on save, for a new one. */
  id: string;
  kind: LibKind;
  name: string;
  fields: Record<string, unknown>;
  existing?: boolean;
}

export const KIND_NOUN: Record<LibKind, string> = { world: 'World', location: 'Place', organization: 'Faction', item: 'Thing', character: 'Character', species: 'People', lore: 'Lore' };
export const KIND_NOUN_PLURAL: Record<LibKind, string> = { world: 'Worlds', location: 'Places', organization: 'Factions', item: 'Things', character: 'Characters', species: 'Peoples', lore: 'Lore' };

const SUMMARY: FieldDef = { key: 'summary', label: 'In a line', type: 'text', hint: 'Always sent to the writer when this comes up.', inContext: true };
const KEYS: FieldDef = { key: 'keys', label: 'Also called', type: 'keys', hint: 'Comma separated. Any of these in the story brings this into the scene.' };
export const NAME_FIELD: FieldDef = { key: 'name', label: 'Name', type: 'text' };

const charField = (k: string) => CHARACTER_FIELDS.find((f) => f.key === k)!;

/** Every field a draft of each kind carries, in editing order. */
export const DRAFT_FIELDS: Record<LibKind, FieldDef[]> = {
  world: [{ key: 'description', label: 'Description', type: 'long', hint: 'Always sent to the writer when a story is set here.', inContext: true }, ...WORLD_FIELDS],
  location: [SUMMARY, KEYS, { key: 'within', label: 'Inside', type: 'ref', ref: 'location', inContext: true }, { key: 'seatOf', label: 'Seat of', type: 'ref', ref: 'organization', hint: 'The faction whose capital or headquarters this is.', inContext: true }, ...LOCATION_FIELDS],
  organization: [SUMMARY, KEYS, { key: 'within', label: 'Part of', type: 'ref', ref: 'organization', inContext: true }, ...ORGANIZATION_FIELDS],
  item: [SUMMARY, KEYS, ...ITEM_FIELDS],
  species: [{ key: 'adulthood', label: 'Adulthood', type: 'text', hint: "When a member counts as adult, in the world's terms.", inContext: true }, ...SPECIES_FIELDS, { key: 'notes', label: 'Notes', type: 'long', inContext: true }],
  lore: [{ key: 'category', label: 'Category', type: 'select', options: LORE_CATEGORIES, inContext: true }, { ...KEYS, label: 'Keywords', hint: 'Comma separated, lower case. Any of these in the story brings this entry in.' }, { key: 'text', label: 'Text', type: 'long', inContext: true }, { key: 'alwaysOn', label: 'Always on', type: 'bool' }],
  character: [
    { key: 'summary', label: 'Summary', type: 'text', hint: 'One or two lines the writer always sees.', inContext: true },
    { key: 'species', label: 'People', type: 'ref', ref: 'species', inContext: true },
    { key: 'lifeStage', label: 'Life stage', type: 'text', inContext: true },
    { key: 'adult', label: 'Adult', type: 'bool', hint: "By their people's definition. Explicit sessions only take characters with this on." },
    charField('occupation'),
    charField('lookalike'),
    ...['appearance', 'personality', 'backstory', 'goals', 'fears', 'secrets', 'skills'].map(charField),
    { key: 'home', label: 'Home', type: 'ref', ref: 'location', inContext: true },
    { key: 'faction', label: 'Faction', type: 'ref', ref: 'organization', inContext: true },
    { key: 'factionRole', label: 'Role in it', type: 'text', inContext: true },
    { key: 'voice', label: 'Voice', type: 'long', hint: 'How they talk and think.', inContext: true },
    { key: 'tells', label: 'Tells', type: 'text', hint: 'Habits, gestures, verbal tics.', inContext: true },
    { key: 'relationships', label: 'Relationships', type: 'long', inContext: true },
    { key: 'limits', label: 'Limits', type: 'text', hint: 'What this character will not do or have done to them.' },
    { key: 'preferences', label: 'Preferences', type: 'text', hint: 'What they lean into.' },
    charField('inventory'),
    charField('money'),
  ],
};

export function fieldDef(kind: LibKind, key: string): FieldDef | undefined {
  return key === 'name' ? NAME_FIELD : DRAFT_FIELDS[kind].find((f) => f.key === key);
}

/** Lower case, no leading "the", no punctuation: how names are matched. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Library → drafts

const ENTITY_FIELDS: Record<EntityKind, FieldDef[]> = { location: LOCATION_FIELDS, organization: ORGANIZATION_FIELDS, item: ITEM_FIELDS };

function nameIndex(lib: Library) {
  const m = new Map<string, string>();
  for (const e of lib.entities) m.set(e.id, e.name);
  for (const c of lib.characters) m.set(c.id, c.name);
  for (const s of lib.species) m.set(s.id, s.name);
  return (id: unknown) => (typeof id === 'string' && id ? m.get(id) ?? '' : '');
}

function dataToFields(defs: FieldDef[], data: Record<string, unknown>, nameOf: (id: unknown) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = data[d.key];
    if (v == null || v === '') continue;
    out[d.key] = d.type === 'ref' ? nameOf(v) : v;
  }
  return out;
}

export function entityDraft(e: WorldEntity, lib: Library): Draft {
  const nameOf = nameIndex(lib);
  const fields: Record<string, unknown> = { summary: e.summary, keys: e.keys, ...dataToFields(ENTITY_FIELDS[e.kind], e.data, nameOf) };
  if (e.kind !== 'item') fields.within = nameOf(e.parentId);
  if (e.kind === 'location') fields.seatOf = lib.entities.find((o) => o.kind === 'organization' && o.data.headquarters === e.id)?.name ?? '';
  return { id: e.id, kind: e.kind, name: e.name, fields, existing: true };
}

export function characterDraft(c: Character, lib: Library): Draft {
  const nameOf = nameIndex(lib);
  const d = c.data;
  const m = d.memberships?.[0];
  const fields: Record<string, unknown> = {
    summary: c.summary, species: nameOf(c.speciesId), lifeStage: c.lifeStage, adult: c.adult,
    ...dataToFields(CHARACTER_FIELDS.filter((f) => f.key !== 'homeLocationId'), d as Record<string, unknown>, nameOf),
    home: nameOf(d.homeLocationId), faction: m ? nameOf(m.orgId) : '', factionRole: m?.role ?? '',
    voice: c.voice, tells: c.tells, relationships: c.relationships, limits: c.limits, preferences: c.preferences,
  };
  if (d.attributes) fields.attributes = d.attributes;
  return { id: c.id, kind: 'character', name: c.name, fields, existing: true };
}

export function speciesDraft(s: Species, lib: Library): Draft {
  return { id: s.id, kind: 'species', name: s.name, fields: { adulthood: s.adulthood, notes: s.notes, ...dataToFields(SPECIES_FIELDS, s.data, nameIndex(lib)) }, existing: true };
}

export function loreDraft(l: LoreEntry): Draft {
  return { id: l.id, kind: 'lore', name: l.title, fields: { category: l.category, keys: l.keys, text: l.text, alwaysOn: l.alwaysOn }, existing: true };
}

export function worldDraft(u: Universe): Draft {
  return { id: u.id, kind: 'world', name: u.name, fields: { description: u.description, ...Object.fromEntries(WORLD_FIELDS.map((f) => [f.key, (u.data as unknown as Record<string, unknown>)[f.key] ?? ''])) }, existing: true };
}

/** The whole library as drafts, world first. */
export function libraryDrafts(lib: Library): Draft[] {
  return [
    ...(lib.universe ? [worldDraft(lib.universe)] : []),
    ...lib.entities.map((e) => entityDraft(e, lib)),
    ...lib.characters.map((c) => characterDraft(c, lib)),
    ...lib.species.map((s) => speciesDraft(s, lib)),
    ...lib.lore.map(loreDraft),
  ];
}

// ---------------------------------------------------------------------------
// Cards and relevance

function show(def: FieldDef, v: unknown): string {
  if (v == null || v === '') return '';
  if (def.type === 'bool') return '';
  if (def.type === 'keys') return Array.isArray(v) ? v.join(', ') : String(v);
  if (def.type === 'number') return Number(v) ? String(v) : '';
  if (typeof v === 'object') return '';
  return String(v).trim();
}

/** A draft as the model reads it: kind, name, and every filled field. */
export function draftCard(d: Draft, o: { maxField?: number } = {}): string {
  const cut = (s: string) => (o.maxField && s.length > o.maxField ? `${s.slice(0, o.maxField).trimEnd()}…` : s);
  const lines = [`## ${KIND_NOUN[d.kind]}: ${d.name}`];
  for (const def of DRAFT_FIELDS[d.kind]) {
    const v = show(def, d.fields[def.key]);
    if (v) lines.push(`${def.label}: ${cut(v)}`);
  }
  const at = d.fields.attributes as Record<string, number> | undefined;
  if (d.kind === 'character' && at && Object.keys(at).length) lines.push(`Attributes: ${Object.entries(at).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return lines.join('\n');
}

function textOf(d: Draft): string {
  return [d.name, ...Object.values(d.fields).map((v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : ''))].join(' \n ').toLowerCase();
}

function refValues(d: Draft): string[] {
  return DRAFT_FIELDS[d.kind].filter((f) => f.type === 'ref').map((f) => d.fields[f.key]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(normName);
}

const mentions = (hay: string, name: string) => {
  const n = name.toLowerCase().trim();
  return n.length >= 3 && new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(hay);
};

/**
 * Library entries that matter to the focus, most first: direct links either
 * way, names mentioned either way, shared keywords, siblings.
 */
export function related(focus: { name: string; kind?: LibKind; fields?: Record<string, unknown>; id?: string } | null, pool: Draft[], extraText = ''): Draft[] {
  const f: Draft | null = focus ? { id: focus.id ?? '', kind: focus.kind ?? 'lore', name: focus.name, fields: focus.fields ?? {} } : null;
  const ftext = `${f ? textOf(f) : ''} ${extraText.toLowerCase()}`;
  const fname = f ? normName(f.name) : '';
  const frefs = f ? refValues(f) : [];
  const scored: { d: Draft; s: number }[] = [];
  for (const d of pool) {
    if (d.kind === 'world' || (f && (d.id === f.id || (fname && normName(d.name) === fname && d.kind === f.kind)))) continue;
    let s = 0;
    const dn = normName(d.name);
    if (frefs.includes(dn)) s += 10;
    if (fname && refValues(d).includes(fname)) s += 10;
    if (mentions(ftext, d.name)) s += 6;
    if (f && f.name && mentions(textOf(d), f.name)) s += 5;
    const keys = Array.isArray(d.fields.keys) ? (d.fields.keys as string[]) : [];
    if (keys.some((k) => mentions(ftext, k))) s += 3;
    if (f && typeof f.fields.within === 'string' && f.fields.within && d.fields.within === f.fields.within) s += 2;
    if (s > 0) scored.push({ d, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.d);
}

/** One line per entry, grouped by kind: what exists, so new entries fit and do not repeat. */
export function roster(pool: Draft[], maxChars = 3500): string {
  const groups: string[] = [];
  for (const kind of ['location', 'organization', 'character', 'species', 'item', 'lore'] as LibKind[]) {
    const items = pool.filter((d) => d.kind === kind);
    if (!items.length) continue;
    const line = (d: Draft) => {
      const within = typeof d.fields.within === 'string' && d.fields.within ? ` (in ${d.fields.within})` : '';
      const sum = typeof d.fields.summary === 'string' && d.fields.summary ? ` — ${d.fields.summary.slice(0, 70)}` : '';
      return `- ${d.name}${within}${kind === 'character' || kind === 'organization' ? sum : ''}`;
    };
    groups.push(`${KIND_NOUN_PLURAL[kind]}:\n${items.map(line).join('\n')}`);
  }
  const s = groups.join('\n');
  return s.length > maxChars ? `${s.slice(0, maxChars)}\n…` : s;
}

/**
 * What the model needs to know about the world before writing into it: the
 * world card, a roster of every entry, and full cards of the entries that
 * matter to the focus, within a budget.
 */
export function knowledge(pool: Draft[], focus: Parameters<typeof related>[0], extraText = '', budget = 9000): string {
  const world = pool.find((d) => d.kind === 'world');
  const parts: string[] = [];
  if (world) parts.push(`# World: ${world.name}\n${draftCard({ ...world, name: world.name }, { maxField: 1400 }).split('\n').slice(1).join('\n')}`);
  const others = pool.filter((d) => d.kind !== 'world');
  if (others.length) parts.push(`# Already in this world\n${roster(others)}`);
  let used = parts.join('\n\n').length;
  const cards: string[] = [];
  for (const d of related(focus, others, extraText)) {
    const c = draftCard(d, { maxField: 500 });
    if (used + c.length > budget) break;
    cards.push(c);
    used += c.length;
  }
  if (cards.length) parts.push(`# Entries that bear on this\n${cards.join('\n\n')}`);
  return parts.join('\n\n');
}

/** Loose threads worth filling: what a "surprise me" can grow from. */
export function hooks(pool: Draft[], max = 8): string[] {
  const out: string[] = [];
  const has = (kind: LibKind, name: string) => pool.some((d) => d.kind === kind && normName(d.name) === normName(name));
  for (const d of pool) {
    const f = d.fields;
    if (d.kind === 'organization') {
      if (!f.leader) out.push(`${d.name} has no leader yet.`);
      if (!f.headquarters) out.push(`${d.name} has no headquarters yet.`);
      if (typeof f.enemies === 'string' && f.enemies && !pool.some((x) => x.kind === 'organization' && x.id !== d.id && mentions(f.enemies as string, x.name))) out.push(`${d.name}'s enemies (${f.enemies.slice(0, 80)}) are not in the library.`);
    }
    if (d.kind === 'location' && !pool.some((x) => x.kind === 'location' && x.fields.within === d.name) && ['city', 'town', 'nation', 'region', 'district', 'station', 'planet', 'continent'].includes(String(f.type ?? ''))) out.push(`${d.name} has nothing inside it yet.`);
    if (d.kind === 'location' && !pool.some((x) => x.kind === 'character' && x.fields.home === d.name) && ['city', 'town', 'village', 'district', 'building', 'station', 'ship'].includes(String(f.type ?? ''))) out.push(`Nobody lives in ${d.name} yet.`);
    if (d.kind === 'character' && !f.faction && !f.home) out.push(`${d.name} has no home or faction.`);
    if (d.kind === 'character' && typeof f.relationships === 'string' && f.relationships) {
      const named = f.relationships.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)?/g) ?? [];
      for (const n of named) if (n.length > 3 && !has('character', n) && !pool.some((x) => normName(x.name) === normName(n))) { out.push(`${d.name} knows ${n}, who is not in the library.`); break; }
    }
  }
  // Shuffle deterministically by length so the same library does not always offer the same first hook.
  return out.sort((a, b) => (a.length * 7) % 11 - (b.length * 7) % 11).slice(0, max);
}

// ---------------------------------------------------------------------------
// Drafts → library rows

export interface Plan {
  universe: Universe | null;
  entities: WorldEntity[];
  characters: Character[];
  species: Species[];
  lore: LoreEntry[];
  /** What was linked beyond the drafts themselves, for the person to read. */
  notes: string[];
}

const LEADER_ROLE = /\b(leader|head|chief|chieftain|king|queen|emperor|empress|president|chancellor|grand ?master|captain|commander|boss|founder|high priest(?:ess)?|matriarch|patriarch|director|ceo|ruler|premier|governor|sovereign|warlord|abbess|abbot|prophet)\b/i;

const asStr = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const asKeys = (v: unknown) => (Array.isArray(v) ? v.map(asStr) : asStr(v).split(',')).map((k) => k.trim().toLowerCase()).filter(Boolean);

function nearby(text: string, name: string, cue: RegExp, window = 70): boolean {
  const hay = text.toLowerCase();
  const n = name.toLowerCase();
  let i = hay.indexOf(n);
  while (i >= 0) {
    const around = hay.slice(Math.max(0, i - window), i + n.length + window);
    if (cue.test(around)) return true;
    i = hay.indexOf(n, i + 1);
  }
  return false;
}

const DEFAULT_CAL: WorldCalendar = { kind: 'custom', start: '2026-01-01T08:00', yearLabel: '', startYear: 1, daysPerYear: 0, monthNames: [], hoursPerDay: 24 };

/**
 * Turn drafts into library rows. New drafts become new rows with their draft
 * ids; drafts of existing entries update those rows. Names in reference fields
 * resolve against the library and the other drafts; links are written on both
 * sides (a place that is the seat of a faction becomes that faction's
 * headquarters, a character who leads a faction becomes its leader, a thing
 * held by someone goes into their inventory), and older entries whose text
 * already points at a new one get the link they were missing.
 */
export function planDrafts(drafts: Draft[], lib: Library, universeId: string | null, o: { calendar?: WorldCalendar; defaultData?: Universe['data'] } = {}): Plan {
  const t = now();
  const notes: string[] = [];
  let universe: Universe | null = null;
  const live = drafts.filter((d) => d.name.trim());
  const worldDraft = live.find((d) => d.kind === 'world' && !d.existing);
  if (worldDraft) {
    const f = worldDraft.fields;
    const data = { ...(o.defaultData ?? ({} as Universe['data'])), ...Object.fromEntries(WORLD_FIELDS.map((w) => [w.key, asStr(f[w.key])])), calendar: (f.calendar as WorldCalendar | undefined) ?? o.calendar ?? DEFAULT_CAL } as Universe['data'];
    universe = { id: worldDraft.id, name: worldDraft.name.trim(), description: asStr(f.description), isDefault: false, data, createdAt: t, updatedAt: t };
    universeId = universe.id;
  } else {
    const ex = live.find((d) => d.kind === 'world' && d.existing);
    if (ex && lib.universe && lib.universe.id === ex.id) {
      const f = ex.fields;
      universe = { ...lib.universe, name: ex.name.trim(), description: asStr(f.description), data: { ...lib.universe.data, ...Object.fromEntries(WORLD_FIELDS.map((w) => [w.key, asStr(f[w.key])])) }, updatedAt: t };
    }
  }
  const uid = universeId ?? '';

  // Working copies: everything in the library plus a row per draft.
  const entities = new Map(lib.entities.map((e) => [e.id, e]));
  const characters = new Map(lib.characters.map((c) => [c.id, c]));
  const species = new Map(lib.species.map((s) => [s.id, s]));
  const lore = new Map(lib.lore.map((l) => [l.id, l]));
  const touched = new Set<string>();
  const fresh = new Set<string>();
  const touch = <T extends { id: string }>(m: Map<string, T>, v: T) => { m.set(v.id, v); touched.add(v.id); };

  for (const d of live) {
    if (d.kind === 'world') continue;
    if (!d.existing) fresh.add(d.id);
    const f = d.fields;
    if (d.kind === 'location' || d.kind === 'organization' || d.kind === 'item') {
      const base = entities.get(d.id) ?? { id: d.id, universeId: uid, kind: d.kind, name: d.name, parentId: null, summary: '', keys: [], data: {}, createdAt: t, updatedAt: t };
      const data: Record<string, unknown> = { ...base.data };
      for (const def of ENTITY_FIELDS[d.kind]) if (def.type !== 'ref' && def.key in f) data[def.key] = def.type === 'number' ? Number(f[def.key]) || 0 : f[def.key];
      touch(entities, { ...base, name: d.name.trim(), summary: asStr(f.summary), keys: asKeys(f.keys), data, updatedAt: t });
    } else if (d.kind === 'character') {
      const base = characters.get(d.id) ?? { id: d.id, universeId: universeId, speciesId: null, name: d.name, lifeStage: '', adult: true, summary: '', voice: '', tells: '', relationships: '', limits: '', preferences: '', data: {}, createdAt: t, updatedAt: t };
      const data: Record<string, unknown> = { ...base.data };
      for (const def of CHARACTER_FIELDS) if (def.type !== 'ref' && def.key in f) data[def.key] = def.type === 'number' ? Number(f[def.key]) || 0 : asStr(f[def.key]);
      if (f.attributes && typeof f.attributes === 'object') data.attributes = f.attributes;
      touch(characters, { ...base, name: d.name.trim(), summary: asStr(f.summary), lifeStage: asStr(f.lifeStage), adult: f.adult !== false, voice: asStr(f.voice), tells: asStr(f.tells), relationships: asStr(f.relationships), limits: asStr(f.limits), preferences: asStr(f.preferences), data: data as Character['data'], updatedAt: t });
    } else if (d.kind === 'species') {
      const base = species.get(d.id) ?? { id: d.id, universeId: uid, name: d.name, adulthood: '', notes: '', data: {} };
      const data: Record<string, unknown> = { ...base.data };
      for (const def of SPECIES_FIELDS) if (def.type !== 'ref' && def.key in f) data[def.key] = asStr(f[def.key]);
      touch(species, { ...base, name: d.name.trim(), adulthood: asStr(f.adulthood), notes: asStr(f.notes), data });
    } else if (d.kind === 'lore') {
      const base = lore.get(d.id) ?? { id: d.id, universeId: uid, title: d.name, keys: [], text: '', alwaysOn: false, priority: 0, category: 'other' };
      const alwaysOn = f.alwaysOn === true;
      touch(lore, { ...base, title: d.name.trim(), keys: asKeys(f.keys), text: asStr(f.text), alwaysOn, priority: alwaysOn ? Math.max(1, base.priority) : base.priority, category: LORE_CATEGORIES.includes(asStr(f.category)) ? asStr(f.category) : 'other' });
    }
  }

  // Name lookups over everything, drafts included. Exact match first, then without "the" and punctuation.
  const find = (kind: 'location' | 'organization' | 'item' | 'character' | 'species', name: unknown): string | null => {
    const n = asStr(name);
    if (!n || /^(none|n\/a|-|unknown)$/i.test(n)) return null;
    const rows: { id: string; name: string }[] = kind === 'character' ? [...characters.values()].filter((c) => !c.universeId || c.universeId === uid) : kind === 'species' ? [...species.values()] : [...entities.values()].filter((e) => e.kind === kind);
    const exact = rows.find((r) => r.name.trim().toLowerCase() === n.toLowerCase());
    if (exact) return exact.id;
    const nn = normName(n);
    return rows.find((r) => normName(r.name) === nn)?.id ?? null;
  };
  const nameOf = (id: string) => entities.get(id)?.name ?? characters.get(id)?.name ?? species.get(id)?.name ?? '';
  const setData = (id: string, key: string, value: unknown) => {
    const e = entities.get(id);
    if (e) touch(entities, { ...e, data: { ...e.data, [key]: value }, updatedAt: t });
  };

  // Each draft's own references.
  for (const d of live) {
    const f = d.fields;
    if (d.kind === 'location' || d.kind === 'organization' || d.kind === 'item') {
      const e = entities.get(d.id)!;
      const data: Record<string, unknown> = { ...e.data };
      for (const def of ENTITY_FIELDS[d.kind]) if (def.type === 'ref' && def.ref && def.key in f) data[def.key] = find(def.ref, f[def.key]) ?? '';
      let parentId = e.parentId;
      if (d.kind !== 'item' && 'within' in f) {
        const p = find(d.kind, f.within);
        parentId = p && p !== e.id ? p : null;
      }
      touch(entities, { ...e, data, parentId });
    } else if (d.kind === 'character') {
      const c = characters.get(d.id)!;
      const speciesId = 'species' in f ? find('species', f.species) : c.speciesId;
      const home = 'home' in f ? find('location', f.home) : c.data.homeLocationId ?? null;
      let memberships: Membership[] = [...(c.data.memberships ?? [])];
      if ('faction' in f) {
        const org = find('organization', f.faction);
        const rest = memberships.slice(1).filter((m) => m.orgId !== org);
        memberships = org ? [{ orgId: org, role: asStr(f.factionRole) }, ...rest] : rest;
      }
      touch(characters, { ...c, speciesId, data: { ...c.data, homeLocationId: home, memberships } });
    } else if (d.kind === 'species') {
      const sp = species.get(d.id)!;
      if ('homeland' in f) touch(species, { ...sp, data: { ...sp.data, homeland: find('location', f.homeland) ?? '' } });
    }
  }

  // Links on the other side, once every draft holds its own.
  for (const d of live) {
    const f = d.fields;
    if (d.kind === 'location' && asStr(f.seatOf)) {
      const e = entities.get(d.id)!;
      const org = find('organization', f.seatOf);
      const o = org ? entities.get(org) : undefined;
      const hq = o ? String(o.data.headquarters ?? '') : '';
      if (o && hq !== e.id && (!hq || !entities.has(hq) || !fresh.has(o.id))) {
        notes.push(hq && entities.has(hq) ? `${o.name}: headquarters moved from ${nameOf(hq)} to ${e.name}` : `${o.name}: headquarters set to ${e.name}`);
        setData(o.id, 'headquarters', e.id);
      }
      if (o && !entities.get(e.id)!.data.controlledBy) setData(e.id, 'controlledBy', o.id);
    }
    if (d.kind === 'organization') {
      const e = entities.get(d.id)!;
      const c = e.data.leader ? characters.get(String(e.data.leader)) : undefined;
      if (c && !(c.data.memberships ?? []).some((m) => m.orgId === e.id)) {
        touch(characters, { ...c, data: { ...c.data, memberships: [...(c.data.memberships ?? []), { orgId: e.id, role: 'leader' }] }, updatedAt: t });
        if (!fresh.has(c.id)) notes.push(`${c.name}: now leads ${e.name}`);
      }
    }
    if (d.kind === 'item') {
      const e = entities.get(d.id)!;
      const c = e.data.owner ? characters.get(String(e.data.owner)) : undefined;
      if (c && !(c.data.inventory ?? '').toLowerCase().includes(e.name.toLowerCase())) {
        touch(characters, { ...c, data: { ...c.data, inventory: [c.data.inventory ?? '', e.name].filter(Boolean).join('\n') }, updatedAt: t });
        notes.push(`${c.name}: carries ${e.name}`);
      }
    }
    if (d.kind === 'character') {
      const c = characters.get(d.id)!;
      const lead = c.data.memberships?.[0];
      const o = lead && LEADER_ROLE.test(lead.role) ? entities.get(lead.orgId) : undefined;
      if (o && !o.data.leader) {
        setData(o.id, 'leader', c.id);
        notes.push(`${o.name}: leader set to ${c.name}`);
      }
    }
  }

  // Older entries whose own words already point at something new.
  const textFields = (o: Record<string, unknown>, extra: string[] = []) => [...extra, ...Object.values(o).filter((v): v is string => typeof v === 'string')].join(' \n ');
  for (const id of fresh) {
    const e = entities.get(id);
    const c = characters.get(id);
    if (e?.kind === 'location') {
      for (const o of [...entities.values()].filter((x) => x.kind === 'organization' && !x.data.headquarters && !fresh.has(x.id))) {
        if (nearby(textFields(o.data, [o.summary]), e.name, /headquarter|\bseat\b|capital|based|\bbase\b|stronghold|throne|citadel|home of/)) {
          setData(o.id, 'headquarters', e.id);
          notes.push(`${o.name}: headquarters set to ${e.name}`);
        }
      }
      for (const p of [...characters.values()].filter((x) => !x.data.homeLocationId && !fresh.has(x.id) && (!x.universeId || x.universeId === uid))) {
        if (nearby(textFields(p.data as Record<string, unknown>, [p.summary, p.relationships]), e.name, /\blives?\b|living|\bhome\b|resides|dwells|keeps house/)) {
          touch(characters, { ...p, data: { ...p.data, homeLocationId: e.id }, updatedAt: t });
          notes.push(`${p.name}: home set to ${e.name}`);
        }
      }
    }
    if (e?.kind === 'organization') {
      for (const l of [...entities.values()].filter((x) => x.kind === 'location' && !x.data.controlledBy && !fresh.has(x.id))) {
        if (nearby(textFields(l.data, [l.summary]), e.name, /ruled|controlled|held by|governed|territory|occupied|owned by|domain/)) {
          setData(l.id, 'controlledBy', e.id);
          notes.push(`${l.name}: controlled by ${e.name}`);
        }
      }
    }
    if (c) {
      for (const o of [...entities.values()].filter((x) => x.kind === 'organization' && !x.data.leader && !fresh.has(x.id))) {
        if (nearby(textFields(o.data, [o.summary]), c.name, /led by|leader|\bhead\b|ruled by|\bking\b|\bqueen\b|master|chief|captain|commander|founded by/)) {
          setData(o.id, 'leader', c.id);
          notes.push(`${o.name}: leader set to ${c.name}`);
        }
      }
    }
  }

  const pick = <T extends { id: string }>(m: Map<string, T>) => [...m.values()].filter((v) => touched.has(v.id));
  return { universe, entities: pick(entities), characters: pick(characters), species: pick(species), lore: pick(lore), notes: [...new Set(notes)] };
}
