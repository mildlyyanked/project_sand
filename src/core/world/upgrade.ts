import type { Character, Species, Universe } from '../types';
import type { WorldEntity } from './types';
import type { ArtBible } from './schema';
import { tiesFromText, type StoredLink, type StoredType } from './links';

/**
 * The library before it was consolidated had a field for every facet
 * (atmosphere, climate, features, travel...), many saying the same thing
 * twice. These fold the old fields into the few that replaced them, word for
 * word, so nothing written is lost, and read the free-text ties (allies,
 * enemies, relationships, relations with other peoples) into typed links.
 * Each is idempotent: an entry with no old fields comes back unchanged.
 * Forge replies run through `foldLegacy` too, so a model that answers in the
 * old shape still lands in the new one.
 */

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && v ? String(v) : '');

/** Paragraphs in order, labelled where the label carries meaning; empty parts dropped. */
function join(parts: [string, unknown][], inline = false): string {
  const out: string[] = [];
  const kept: [string, string][] = [];
  for (const [label, v] of parts) {
    const t = s(v);
    if (!t || kept.some(([, o]) => o.includes(t))) continue;
    kept.push([label, t]);
  }
  // Alone in the field, a part needs no label: the field's own name says it.
  for (const [label, t] of kept) out.push(label && kept.length > 1 ? `${label}: ${t}` : t);
  return inline ? out.map((o) => o.replace(/[.\s]+$/, '')).join('. ') : out.join('\n\n');
}

type Fold = { into: string; from: [string, string][]; /** A one-line field: parts join as sentences, not paragraphs. */ inline?: boolean };

/** For each kind: which old keys fold into which new one, and the label each old key keeps. The new key itself goes first, unlabelled. */
const FOLDS: Record<'location' | 'organization' | 'item' | 'species' | 'character' | 'world', Fold[]> = {
  location: [
    { into: 'description', from: [['atmosphere', ''], ['climate', 'Climate and terrain'], ['features', 'Notable features'], ['travel', 'Getting there']] },
    { into: 'life', from: [['population', ''], ['services', 'Trade and services'], ['resources', 'To be found']] },
  ],
  organization: [
    { into: 'aims', from: [['goals', ''], ['methods', 'Methods']] },
    { into: 'structure', from: [['size', ''], ['ranks', 'Ranks'], ['resources', 'Resources']] },
    { into: 'image', from: [['symbols', ''], ['reputation', 'Seen as']], inline: true },
  ],
  item: [
    { into: 'powers', from: [['properties', '']] },
    { into: 'history', from: [['origin', '']] },
    { into: 'description', from: [['weight', 'Weight']] },
  ],
  species: [
    { into: 'nature', from: [['traits', ''], ['abilities', 'Gifts'], ['weaknesses', 'Weaknesses'], ['needs', 'Needs']] },
  ],
  character: [
    { into: 'drives', from: [['goals', 'Wants'], ['fears', 'Fears']] },
  ],
  world: [
    { into: 'genre', from: [['tone', 'Tone']], inline: true },
    { into: 'rules', from: [['technology', 'Technology']] },
  ],
};

/** Free-text ties left in old keys: the key, and the type a tie found in it gets when its words say nothing more. */
const TIE_KEYS: Partial<Record<keyof typeof FOLDS, [string, StoredType][]>> = {
  organization: [['allies', 'ally'], ['enemies', 'enemy']],
  species: [['relations', 'tied']],
};

/** Fold old keys of a flat record into the new ones. Returns the record and the tie texts it carried. */
export function foldLegacy(kind: keyof typeof FOLDS, rec: Record<string, unknown>): { data: Record<string, unknown>; ties: { text: string; type: StoredType }[] } {
  const data = { ...rec };
  for (const f of FOLDS[kind]) {
    if (!f.from.some(([k]) => s(data[k]))) { for (const [k] of f.from) delete data[k]; continue; }
    // A key folded into the field it shares a name with (resources twice for places) is handled by the first fold only.
    data[f.into] = join([['', data[f.into]], ...f.from.map(([k, label]) => [label, data[k]] as [string, unknown])], f.inline);
    for (const [k] of f.from) delete data[k];
  }
  const ties: { text: string; type: StoredType }[] = [];
  for (const [k, type] of TIE_KEYS[kind] ?? []) {
    const t = s(data[k]);
    if (t) ties.push({ text: t, type });
    delete data[k];
  }
  return { data, ties };
}

export interface Candidates { id: string; name: string }

/** What an upgrade produced: the row, the links it found, and whether anything changed. */
export interface Upgraded<T> { row: T; links: StoredLink[]; changed: boolean }

const LEGACY_LOCATION = ['atmosphere', 'climate', 'features', 'travel', 'population', 'services', 'resources'];
const LEGACY_ORG = ['goals', 'methods', 'size', 'ranks', 'resources', 'symbols', 'reputation', 'allies', 'enemies'];
const LEGACY_ITEM = ['properties', 'origin', 'weight'];
const has = (d: Record<string, unknown>, keys: string[]) => keys.some((k) => k in d);

/** Leftover tie text that named nobody in the library stays readable, appended to the field it fits. */
function keepUnresolved(text: string, label: string, found: StoredLink[]): string {
  return found.length ? '' : `${label}: ${text}`;
}

export function upgradeEntity(e: WorldEntity, candidates: Candidates[], at = 0): Upgraded<WorldEntity> {
  const legacy = e.kind === 'location' ? LEGACY_LOCATION : e.kind === 'organization' ? LEGACY_ORG : LEGACY_ITEM;
  if (!has(e.data, legacy)) return { row: e, links: [], changed: false };
  const { data, ties } = foldLegacy(e.kind, e.data);
  const links: StoredLink[] = [];
  const rest: string[] = [];
  for (const t of ties) {
    const found = tiesFromText(t.text, candidates.filter((c) => c.id !== e.id), { from: e.id, universeId: e.universeId, fallback: t.type, at });
    // Allies and enemies say which they are; the words around a name only refine "relations".
    const typed = found.map((l) => (t.type === 'tied' ? l : { ...l, type: t.type, id: `${e.id}:${l.to}:${t.type}` }));
    links.push(...typed);
    const left = keepUnresolved(t.text, t.type === 'ally' ? 'Allies' : t.type === 'enemy' ? 'Enemies' : 'Relations', typed);
    if (left) rest.push(left);
  }
  if (rest.length) data.aims = join([['', data.aims], ...rest.map((r) => ['', r] as [string, unknown])]);
  return { row: { ...e, data }, links, changed: true };
}

export function upgradeSpecies(sp: Species, candidates: Candidates[], at = 0): Upgraded<Species> {
  const legacy = ['traits', 'abilities', 'weaknesses', 'needs', 'relations'];
  if (!has(sp.data, legacy) && !sp.notes.trim()) return { row: sp, links: [], changed: false };
  const { data, ties } = foldLegacy('species', sp.data);
  const links: StoredLink[] = [];
  const rest: string[] = [];
  for (const t of ties) {
    const found = tiesFromText(t.text, candidates.filter((c) => c.id !== sp.id), { from: sp.id, universeId: sp.universeId, fallback: 'tied', at });
    links.push(...found);
    const left = keepUnresolved(t.text, 'Relations with other peoples', found);
    if (left) rest.push(left);
  }
  data.culture = join([['', data.culture], ['', sp.notes], ...rest.map((r) => ['', r] as [string, unknown])]);
  return { row: { ...sp, notes: '', data }, links, changed: true };
}

/**
 * A character: goals and fears become wants and fears, tells join the
 * personality, and every library person, faction or people named in the
 * relationships text becomes a typed tie. The text stays, as other ties: the
 * people in it who are not in the library are still worth knowing.
 */
export function upgradeCharacter(c: Character, candidates: Candidates[], at = 0): Upgraded<Character> {
  const d = c.data as Record<string, unknown>;
  const legacy = has(d, ['goals', 'fears']) || !!c.tells.trim();
  const links = c.universeId && c.relationships.trim() ? tiesFromText(c.relationships, candidates.filter((x) => x.id !== c.id), { from: c.id, universeId: c.universeId, at }) : [];
  if (!legacy && !links.length) return { row: c, links: [], changed: false };
  const { data } = foldLegacy('character', d);
  data.personality = join([['', data.personality], ['Tells', c.tells]]);
  // What became a tie leaves the text; what names no one in the library stays.
  const tied = candidates.filter((x) => links.some((l) => l.to === x.id)).map((x) => x.name.toLowerCase());
  const rest = links.length ? c.relationships.split(/(?<=[.!?;])\s+|\n+/).filter((x) => x.trim() && !tied.some((n) => x.toLowerCase().includes(n))).join(' ').trim() : c.relationships;
  return { row: { ...c, tells: '', relationships: rest, data: data as Character['data'] }, links, changed: true };
}

/** A world: tone joins genre, technology joins the rules, and the three loose art fields become one style bible. */
export function upgradeWorld(u: Universe): Upgraded<Universe> {
  const d = u.data;
  const legacy = ['tone', 'technology', 'artStyle', 'sigilStyle', 'portraitStyle'].some((k) => k in d);
  if (!legacy) return { row: u, links: [], changed: false };
  const { data } = foldLegacy('world', d as unknown as Record<string, unknown>);
  const art: Partial<ArtBible> = { ...(d.art ?? {}) };
  if (s(d.artStyle) && !s(art.look)) art.look = s(d.artStyle);
  if (s(d.sigilStyle) && !s(art.sigils)) art.sigils = s(d.sigilStyle);
  if (s(d.portraitStyle) && !s(art.portraits)) art.portraits = s(d.portraitStyle);
  delete data.artStyle; delete data.sigilStyle; delete data.portraitStyle;
  return { row: { ...u, data: { ...(data as unknown as Universe['data']), art } }, links: [], changed: true };
}
