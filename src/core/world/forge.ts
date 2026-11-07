import type { ChatMessage } from '../types';
import { newId } from '../ids';
import { lenientJson } from '../json';
import type { ArtBible, FieldDef } from './schema';
import { BIBLE_FIELDS, bibleOf } from './schema';
import { TIE_SHAPE, parseTies } from './links';
import { foldLegacy } from './upgrade';
import { DRAFT_FIELDS, KIND_NOUN, draftCard, fieldDef, normName, type Draft, type LibKind } from './drafts';

/**
 * Forge: the writer model invents library entries as drafts. Every call is
 * given what the world already holds (see `knowledge` in drafts.ts), so new
 * entries fit it, link to it by name, and do not repeat it.
 */
export type ForgeKind = LibKind | 'mixed';

const FORGE_LABEL: Record<string, string> = { character: 'a character', location: 'a place', organization: 'a faction', item: 'a thing', species: 'a people' };

/** One field as the JSON shape asks for it. */
function shapeField(def: FieldDef): string | null {
  if (def.forge === false || def.type === 'ties') return null;
  const hint = typeof def.forge === 'string' ? def.forge : '';
  const t = (base: string) => `"${def.key}": ${base}${hint && base !== 'number' ? ` (${hint})` : hint && base === 'number' ? ` ${hint}` : ''}`;
  switch (def.type) {
    case 'select': return `"${def.key}": one of ${(def.options ?? []).join('|')}`;
    case 'ref': return `"${def.key}": string (${hint || `${FORGE_LABEL[def.ref ?? 'location']} by exact name, or ""`})`;
    case 'number': return t('number');
    case 'bool': return t('boolean');
    case 'keys': return t('string[]');
    case 'lines': return `"${def.key}": string (one item per line, like "2 × waterskin")`;
    default: return t('string');
  }
}

const SPECIAL: Partial<Record<LibKind, string[]>> = {
  location: ['"within": string (the place it sits inside, by exact name, or "")', '"seatOf": string (the faction whose capital or headquarters this is, by exact name, or "")'],
  organization: ['"within": string (parent faction by exact name, or "")'],
  character: ['"attributes": {"might": 1-5, "agility": 1-5, "wits": 1-5, "presence": 1-5, "resolve": 1-5} (2 is ordinary; total about 13)'],
};

/** The JSON shape forge asks for, built from the same fields the editors show, so the two never drift. */
export function entryShape(kind: Exclude<LibKind, 'world'>): string {
  const special = SPECIAL[kind] ?? [];
  const fields = DRAFT_FIELDS[kind].filter((d) => !special.some((x) => x.startsWith(`"${d.key}"`))).map(shapeField).filter((x): x is string => !!x);
  const name = kind === 'lore' ? '"title"' : '"name"';
  const ties = DRAFT_FIELDS[kind].some((d) => d.type === 'ties') ? [TIE_SHAPE] : [];
  // Within and seat of read best next to the name; attributes after the person.
  const head = kind === 'character' ? [] : special;
  const tail = kind === 'character' ? special : [];
  return `{${[name, ...head, ...fields, ...tail, ...ties].join(', ')}}`;
}

const SHAPE_OF = (kind: Exclude<LibKind, 'world'>) => entryShape(kind);
const LIST_KEY: Record<Exclude<LibKind, 'world'>, string> = { location: 'places', organization: 'factions', item: 'things', species: 'species', lore: 'lore', character: 'characters' };
const LIST_ALIASES: Record<Exclude<LibKind, 'world'>, string[]> = { location: ['places', 'locations'], organization: ['factions', 'organizations', 'groups'], item: ['things', 'items', 'objects'], species: ['species', 'peoples', 'races'], lore: ['lore', 'entries'], character: ['characters', 'people', 'persons'] };

const BIBLE_SHAPE = `"art": {${BIBLE_FIELDS.map((b) => `"${b.key}": string (${b.hint.toLowerCase().replace(/\.$/, '')})`).join(', ')}} (the style bible every picture of this world follows: one line each, one coherent look)`;
const worldShape = () => `{"name": string (2 to 4 words), ${DRAFT_FIELDS.world.map(shapeField).filter(Boolean).join(', ')}, ${BIBLE_SHAPE}, "calendar": {"kind": "custom" | "gregorian", "yearLabel": string, "startYear": number, "daysPerYear": number, "monthNames": string[], "start": "YYYY-MM-DDTHH:MM" for gregorian}, "places": [${SHAPE_OF('location')}] (4 to 7, nested: at least one place inside another), "factions": [${SHAPE_OF('organization')}] (2 to 4), "species": [${SHAPE_OF('species')}] (0 to 3, only if the world calls for them), "lore": [${SHAPE_OF('lore')}] (2 to 4)}`;
const mixedShape = () => `{"places": [${SHAPE_OF('location')}], "factions": [${SHAPE_OF('organization')}], "characters": [${SHAPE_OF('character')}], "things": [${SHAPE_OF('item')}], "species": [${SHAPE_OF('species')}], "lore": [${SHAPE_OF('lore')}]} (leave out the lists you do not use)`;

export function forgeShape(kind: ForgeKind): string {
  if (kind === 'world') return worldShape();
  if (kind === 'mixed') return mixedShape();
  return `{"${LIST_KEY[kind]}": [${SHAPE_OF(kind)}]}`;
}

const NOUN: Record<ForgeKind, [string, string]> = { world: ['world', 'worlds'], location: ['place', 'places'], organization: ['faction', 'factions'], item: ['thing', 'things'], species: ['people', 'peoples'], lore: ['lore entry', 'lore entries'], character: ['character', 'characters'], mixed: ['entry', 'entries'] };
export const forgeNoun = (kind: ForgeKind, n: number) => NOUN[kind][n === 1 ? 0 : 1];

/** How a new entry of `kind` should tie to the entry it is forged under. */
export function anchorLink(anchor: { kind: LibKind; name: string }, kind: ForgeKind): string {
  const n = anchor.name;
  const key = `${anchor.kind}>${kind}`;
  const about = `Each is about ${n}: its history, customs, rumours or secrets. Include words that name ${n} among the keys.`;
  const rules: Record<string, string> = {
    'location>location': `Each place sits inside ${n}: set "within" to "${n}", or to another new place that is itself inside it.`,
    'location>character': `Each lives in or is bound to ${n}: set "home" to "${n}" or to a place inside it.`,
    'location>organization': `Each operates in ${n}: set "headquarters" to "${n}" or a place inside it.`,
    'location>item': `Each is found or kept in ${n}: set "location" to "${n}".`,
    'location>lore': about,
    'location>species': `Each people lives in ${n}: set "homeland" to "${n}".`,
    'organization>organization': `Each is a branch, cell or chapter of ${n}: set "within" to "${n}".`,
    'organization>character': `Each belongs to ${n}: set "faction" to "${n}" and give each a distinct "factionRole". At most one leads it, and only if it has no leader yet.`,
    'organization>location': `Each is held, controlled or used by ${n}: set "controlledBy" to "${n}". If ${n} has no headquarters yet, one of them may be its seat ("seatOf": "${n}").`,
    'organization>item': `Each belongs to ${n} or matters to it; say how in "origin" or "properties".`,
    'organization>lore': about,
    'character>character': `Each is someone in ${n}'s life: family, rival, lover, creditor, mentor, enemy. Describe the tie in "relationships", naming ${n}.`,
    'character>item': `Each is something ${n} owns or carries: set "owner" to "${n}".`,
    'character>location': `Each is a place in ${n}'s life: a home, a haunt, where they come from, where they are going. Say how in its description, naming ${n}.`,
    'character>organization': `Each is a group ${n} is tied to: one they serve, betrayed, fled or fight. Set "leader" to "${n}" only for one they lead.`,
    'character>lore': about,
    'species>character': `Each is one of the ${n}: set "species" to "${n}".`,
    'species>location': `Each is a place of the ${n}: their homeland, a sacred site, a settlement. Say so in its description.`,
    'species>lore': about,
    'item>character': `Each is someone tied to ${n}: who made it, holds it, wants it or lost it. Name ${n} in their backstory or goals.`,
    'item>location': `Each is a place tied to ${n}: where it was made, kept, lost or sought.`,
    'item>lore': about,
    'lore>lore': `Each takes ${n} further: what it leads to, contradicts or hides.`,
  };
  return rules[key] ?? `Each is tied to ${n}; make the tie explicit in its fields, naming ${n}.`;
}

export interface ForgeRequest {
  wish: string;
  count: number;
  /** World card, roster and relevant entries: from `knowledge`. */
  knowledge: string;
  /** Forge under an existing entry. */
  anchor?: Draft;
  /** No wish: grow from what is there. */
  surprise?: { hooks: string[] };
  /** For characters: a real person or fictional character whose look inspires theirs. */
  lookalike?: string;
  /** Canonize: a name that appeared in a story, with the passages that show it. */
  canon?: { name: string; excerpts: string[] };
}

export function forgePrompt(kind: ForgeKind, o: ForgeRequest): ChatMessage[] {
  const n = kind === 'world' ? 1 : o.count;
  const what = kind === 'world' ? 'a world' : kind === 'mixed' ? `${n} entries of whatever kinds the world most needs` : `${n} ${forgeNoun(kind, n)}`;
  const system = [
    `You invent material for a fiction writer's library: ${what}, as JSON. Everything is invented fiction for an adult author; write with the specificity of a good novelist, not a catalogue. Concrete details over adjectives; one strange, memorable particular per entry.`,
    'Fit what already exists. The world and its entries are below: stay consistent with them, never contradict them, never repeat a name or an idea already there. When a field names another entry (within, home, faction, leader, headquarters, owner, species...), use that entry\'s exact name, whether it already exists or you are creating it now. Tie new entries to existing ones wherever it makes the world denser: a new person belongs somewhere, a new place is controlled by someone, a new thing has an owner or a home.',
    kind === 'world' ? 'Make it a place stories can happen in: tensions between factions, places with dangers and resources, a calendar that suits it (real dates for a world like ours, its own reckoning otherwise). Keep each place, faction and people field to a sentence or two so the whole world fits in one reply.' : '',
    kind === 'character' || kind === 'mixed' ? 'Each character must be someone a scene could turn on: a want, a flaw, a way of speaking that is theirs alone. Keep names pronounceable and distinct from each other and from the names already there.' : '',
    kind === 'lore' ? 'Each entry is what a writer needs when its subject comes up: how it works, how it looks, what it costs, who cares. Keywords are the words a passage would use.' : '',
    kind === 'location' ? 'Places nest: use "within" to put a district in a city or a room in a building, naming an existing place or one you are creating now.' : '',
    kind === 'mixed' ? 'Choose the kinds yourself: whatever would most enrich the world as it stands. Link the new entries to each other and to what exists.' : '',
    o.lookalike?.trim() && (kind === 'character' || kind === 'mixed') ? `The look of the character is inspired by ${o.lookalike.trim()}. Write the appearance from that look in your own words (face, build, colouring, hair, bearing, style of dress) as it would exist in this world, without naming them anywhere.` : '',
    o.canon ? `This entry already exists in a story. Everything the story passages state about ${o.canon.name} is fact: keep their name, what they did, said and looked like, where they were and with whom. Fill everything else so it fits those facts and the world.` : '',
    `Output only JSON of this shape: ${forgeShape(kind)}. Inside string values quote with single quotes, never bare double quotes. ${kind === 'world' ? 'Exactly one world.' : `Exactly ${n} ${kind === 'mixed' ? 'entries in total' : forgeNoun(kind, n)}.`}`,
  ].filter(Boolean).join('\n\n');
  const wish = o.wish.trim();
  const user = [
    o.knowledge || (kind === 'world' ? '' : 'No world is attached; invent what the wish needs and keep it self-contained.'),
    o.anchor ? `# Forge under this entry\n${draftCard(o.anchor, { maxField: 900 })}\n\n${anchorLink(o.anchor, kind)}` : '',
    o.canon ? `# From the story\n${o.canon.name} appears in these passages:\n${o.canon.excerpts.map((x) => `> ${x.replace(/\n+/g, ' ')}`).join('\n\n')}` : '',
    o.surprise ? `# Surprise me\nNo wish: grow the world from what is already there. Pick up loose threads, give names to what is only hinted at, add what would make the world denser and stranger.${o.surprise.hooks.length ? `\nLoose threads you may pull:\n${o.surprise.hooks.map((h) => `- ${h}`).join('\n')}` : ''}` : '',
    o.surprise && !wish ? '' : `What I want: ${wish || (o.canon ? `the entry for ${o.canon.name}` : kind === 'world' ? 'a world worth setting stories in' : 'something that fits and surprises')}`,
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// ---------------------------------------------------------------------------
// Parsing forge replies into drafts

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const keyList = (v: unknown) => (Array.isArray(v) ? v.map(str) : str(v).split(',')).map((k) => k.trim().toLowerCase()).filter(Boolean);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : v && typeof v === 'object' ? [v as Record<string, unknown>] : []);

export function fieldValue(def: FieldDef, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  switch (def.type) {
    case 'number': {
      const x = Number(v);
      return Number.isFinite(x) ? x : undefined;
    }
    case 'bool':
      return v === true || /^(true|yes|y|1)$/i.test(str(v));
    case 'keys':
      return keyList(v);
    case 'lines':
      return Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? `${str((x as { qty?: unknown }).qty) ? `${str((x as { qty?: unknown }).qty)} × ` : ''}${str((x as { name?: unknown }).name)}` : str(x))).filter(Boolean).join('\n') : str(v);
    case 'select': {
      const s = str(v).toLowerCase();
      return def.options?.find((o) => o === s) ?? str(v);
    }
    default:
      return Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : str(v);
  }
}

export function itemDraft(kind: LibKind, raw: Record<string, unknown>): Draft | null {
  const name = str(raw.name ?? raw.title);
  if (!name) return null;
  // A reply in the library's older shape still lands in the new fields.
  let o = raw;
  if (kind !== 'lore') {
    const folded = foldLegacy(kind, raw);
    o = folded.data;
    const into = kind === 'species' ? 'culture' : 'aims';
    for (const t of folded.ties) o[into] = [str(o[into]), `${t.type === 'ally' ? 'Allies' : t.type === 'enemy' ? 'Enemies' : 'Relations'}: ${t.text}`].filter(Boolean).join('\n\n');
    if (kind === 'character' && str(raw.tells)) o.personality = [str(o.personality), `Tells: ${str(raw.tells)}`].filter(Boolean).join('\n\n');
  }
  const fields: Record<string, unknown> = {};
  for (const def of DRAFT_FIELDS[kind]) {
    const v = fieldValue(def, o[def.key]);
    if (v !== undefined && v !== '') fields[def.key] = v;
  }
  const ties = parseTies(o.ties);
  if (ties.length) fields.ties = ties;
  else delete fields.ties;
  if (kind === 'world' && o.art && typeof o.art === 'object') fields.art = bibleOf(o.art as Partial<ArtBible>);
  if (kind === 'character') {
    fields.adult = o.adult !== false && !/^(false|no)$/i.test(str(o.adult));
    const at = o.attributes && typeof o.attributes === 'object' ? (o.attributes as Record<string, unknown>) : null;
    if (at) fields.attributes = Object.fromEntries(['might', 'agility', 'wits', 'presence', 'resolve'].map((k) => [k, Math.max(1, Math.min(5, Math.round(Number(at[k]) || 2)))]));
  }
  if (kind === 'lore') {
    fields.alwaysOn = o.alwaysOn === true;
    if (!fields.category) fields.category = 'other';
    if (!fields.text) return null;
  }
  return { id: newId(), kind, name, fields };
}

function listOf(j: Record<string, unknown>, kind: Exclude<LibKind, 'world'>): Record<string, unknown>[] {
  for (const k of LIST_ALIASES[kind]) if (Array.isArray(j[k])) return arr(j[k]);
  return [];
}

/** A forge reply as drafts, world first. Null when nothing usable came back. */
export function parseForgeDrafts(kind: ForgeKind, text: string, o: { lookalike?: string } = {}): Draft[] | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const out: Draft[] = [];
  const kinds: Exclude<LibKind, 'world'>[] = ['location', 'organization', 'species', 'character', 'item', 'lore'];
  if (kind === 'world') {
    const w = itemDraft('world', j);
    if (!w) return null;
    const c = j.calendar && typeof j.calendar === 'object' ? (j.calendar as Record<string, unknown>) : null;
    if (c) {
      const greg = c.kind === 'gregorian';
      w.fields.calendar = { kind: greg ? 'gregorian' : 'custom', yearLabel: str(c.yearLabel), startYear: Math.round(Number(c.startYear) || 1), daysPerYear: greg ? 365 : Math.max(0, Math.round(Number(c.daysPerYear) || 0)), monthNames: Array.isArray(c.monthNames) ? c.monthNames.map(str).filter(Boolean) : [], start: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str(c.start)) ? str(c.start) : '2026-01-01T08:00', hoursPerDay: 24 };
    }
    out.push(w);
    for (const k of kinds) for (const x of listOf(j, k)) { const d = itemDraft(k, x); if (d) out.push(d); }
  } else if (kind === 'mixed') {
    for (const k of kinds) for (const x of listOf(j, k)) { const d = itemDraft(k, x); if (d) out.push(d); }
  } else {
    let list = listOf(j, kind);
    if (!list.length && (j.name || j.title)) list = [j];
    if (!list.length) list = arr(Object.values(j).find((v) => Array.isArray(v)));
    for (const x of list) { const d = itemDraft(kind, x); if (d) out.push(d); }
  }
  if (o.lookalike?.trim()) for (const d of out) if (d.kind === 'character' && !d.fields.lookalike) d.fields.lookalike = o.lookalike.trim();
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Reforging one field

export function fieldForgePrompt(o: { draft: Draft; key: string; instruction: string; knowledge: string; options?: string[] }): ChatMessage[] {
  const def = fieldDef(o.draft.kind, o.key) ?? { key: o.key, label: o.key, type: 'text' as const };
  const current = o.key === 'name' ? o.draft.name : o.draft.fields[o.key];
  const shown = Array.isArray(current) ? current.join(', ') : current == null ? '' : String(current);
  const form: Record<string, string> = {
    text: 'A short phrase or one or two sentences.',
    long: 'One or two paragraphs at most; concrete, usable in a scene.',
    lines: 'One item per line, like "2 × waterskin".',
    number: 'A number only.',
    bool: 'yes or no.',
    keys: 'Comma-separated lower-case words or short phrases.',
    select: `Exactly one of: ${(def.options ?? []).join(', ')}.`,
    ref: `Exactly one name from this list, or "none": ${(o.options ?? []).join('; ') || '(the list is empty: answer none)'}.`,
    effects: 'Like "satiety +30, hydration +10", or nothing.',
  };
  const lookalike = o.key === 'appearance' && typeof o.draft.fields.lookalike === 'string' && o.draft.fields.lookalike.trim() ? ` Base the look on ${o.draft.fields.lookalike.trim()}, described in your own words (face, build, colouring, hair, bearing, dress) as it would exist in this world; never name them.` : '';
  return [
    { role: 'system', content: `You revise one field of an entry in a fiction writer's library. Write only the new value of the field "${def.label}" for the ${KIND_NOUN[o.draft.kind].toLowerCase()} "${o.draft.name}": no label, no quotes, no commentary. ${form[def.type] ?? form.text} Stay consistent with the rest of the entry and with the world; follow the instruction if there is one, otherwise make the field more specific, more particular and more useful in a scene.${o.key === 'name' ? ' A name only, distinct from every name already in the world.' : ''}${lookalike}` },
    { role: 'user', content: [o.knowledge, `# The entry\n${draftCard(o.draft)}`, `Current ${def.label}: ${shown || '(empty)'}`, `Instruction: ${o.instruction.trim() || 'none; improve it.'}`].filter(Boolean).join('\n\n') },
  ];
}

/** The model's answer as a value for the field, or null when it cannot be one. */
export function parseFieldValue(def: FieldDef, text: string, options: string[] = []): unknown {
  let s = text.trim().replace(/^```[a-z]*\s*|\s*```$/g, '').trim();
  s = s.replace(new RegExp(`^${def.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '').trim();
  if (/^".*"$/s.test(s) && !s.slice(1, -1).includes('"')) s = s.slice(1, -1).trim();
  if (!s) return null;
  switch (def.type) {
    case 'number': {
      const m = /-?\d+(?:\.\d+)?/.exec(s);
      return m ? Number(m[0]) : null;
    }
    case 'bool':
      return /^(yes|true|y)\b/i.test(s) ? true : /^(no|false|n)\b/i.test(s) ? false : null;
    case 'keys':
      return keyList(s);
    case 'select': {
      const low = s.toLowerCase();
      return def.options?.find((o) => low === o) ?? def.options?.find((o) => low.includes(o)) ?? null;
    }
    case 'ref': {
      if (/^none\b/i.test(s)) return '';
      const n = normName(s);
      return options.find((o) => normName(o) === n) ?? options.find((o) => n.includes(normName(o)) && normName(o).length > 2) ?? null;
    }
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Pictures of entries

/** What the helper describes for each kind: the subject only. Style and framing are fixed separately. */
const SUBJECT: Record<LibKind, string> = {
  character: 'the person: face, age, build, colouring, hair, expression and bearing exactly as the appearance says, and clothing and adornment that fit the world, its era and technology',
  location: 'the place as a traveller first sees it: architecture or terrain, materials, weather, time of day, signs of who lives or works there',
  organization: "the faction's device: one central symbol and at most two supporting elements, drawn from their symbols, ideals and history, with its colours",
  item: 'the object: shape, size, materials, wear and craft, any markings as shapes',
  species: 'a typical member of this people: body, skin or covering, features and typical dress',
  lore: 'the central image of the lore',
  world: 'the world at a glance',
};

export const DEFAULT_ART_STYLE = 'Painterly digital illustration, restrained natural palette, soft directional light, fine detail, grounded and cinematic';
export const DEFAULT_SIGIL_STYLE = 'Flat heraldic emblem, two or three solid colours, bold simple shapes, centred and symmetrical on a plain field, like a seal or banner device';

/** Framing per kind, so every portrait sits the same way, every view is shot the same way. */
const FRAME: Record<LibKind, string> = {
  character: 'Portrait, head and shoulders, three-quarter view, eye level, softly blurred background',
  location: 'Wide establishing view at eye level, natural perspective, a sense of scale',
  organization: '',
  item: 'Object study, centred, three-quarter view, plain neutral background',
  species: 'Full-figure study of one individual, standing, plain neutral background',
  lore: 'Narrative illustration',
  world: 'Panoramic view',
};

/** Which line of the bible frames each kind of picture. */
const BIBLE_KEY: Partial<Record<LibKind, keyof ArtBible>> = { character: 'portraits', species: 'portraits', location: 'places', item: 'things' };

const clause = (s: string) => s.trim().replace(/[.\s]+$/, '');

/**
 * The final picture prompt: the bible's look, then its framing for the kind
 * (or the default framing), then the helper's description of the subject.
 * The same look and framing every time is what makes a world's pictures
 * match. Sigils follow their own line of the bible: heraldry, not paint.
 */
export function composePicture(kind: LibKind, subject: string, bible: Partial<ArtBible> = {}): string {
  const b = bibleOf(bible);
  if (kind === 'organization') return [clause(b.sigils || DEFAULT_SIGIL_STYLE), `The device: ${clause(subject)}`, 'No text, letters or words'].filter(Boolean).join('. ') + '.';
  const key = BIBLE_KEY[kind];
  const frame = (key && b[key]) || FRAME[kind];
  return [clause(b.look || DEFAULT_ART_STYLE), clause(frame), clause(subject), 'No text or lettering'].filter(Boolean).join('. ') + '.';
}

/**
 * A style bible for a world, written whole so its lines agree: the shared
 * look and how portraits, places, things and sigils sit within it. Starts
 * from the world and whatever the bible already says; `only` rewrites one
 * line and keeps the rest.
 */
export function biblePrompt(o: { world: string; current: Partial<ArtBible>; people: string[]; wish: string; only?: keyof ArtBible }): ChatMessage[] {
  const cur = bibleOf(o.current);
  const filled = BIBLE_FIELDS.filter((f) => cur[f.key]).map((f) => `${f.label}: ${cur[f.key]}`).join('\n');
  const which = o.only ? BIBLE_FIELDS.find((f) => f.key === o.only)! : null;
  return [
    { role: 'system', content: [
      'You write the style bible for a story world: the fixed art direction an image model follows for every picture of it, so they all look like one body of work. Be concrete and visual: medium and rendering, palette, light, texture, influences; for each kind of picture, its framing (crop, angle, lens, background, scale). Fit the world exactly. Never name, describe or invent a particular character, place or object; never mention text or lettering.',
      which ? `Rewrite only "${which.label}" (${which.hint}), consistent with the other lines. 25 to 70 words. Output only that line, no label.` : `Output only JSON: {${BIBLE_FIELDS.map((f) => `"${f.key}": string (${f.hint.toLowerCase().replace(/\.$/, '')})`).join(', ')}}. Each 25 to 70 words; the four framings build on the look, except sigils, which are flat heraldry in the world's own idiom.`,
    ].join('\n\n') },
    { role: 'user', content: [o.world, filled ? `The bible so far (keep what works, refine the rest):\n${filled}` : '', o.people.length ? `Some of the people to be portrayed (for range only): ${o.people.slice(0, 6).join(' | ')}` : '', o.wish ? `What the writer wants: ${o.wish}` : ''].filter(Boolean).join('\n\n') },
  ];
}

/** A bible reply: the whole bible, or one line of it. Null when unusable. */
export function parseBible(text: string, only?: keyof ArtBible): Partial<ArtBible> | null {
  if (only) {
    const v = text.trim().replace(/^```[a-z]*\s*|\s*```$/g, '').replace(/^[A-Za-z ]+:\s*/, '').replace(/^"|"$/g, '').trim();
    return v ? { [only]: v } : null;
  }
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const out: Partial<ArtBible> = {};
  for (const f of BIBLE_FIELDS) if (typeof j[f.key] === 'string' && (j[f.key] as string).trim()) out[f.key] = (j[f.key] as string).trim();
  return Object.keys(out).length ? out : null;
}

/** The helper's half of a picture prompt: what the entry looks like, nothing about style. */
export function entryImagePrompt(o: { draft: Draft; world: string }): ChatMessage[] {
  const d = { ...o.draft, fields: { ...o.draft.fields } };
  delete d.fields.lookalike;
  delete d.fields.image;
  return [
    { role: 'system', content: `You describe ${SUBJECT[d.kind]}, for an image model. Use only what the entry gives, made concrete and visible: shapes, colours, materials, textures. Do not mention art medium, style, lighting, camera, framing or composition: those are fixed separately so every picture of this world matches. Describe people by appearance, never by name. No text or lettering. 40 to 90 words, one paragraph, output only the description.` },
    { role: 'user', content: [o.world ? `World: ${o.world}` : '', draftCard(d, { maxField: 700 })].filter(Boolean).join('\n\n') },
  ];
}

// ---------------------------------------------------------------------------
// Newcomers: names that appear in a story but not in the library

export interface Newcomer { name: string; kind: 'character' | 'location' | 'organization' | 'item'; note: string; beatId?: string }
const NEWCOMER_KINDS = ['character', 'location', 'organization', 'item'] as const;

export function newcomersPrompt(o: { passage: string; known: string[] }): ChatMessage[] {
  return [
    { role: 'system', content: 'You read a passage of fiction and list the named people, places, factions and things in it that are not in the known list. Only proper names that the story treats as real within it (not metaphors, not famous real people mentioned in passing, not the known names in another form). Output only JSON: {"newcomers": [{"name": string (as the passage gives it), "kind": "character" | "location" | "organization" | "item", "note": string (one line: who or what it is, from the passage)}]}. An empty list when there are none.' },
    { role: 'user', content: `${o.known.length ? `Known names: ${o.known.slice(0, 200).join(', ')}\n\n` : ''}Passage:\n${o.passage}` },
  ];
}

export function parseNewcomers(v: unknown, known: string[]): Newcomer[] {
  const j = typeof v === 'string' ? lenientJson<Record<string, unknown>>(v) : (v as Record<string, unknown> | null);
  const list = j && Array.isArray(j.newcomers) ? j.newcomers : Array.isArray(v) ? v : [];
  const seen = new Set(known.map(normName));
  const out: Newcomer[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const name = str(r.name);
    const kind = NEWCOMER_KINDS.find((k) => k === str(r.kind).toLowerCase()) ?? (/^(place|location)$/i.test(str(r.kind)) ? 'location' : /^(faction|group|organization)$/i.test(str(r.kind)) ? 'organization' : /^(thing|object|item)$/i.test(str(r.kind)) ? 'item' : 'character');
    const nn = normName(name);
    if (!name || name.length > 60 || !nn || seen.has(nn)) continue;
    seen.add(nn);
    out.push({ name, kind, note: str(r.note).slice(0, 200) });
  }
  return out.slice(0, 8);
}

/** Sentences of the story that mention a name, newest last: what the story says about it. */
export function excerptsFor(name: string, passages: string[], max = 5): string[] {
  const n = name.toLowerCase();
  const out: string[] = [];
  for (const p of passages) {
    const sentences = p.split(/(?<=[.!?…])\s+|\n+/);
    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i]!.toLowerCase().includes(n)) continue;
      out.push([sentences[i - 1], sentences[i], sentences[i + 1]].filter(Boolean).join(' ').trim());
    }
  }
  return out.slice(-max);
}

/** Where the model left the tie to the anchor out, put it in: the entries were asked for under it. */
export function ensureAnchor(drafts: Draft[], anchor: { kind: LibKind; name: string } | null | undefined): Draft[] {
  if (!anchor) return drafts;
  const rule: Partial<Record<string, string>> = {
    'location>location': 'within', 'location>character': 'home', 'location>organization': 'headquarters', 'location>item': 'location', 'location>species': 'homeland',
    'organization>organization': 'within', 'organization>character': 'faction', 'organization>location': 'controlledBy',
    'character>item': 'owner', 'species>character': 'species',
  };
  const newNames = new Set(drafts.map((d) => normName(d.name)));
  return drafts.map((d) => {
    const key = rule[`${anchor.kind}>${d.kind}`];
    if (!key) return d;
    const v = d.fields[key];
    // A place nested inside another new place is still under the anchor.
    if (typeof v === 'string' && v.trim() && (normName(v) === normName(anchor.name) || newNames.has(normName(v)))) return d;
    if (typeof v === 'string' && v.trim() && key !== 'within' && key !== 'home') return d;
    return { ...d, fields: { ...d.fields, [key]: anchor.name } };
  });
}
