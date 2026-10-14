import type { Character, LoreEntry, Species, Universe } from '../types';
import type { FieldDef } from './schema';
import { CHARACTER_FIELDS, FIELDS_BY_KIND, SPECIES_FIELDS, WORLD_FIELDS } from './schema';
import type { WorldEntity } from './types';
import { locationChain } from './scan';

export type RefName = (id: string) => string | undefined;

function value(def: FieldDef, raw: unknown, refName: RefName): string {
  if (raw == null || raw === '') return '';
  if (def.type === 'ref') return typeof raw === 'string' ? refName(raw) ?? '' : '';
  if (def.type === 'number') return Number.isFinite(Number(raw)) && Number(raw) !== 0 ? String(raw) : '';
  if (def.type === 'effects' && typeof raw === 'object') return Object.entries(raw as Record<string, number>).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ');
  return String(raw).trim();
}

/** "Label: value" lines for the filled, context-worthy fields. */
export function renderFields(defs: FieldDef[], data: Record<string, unknown>, refName: RefName, o: { play?: boolean; skip?: string[] } = {}): string[] {
  const out: string[] = [];
  for (const d of defs) {
    if (!d.inContext || (d.play && !o.play) || o.skip?.includes(d.key)) continue;
    const v = value(d, data[d.key], refName);
    if (v) out.push(`${d.label}: ${v}`);
  }
  return out;
}

export function renderEntity(e: WorldEntity, all: WorldEntity[], refName: RefName, o: { play?: boolean } = {}): string {
  const type = typeof e.data.type === 'string' && e.data.type ? ` (${e.data.type})` : '';
  const lines = [`## ${e.name}${type}`];
  if (e.kind === 'location') {
    const chain = locationChain(e.parentId, all);
    if (chain.length) lines.push(`Within: ${chain.map((c) => c.name).join(' › ')}`);
  } else if (e.parentId) {
    const p = all.find((x) => x.id === e.parentId);
    if (p) lines.push(`Part of: ${p.name}`);
  }
  if (e.summary.trim()) lines.push(e.summary.trim());
  lines.push(...renderFields(FIELDS_BY_KIND[e.kind], e.data, refName, { play: o.play, skip: ['type'] }));
  return lines.join('\n');
}

export function renderSpecies(s: Species, refName: RefName): string {
  return [`## ${s.name} (a people)`, s.adulthood ? `Adulthood: ${s.adulthood}` : '', s.notes.trim(), ...renderFields(SPECIES_FIELDS, s.data, refName)].filter(Boolean).join('\n');
}

/** Extra character lines from the world fields: occupation, appearance, goals, home, memberships. */
export function renderCharacterWorld(c: Character, refName: RefName): string[] {
  const lines = renderFields(CHARACTER_FIELDS, c.data as Record<string, unknown>, refName);
  const ms = (c.data.memberships ?? []).map((m) => { const n = refName(m.orgId); return n ? `${n}${m.role ? ` (${m.role})` : ''}` : ''; }).filter(Boolean);
  if (ms.length) lines.push(`Belongs to: ${ms.join('; ')}`);
  return lines;
}

export function worldTemplateEmpty(u: Universe): boolean {
  const d = u.data as unknown as Record<string, unknown>;
  return !u.description.trim() && WORLD_FIELDS.every((f) => !String(d[f.key] ?? '').trim());
}

export function renderWorldTemplate(u: Universe, alwaysOn: LoreEntry[]): string {
  const d = u.data as unknown as Record<string, unknown>;
  return [
    `# World: ${u.name}`,
    u.description.trim(),
    ...renderFields(WORLD_FIELDS, d, () => undefined),
    ...alwaysOn.map((e) => `## ${e.title}\n${e.text}`),
  ].filter(Boolean).join('\n\n').replace(/\n\n(?=[A-Z][a-z ]+: )/g, '\n');
}
