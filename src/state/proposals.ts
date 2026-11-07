import type { SQLiteDatabase } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import type { BibleOutput, ForgeOutput, Job, ReforgeInput, ReforgeOutput, WorkshopOutput } from '@/core/jobs';
import { changedFields } from '@/core/world/agent';
import { DRAFT_FIELDS, type Draft, type Plan } from '@/core/world/drafts';
import { getUniverse, saveUniverse } from '@/db/repo/library';
import { useJobs } from './jobs';
import { loadLibrary, rowDraft, saveDrafts, type LibraryRow } from './library';

/**
 * Deciding on what a job proposes. New entries are saved through the same
 * planning as Forge, so their links land on both sides; a change to an
 * existing entry is applied to the entry as it is now, field by field, so
 * edits made since the proposal are kept.
 */
export function draftsOf(j: Job): Draft[] {
  if (!j.output) return [];
  if (j.kind === 'forge') return (j.output as ForgeOutput).drafts;
  if (j.kind === 'workshop') return (j.output as WorkshopOutput).drafts;
  return [];
}

/** The entry an existing-entry draft points at, as a draft of what it is now. */
async function current(db: SQLiteDatabase, d: Draft, universeId: string | null): Promise<Draft | null> {
  const lib = await loadLibrary(db, universeId);
  const row: LibraryRow | null = (() => {
    const e = lib.entities.find((x) => x.id === d.id);
    if (e) return { kind: e.kind, row: e };
    const c = lib.characters.find((x) => x.id === d.id);
    if (c) return { kind: 'character' as const, row: c };
    const s = lib.species.find((x) => x.id === d.id);
    if (s) return { kind: 'species' as const, row: s };
    const l = lib.lore.find((x) => x.id === d.id);
    if (l) return { kind: 'lore' as const, row: l };
    return lib.universe?.id === d.id ? { kind: 'world' as const, row: lib.universe } : null;
  })();
  return row ? rowDraft(row, lib) : null;
}

/** Only what a change changes, laid on the entry as it is now. */
export async function rebase(db: SQLiteDatabase, d: Draft, universeId: string | null, keys = changedFields(d)): Promise<Draft | null> {
  const now = await current(db, d, universeId);
  if (!now) return null;
  const fields = { ...now.fields };
  for (const k of keys) fields[k] = d.fields[k];
  return { ...now, name: keys.includes('name') ? d.name : now.name, fields };
}

/** Ref fields and ties: what a saved draft needs re-read once the entries it names exist. */
function linksOnly(d: Draft): Draft {
  const keep = new Set(['ties', ...DRAFT_FIELDS[d.kind].filter((f) => f.type === 'ref').map((f) => f.key), ...(d.kind === 'character' ? ['factionRole'] : [])]);
  return { ...d, existing: true, fields: Object.fromEntries(Object.entries(d.fields).filter(([k]) => keep.has(k))) };
}

/**
 * Accept some of a job's drafts. Entries accepted earlier from the same job
 * have their links read again with these, so a person accepted before the
 * place they live in still ends up living there.
 */
export async function acceptDrafts(db: SQLiteDatabase, j: Job, ids: string[], edited: Record<string, Draft> = {}): Promise<Plan | null> {
  const all = draftsOf(j).map((d) => edited[d.id] ?? d);
  const pick = all.filter((d) => ids.includes(d.id) && !j.decisions[d.id]);
  if (!pick.length) return null;
  const fresh: Draft[] = [];
  const changes: Draft[] = [];
  for (const d of pick) (d.existing ? changes : fresh).push(d);
  const before = all.filter((d) => j.decisions[d.id] === 'accepted' && !d.existing).map(linksOnly);
  let plan: Plan | null = null;
  if (fresh.length) plan = await saveDrafts(db, [...fresh, ...before], j.kind === 'forge' && draftsOf(j).some((d) => d.kind === 'world') ? null : j.universeId);
  for (const c of changes) {
    const keys = changedFields(c).length ? changedFields(c) : Object.keys(c.fields);
    const r = await rebase(db, c, j.universeId, keys);
    if (r) {
      const p = await saveDrafts(db, [r], j.universeId);
      plan = plan ? { ...plan, notes: [...plan.notes, ...p.notes] } : p;
    }
  }
  for (const d of pick) await useJobs.getState().decide(db, j.id, d.id, 'accepted');
  return plan;
}

export async function dismissDrafts(db: SQLiteDatabase, j: Job, ids: string[]): Promise<void> {
  for (const id of ids) if (!j.decisions[id]) await useJobs.getState().decide(db, j.id, id, 'dismissed');
}

/** Accept a reforged field: onto the entry as it is now. */
export async function acceptReforge(db: SQLiteDatabase, j: Job): Promise<void> {
  const input = j.input as ReforgeInput;
  const value = (j.output as ReforgeOutput).value;
  const d = input.key === 'name' ? { ...input.draft, name: String(value) } : { ...input.draft, fields: { ...input.draft.fields, [input.key]: value } };
  const r = await rebase(db, d, j.universeId, [input.key]);
  if (r) await saveDrafts(db, [r], j.universeId);
  await useJobs.getState().decide(db, j.id, 'all', 'accepted');
}

/** Accept a style bible, whole or one line, onto the world. */
export async function acceptBible(db: SQLiteDatabase, j: Job): Promise<Universe | null> {
  if (!j.universeId) return null;
  const u = await getUniverse(db, j.universeId);
  if (!u) return null;
  const next = { ...u, data: { ...u.data, art: { ...(u.data.art ?? {}), ...(j.output as BibleOutput).bible } } };
  await saveUniverse(db, next);
  await useJobs.getState().decide(db, j.id, 'all', 'accepted');
  return next;
}
