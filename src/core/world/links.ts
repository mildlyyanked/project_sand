import type { Id } from '../types';
import type { LibKind, Library } from './drafts';

/**
 * Typed links between library entries, read both ways. Some are written by
 * hand (or by forge) and stored: family, allies, enemies, who serves whom.
 * The rest already live in an entry's fields (where a place sits, who leads
 * a faction, who holds a thing) and are derived, so there is one source of
 * truth for each. Both kinds come out of `edges` as one graph that entry
 * pages, search, tooltips and the writer's context all read.
 */
export type StoredType = 'family' | 'partner' | 'friend' | 'ally' | 'rival' | 'enemy' | 'serves' | 'mentor' | 'knows' | 'tied';
export type DerivedType = 'within' | 'controls' | 'seat' | 'leads' | 'member' | 'holds' | 'kept' | 'home' | 'homeland' | 'people';
export type LinkType = StoredType | DerivedType;

export interface StoredLink {
  id: Id;
  universeId: Id;
  from: Id;
  to: Id;
  type: StoredType;
  /** One line on the tie: "her older brother", "owes him a ship". */
  note: string;
  createdAt: number;
}

export interface LinkInfo {
  /** Read from the entry it starts at. */
  label: string;
  /** Read from the entry it points to. */
  inverse: string;
  symmetric?: boolean;
  /** Kinds it makes sense between, for the picker. Empty: any. */
  between?: LibKind[];
  icon: string;
}

const PEOPLE: LibKind[] = ['character'];
const ACTORS: LibKind[] = ['character', 'organization', 'species'];

export const STORED: Record<StoredType, LinkInfo> = {
  family: { label: 'Family', inverse: 'Family', symmetric: true, between: PEOPLE, icon: 'people-outline' },
  partner: { label: 'Partner', inverse: 'Partner', symmetric: true, between: PEOPLE, icon: 'heart-outline' },
  friend: { label: 'Friend', inverse: 'Friend', symmetric: true, between: PEOPLE, icon: 'happy-outline' },
  mentor: { label: 'Mentor of', inverse: 'Taught by', between: PEOPLE, icon: 'school-outline' },
  serves: { label: 'Serves', inverse: 'Served by', between: ACTORS, icon: 'ribbon-outline' },
  ally: { label: 'Ally', inverse: 'Ally', symmetric: true, between: ACTORS, icon: 'shield-checkmark-outline' },
  rival: { label: 'Rival', inverse: 'Rival', symmetric: true, between: ACTORS, icon: 'flash-outline' },
  enemy: { label: 'Enemy', inverse: 'Enemy', symmetric: true, between: ACTORS, icon: 'skull-outline' },
  knows: { label: 'Knows', inverse: 'Knows', symmetric: true, between: PEOPLE, icon: 'chatbubbles-outline' },
  tied: { label: 'Tied to', inverse: 'Tied to', symmetric: true, icon: 'link-outline' },
};
export const STORED_TYPES = Object.keys(STORED) as StoredType[];

export const DERIVED: Record<DerivedType, LinkInfo & { field: string }> = {
  within: { label: 'Inside', inverse: 'Contains', icon: 'enter-outline', field: 'Inside' },
  controls: { label: 'Controls', inverse: 'Controlled by', icon: 'flag-outline', field: 'Controlled by' },
  seat: { label: 'Based at', inverse: 'Seat of', icon: 'business-outline', field: 'Headquarters' },
  leads: { label: 'Leads', inverse: 'Led by', icon: 'star-outline', field: 'Leader' },
  member: { label: 'Member of', inverse: 'Members', icon: 'id-card-outline', field: 'Belongs to' },
  holds: { label: 'Carries', inverse: 'Held by', icon: 'hand-left-outline', field: 'Held by' },
  kept: { label: 'Kept at', inverse: 'Keeps', icon: 'archive-outline', field: 'Kept at' },
  home: { label: 'Lives in', inverse: 'Home of', icon: 'home-outline', field: 'Home' },
  homeland: { label: 'Homeland', inverse: 'Homeland of', icon: 'earth-outline', field: 'Homeland' },
  people: { label: 'One of the', inverse: 'Members', icon: 'body-outline', field: 'People' },
};

export function linkInfo(type: LinkType): LinkInfo {
  return (STORED as Record<string, LinkInfo>)[type] ?? DERIVED[type as DerivedType];
}

export interface Edge {
  from: Id;
  to: Id;
  type: LinkType;
  note: string;
  derived: boolean;
  /** Stored links only: the row, for editing and deleting. */
  id?: Id;
}

/** Every link in a library: what the fields imply, then what is stored. */
export function edges(lib: Pick<Library, 'entities' | 'characters' | 'species'> & { lore?: Library['lore'] }, stored: StoredLink[]): Edge[] {
  const out: Edge[] = [];
  const ids = new Set<string>([...lib.entities.map((e) => e.id), ...lib.characters.map((c) => c.id), ...lib.species.map((s) => s.id), ...(lib.lore ?? []).map((l) => l.id)]);
  const add = (from: unknown, to: unknown, type: DerivedType, note = '') => {
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || from === to || !ids.has(to)) return;
    out.push({ from, to, type, note, derived: true });
  };
  for (const e of lib.entities) {
    if (e.kind !== 'item') add(e.id, e.parentId, 'within');
    if (e.kind === 'location') add(e.data.controlledBy, e.id, 'controls');
    if (e.kind === 'organization') { add(e.id, e.data.headquarters, 'seat'); add(e.data.leader, e.id, 'leads'); }
    if (e.kind === 'item') { add(e.data.owner, e.id, 'holds'); add(e.id, e.data.location, 'kept'); }
  }
  for (const c of lib.characters) {
    add(c.id, c.data.homeLocationId, 'home');
    add(c.id, c.speciesId, 'people');
    for (const m of c.data.memberships ?? []) {
      if (out.some((x) => x.type === 'leads' && x.from === c.id && x.to === m.orgId)) continue;
      add(c.id, m.orgId, 'member', m.role);
    }
  }
  for (const s of lib.species) add(s.id, s.data.homeland, 'homeland');
  for (const l of stored) if (ids.has(l.from) && ids.has(l.to)) out.push({ from: l.from, to: l.to, type: l.type, note: l.note, derived: false, id: l.id });
  return out;
}

export interface Connection {
  /** How it reads from the entry being looked at: "Ally", "Led by", "Contains". */
  label: string;
  /** The other end. */
  other: Id;
  note: string;
  edge: Edge;
}

/** An entry's links, each read from its side. */
export function connectionsOf(id: Id, all: Edge[]): Connection[] {
  const out: Connection[] = [];
  for (const e of all) {
    if (e.from === id) out.push({ label: linkInfo(e.type).label, other: e.to, note: e.note, edge: e });
    else if (e.to === id) out.push({ label: linkInfo(e.type).inverse, other: e.from, note: e.note, edge: e });
  }
  return out;
}

/** Connections grouped under their labels, in a stable order: the hierarchy first, then people, then the rest. */
export function groupConnections(cs: Connection[]): { label: string; items: Connection[] }[] {
  const order = ['Inside', 'Contains', 'Part of', 'Branches', 'Lives in', 'Home of', 'Led by', 'Leads', 'Member of', 'Members', 'Based at', 'Seat of', 'Controls', 'Controlled by', 'One of the', 'Homeland', 'Homeland of', 'Family', 'Partner', 'Friend', 'Mentor of', 'Taught by', 'Serves', 'Served by', 'Ally', 'Rival', 'Enemy', 'Knows', 'Carries', 'Held by', 'Kept at', 'Keeps', 'Tied to'];
  const m = new Map<string, Connection[]>();
  for (const c of cs) m.set(c.label, [...(m.get(c.label) ?? []), c]);
  return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99)).map(([label, items]) => ({ label, items }));
}

/** Ids within `depth` links of an entry, itself excluded: the neighbourhood a filter or a search can narrow to. */
export function neighbourhood(id: Id, all: Edge[], depth = 1): Set<Id> {
  const seen = new Set<Id>([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: Id[] = [];
    for (const e of all) {
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) {
        if (frontier.includes(a) && !seen.has(b)) { seen.add(b); next.push(b); }
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return seen;
}

/**
 * Stored links as lines for the writer and for tooltips: "Ally: the Salt
 * Guild (since the flood)". Derived links are left out: the fields they come
 * from are already rendered.
 */
export function tieLines(id: Id, all: Edge[], nameOf: (id: Id) => string | undefined, o: { max?: number; derived?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const g of groupConnections(connectionsOf(id, all).filter((c) => o.derived || !c.edge.derived))) {
    const names = g.items.map((c) => { const n = nameOf(c.other); return n ? `${n}${c.note ? ` (${c.note})` : ''}` : ''; }).filter(Boolean);
    if (names.length) out.push(`${g.label}: ${names.join('; ')}`);
    if (o.max && out.length >= o.max) break;
  }
  return out;
}

/** The same tie twice (either direction, for symmetric types) is one tie. */
export function sameTie(a: Pick<StoredLink, 'from' | 'to' | 'type'>, b: Pick<StoredLink, 'from' | 'to' | 'type'>): boolean {
  if (a.type !== b.type) return false;
  if (a.from === b.from && a.to === b.to) return true;
  return !!STORED[a.type]?.symmetric && a.from === b.to && a.to === b.from;
}

const CUES: [StoredType, RegExp][] = [
  ['partner', /\b(wife|husband|spouse|lover|betrothed|fianc[eé]e?|partner|married|beloved|consort|mistress)\b/i],
  ['family', /\b(mother|father|sister|brother|son|daughter|cousin|aunt|uncle|niece|nephew|grand(?:mother|father|son|daughter)|twin|sibling|parent|child|heir|kin)\b/i],
  ['enemy', /\b(enemy|enemies|nemesis|hates?|hated|sworn|blood ?feud|wants? (?:him|her|them) dead|killed|murdered)\b/i],
  ['rival', /\b(rival|rivals|rivalry|competes?|competitor|jealous)\b/i],
  ['mentor', /\b(mentor|teacher|taught|train(?:s|ed|ing)?|apprentice|pupil|student|master)\b/i],
  ['serves', /\b(serves|servant|works for|employ(?:s|er|ed)|sworn to|retainer|bodyguard|agent of|answers to)\b/i],
  ['ally', /\b(ally|allies|allied|alliance|pact|treaty|backs|supports)\b/i],
  ['friend', /\b(friend|friends|confidant|companion|comrade)\b/i],
];

/** A tie's type from the words around a name. */
export function guessTie(sentence: string, fallback: StoredType = 'knows'): StoredType {
  for (const [type, re] of CUES) if (re.test(sentence)) return type;
  return fallback;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ties read out of free text: every candidate named in it, typed from the
 * words around the name, with that sentence as the note. What does not name
 * anyone in the library is left as text.
 */
export function tiesFromText(text: string, candidates: { id: Id; name: string }[], o: { from: Id; universeId: Id; fallback?: StoredType; at?: number }): StoredLink[] {
  if (!text.trim()) return [];
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out: StoredLink[] = [];
  for (const c of candidates) {
    if (c.id === o.from || c.name.trim().length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}])${escape(c.name.trim())}($|[^\\p{L}])`, 'iu');
    const s = sentences.find((x) => re.test(x));
    if (!s) continue;
    const type = guessTie(s, o.fallback);
    const note = s.replace(re, '$1$2').replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').slice(0, 140);
    const link: StoredLink = { id: `${o.from}:${c.id}:${type}`, universeId: o.universeId, from: o.from, to: c.id, type, note: note.length > 3 ? note : '', createdAt: o.at ?? 0 };
    if (!out.some((x) => sameTie(x, link))) out.push(link);
  }
  return out;
}

/** Ties a forge draft asks for, by name: {to, type, note}. Unknown types become plain ties. */
export interface DraftTie { to: string; type: StoredType; note: string }
export function parseTies(v: unknown): DraftTie[] {
  if (!Array.isArray(v)) return [];
  const out: DraftTie[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const to = typeof r.to === 'string' ? r.to.trim() : typeof r.name === 'string' ? r.name.trim() : '';
    if (!to) continue;
    const t = String(r.type ?? '').toLowerCase().trim();
    const type = (STORED_TYPES as string[]).includes(t) ? (t as StoredType) : guessTie(`${t} ${String(r.note ?? '')}`, 'tied');
    out.push({ to, type, note: typeof r.note === 'string' ? r.note.trim().slice(0, 160) : '' });
  }
  return out.slice(0, 12);
}

export const TIE_SHAPE = `"ties": [{"to": string (another entry by exact name, existing or new), "type": one of ${STORED_TYPES.join('|')}, "note": string (one line on the tie)}] (family, love, loyalty, rivalry, enmity, debts; not where it sits or who leads it, which have their own fields)`;
