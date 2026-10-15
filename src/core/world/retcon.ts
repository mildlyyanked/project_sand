import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import { DRAFT_FIELDS, KIND_NOUN, draftCard, fieldDef, normName, related, type Draft, type LibKind } from './drafts';
import { fieldValue } from './forge';

/**
 * Retcon: change an entry and carry the change through the world. A rename is
 * worked out locally (every mention and every reference by name); anything
 * else is proposed by the model as field edits on the entries it touches, for
 * the person to review before anything is saved.
 */
export interface RetconEdit {
  id: string;
  kind: LibKind;
  name: string;
  key: string;
  before: unknown;
  after: unknown;
  why: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(name)}(?=$|[^\\p{L}\\p{N}])`, 'gu');

/** Every place the old name stands in the world, rewritten to the new one. */
export function renameEdits(pool: Draft[], target: Draft, to: string): RetconEdit[] {
  const from = target.name.trim();
  const next = to.trim();
  if (!from || !next || from === next) return [];
  const out: RetconEdit[] = [{ id: target.id, kind: target.kind, name: from, key: 'name', before: from, after: next, why: 'renamed' }];
  const re = wordRe(from);
  for (const d of pool) {
    for (const def of DRAFT_FIELDS[d.kind]) {
      const v = d.fields[def.key];
      if (def.type === 'ref') {
        if (typeof v === 'string' && normName(v) === normName(from) && (!def.ref || def.ref === target.kind)) out.push({ id: d.id, kind: d.kind, name: d.name, key: def.key, before: v, after: next, why: `points at ${from}` });
      } else if (def.type === 'keys') {
        const keys = Array.isArray(v) ? (v as string[]) : [];
        if (keys.some((k) => k === from.toLowerCase())) out.push({ id: d.id, kind: d.kind, name: d.name, key: def.key, before: keys, after: keys.map((k) => (k === from.toLowerCase() ? next.toLowerCase() : k)), why: `keyword ${from.toLowerCase()}` });
      } else if (typeof v === 'string' && re.test(v)) {
        re.lastIndex = 0;
        out.push({ id: d.id, kind: d.kind, name: d.name, key: def.key, before: v, after: v.replace(wordRe(from), (_m, pre: string) => `${pre}${next}`), why: `mentions ${from}` });
      }
      re.lastIndex = 0;
    }
  }
  return out;
}

const KEYS_BY_KIND = (Object.keys(DRAFT_FIELDS) as LibKind[]).map((k) => `${k}: name, ${DRAFT_FIELDS[k].map((f) => f.key).join(', ')}`).join('\n');

/** Entries the change could reach: linked to the target, naming it, or named by it. */
export function affected(pool: Draft[], target: Draft, change: string, max = 14): Draft[] {
  return related(target, pool, change).slice(0, max);
}

export function retconPrompt(o: { target: Draft; change: string; renameTo?: string; affected: Draft[]; knowledge: string }): ChatMessage[] {
  const rename = o.renameTo && o.renameTo.trim() !== o.target.name ? `It is also renamed from ${o.target.name} to ${o.renameTo.trim()}; that rename is handled already, so use the new name in what you write and do not propose name changes for it.` : '';
  return [
    { role: 'system', content: [
      "You keep a fiction writer's world consistent after a retcon: the writer changes the truth about one entry, and you rewrite whatever else in the world must change so it agrees. Touch only what the retcon makes untrue, contradictory or incomplete; leave everything else as it is. Edit the changed entry itself too, so its own fields say the new truth.",
      'Each edit replaces one whole field with its new full value. Keep the voice and length of the field; change the facts, not the style. Reference fields (within, home, faction, leader, headquarters, owner, species, controlledBy, seatOf, homeland...) take an exact entry name, or "" to clear.',
      `Field keys by kind:\n${KEYS_BY_KIND}`,
      'Output only JSON: {"edits": [{"entry": string (exact name of the entry as it is now), "kind": string, "field": string (a key above), "value": the new value, "why": string (a few words)}]}. An empty list if nothing needs to change.',
    ].join('\n\n') },
    { role: 'user', content: [
      o.knowledge,
      `# The entry being retconned\n${draftCard(o.target)}`,
      o.affected.length ? `# Entries it touches\n${o.affected.map((d) => draftCard(d, { maxField: 600 })).join('\n\n')}` : '',
      `# The retcon\n${o.change.trim()}${rename ? `\n${rename}` : ''}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

/** The model's edits, held against the world: unknown entries, unknown fields and no-op edits are dropped. */
export function parseRetcon(text: string, pool: Draft[]): RetconEdit[] {
  const j = lenientJson<{ edits?: unknown }>(text);
  const list = j && Array.isArray(j.edits) ? j.edits : [];
  const out: RetconEdit[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const name = typeof r.entry === 'string' ? r.entry : typeof r.name === 'string' ? r.name : '';
    const kind = typeof r.kind === 'string' ? r.kind.toLowerCase() : '';
    const d = pool.find((p) => normName(p.name) === normName(name) && (!kind || p.kind === kind || KIND_NOUN[p.kind].toLowerCase() === kind)) ?? pool.find((p) => normName(p.name) === normName(name));
    const key = typeof r.field === 'string' ? r.field : '';
    if (!d || !key) continue;
    const def = fieldDef(d.kind, key);
    if (!def) continue;
    const after = key === 'name' ? (typeof r.value === 'string' ? r.value.trim() : '') : fieldValue(def, r.value);
    if (after === undefined || (key === 'name' && !after)) continue;
    const before = key === 'name' ? d.name : d.fields[key];
    if (JSON.stringify(before ?? '') === JSON.stringify(after ?? '')) continue;
    out.push({ id: d.id, kind: d.kind, name: d.name, key, before, after, why: typeof r.why === 'string' ? r.why : '' });
  }
  return out;
}

/** Rename edits first; a model edit to the same field replaces the rename's mechanical one. */
export function mergeEdits(rename: RetconEdit[], model: RetconEdit[]): RetconEdit[] {
  const k = (e: RetconEdit) => `${e.id}:${e.key}`;
  const byKey = new Map<string, RetconEdit>();
  for (const e of rename) byKey.set(k(e), e);
  for (const e of model) if (!(e.key === 'name' && byKey.has(k(e)))) byKey.set(k(e), e);
  return [...byKey.values()];
}

/** The drafts the chosen edits produce, one per entry touched. */
export function applyEdits(pool: Draft[], edits: RetconEdit[]): Draft[] {
  const out = new Map<string, Draft>();
  for (const e of edits) {
    const base = out.get(e.id) ?? pool.find((d) => d.id === e.id);
    if (!base) continue;
    out.set(e.id, e.key === 'name' ? { ...base, name: String(e.after) } : { ...base, fields: { ...base.fields, [e.key]: e.after } });
  }
  return [...out.values()];
}
