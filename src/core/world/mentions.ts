import { DRAFT_FIELDS, KIND_NOUN, normName, type Draft } from './drafts';
import type { PovState } from './types';

/**
 * Library entries named in a passage, for the tooltips in play: where each
 * entry is first named, and the short card shown when that name is tapped.
 * Local matching only, no model call.
 */
export interface Mention { start: number; end: number; id: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const proper = (s: string) => /^\p{Lu}/u.test(s);

/** The ways a passage can name an entry: its name (with "the" in either case), proper-noun aliases, and a person's distinctive first name. */
function needles(d: Draft): string[] {
  const name = d.name.trim();
  const bare = name.replace(/^the\s+/i, '');
  // "The Hollow" may be "the Hollow", but a lone "Hollow" is too likely to be an ordinary word.
  const out = [name, bare === name ? name : `the ${bare}`, /\s/.test(bare) ? bare : ''];
  const keys = d.kind === 'lore' ? [] : Array.isArray(d.fields.keys) ? (d.fields.keys as unknown[]).map(String) : [];
  out.push(...keys.map((k) => k.trim()).filter(proper));
  if (d.kind === 'character') {
    const first = name.split(/\s+/)[0]!;
    if (first !== name && proper(first)) out.push(first);
  }
  return out.filter((n, i, a) => n.length >= 3 && a.indexOf(n) === i);
}

/**
 * The first place each entry is named in `text`. Names match case as written,
 * on word boundaries; a needle more than one entry could claim (two Maras) is
 * dropped; where names overlap the longer one wins.
 */
export function findMentions(text: string, entries: Draft[]): Mention[] {
  const owners = new Map<string, Set<string>>();
  for (const d of entries) for (const n of needles(d)) owners.set(n, (owners.get(n) ?? new Set()).add(d.id));
  const hits: Mention[] = [];
  for (const [n, ids] of owners) {
    if (ids.size > 1) continue;
    const id = [...ids][0]!;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, 'gu');
    for (const m of text.matchAll(re)) hits.push({ start: m.index!, end: m.index! + n.length, id });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const taken: Mention[] = [];
  const linked = new Set<string>();
  for (const h of hits) {
    if (linked.has(h.id) || taken.some((t) => h.start < t.end && h.end > t.start)) continue;
    taken.push(h);
    linked.add(h.id);
  }
  return taken;
}

export interface EntryTip {
  name: string;
  /** "Character · Elf · Smuggler". */
  kind: string;
  text: string;
  facts: { label: string; value: string }[];
  /** In play, what the player has to do with it: how someone feels about them, what they carry. */
  yours: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && v ? String(v) : '');

/** A line or two, cut at a sentence when it can be. */
export function brief(s: string, max = 240): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > max * 0.4 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

const ATTITUDE = ['hostile', 'unfriendly', 'wary', 'neutral', 'warm', 'friendly', 'devoted'];

/** What the tooltip shows. Never secrets: only what the entry says openly. */
export function entryTip(d: Draft, o: { pov?: PovState | null; currency?: string } = {}): EntryTip {
  const f = d.fields;
  const label = (k: string) => DRAFT_FIELDS[d.kind].find((x) => x.key === k)?.label ?? k;
  const fact = (k: string, value = str(f[k])) => (value ? [{ label: label(k), value }] : []);
  let kind: string[] = [KIND_NOUN[d.kind]];
  let text = '';
  let facts: EntryTip['facts'] = [];
  switch (d.kind) {
    case 'character':
      kind = [...kind, str(f.species), str(f.occupation)];
      text = str(f.summary) || str(f.appearance) || str(f.personality);
      facts = [...fact('faction', [str(f.faction), str(f.factionRole)].filter(Boolean).join(', ')), ...fact('home')];
      break;
    case 'location':
      kind = [...kind, str(f.type)];
      text = str(f.summary) || str(f.description) || str(f.atmosphere);
      facts = [...fact('within'), ...fact('seatOf'), ...fact('controlledBy'), ...(Number(f.danger) ? fact('danger', `${Number(f.danger)} of 5`) : [])];
      break;
    case 'organization':
      kind = [...kind, str(f.type)];
      text = str(f.summary) || str(f.description) || str(f.reputation);
      facts = [...fact('leader'), ...fact('headquarters'), ...fact('within')];
      break;
    case 'item':
      kind = [...kind, str(f.type), str(f.rarity)];
      text = str(f.summary) || str(f.description);
      facts = [...fact('owner'), ...fact('location'), ...(Number(f.value) ? fact('value', `${Number(f.value)} ${o.currency ?? ''}`.trim()) : [])];
      break;
    case 'species':
      text = str(f.appearance) || str(f.notes) || str(f.traits);
      facts = fact('lifespan');
      break;
    case 'lore':
      kind = [...kind, str(f.category) === 'other' ? '' : str(f.category)];
      text = str(f.text);
      break;
    default:
      text = str(f.description);
  }
  const yours: string[] = [];
  if (o.pov) {
    const n = normName(d.name);
    if (d.kind === 'character') {
      const rel = Object.entries(o.pov.relations).find(([k]) => normName(k) === n)?.[1];
      if (rel) yours.push(`Toward you: ${ATTITUDE[Math.max(-3, Math.min(3, rel.attitude)) + 3]}${rel.note ? `. ${rel.note}` : ''}`);
    }
    const held = o.pov.inventory.find((i) => i.itemId === d.id || normName(i.name) === n);
    if (held) yours.push(`You carry ${held.qty > 1 ? `${held.qty} of these` : 'this'}`);
  }
  return { name: d.name, kind: kind.filter(Boolean).join(' · '), text: brief(text), facts, yours };
}
