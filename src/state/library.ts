import type { SQLiteDatabase } from 'expo-sqlite';
import type { Character, Universe } from '@/core/types';
import type { WorldEntity } from '@/core/world/types';
import { characterDraft, entityDraft, libraryDrafts, loreDraft, planDrafts, speciesDraft, worldDraft, type Draft, type LibKind, type Library, type Plan } from '@/core/world/drafts';
import { DEFAULT_WORLD_DATA, getUniverse, listCharacters, listLore, listSpecies, saveCharacter, saveLore, saveSpecies, saveUniverse } from '@/db/repo/library';
import { listEntities, primeInstance, saveEntity } from '@/db/repo/world';

/** Everything in one world, or an empty library when there is none. */
export async function loadLibrary(db: SQLiteDatabase, universeId: string | null | undefined): Promise<Library> {
  if (!universeId) {
    const characters = (await listCharacters(db)).filter((c) => !c.universeId);
    return { universe: null, entities: [], characters, species: [], lore: [] };
  }
  const [universe, entities, characters, species, lore] = await Promise.all([getUniverse(db, universeId), listEntities(db, universeId), listCharacters(db), listSpecies(db, universeId), listLore(db, universeId)]);
  return { universe, entities, characters: characters.filter((c) => c.universeId === universeId), species, lore };
}

export async function savePlan(db: SQLiteDatabase, plan: Plan, o: { newWorld?: boolean } = {}): Promise<void> {
  if (plan.universe) {
    await saveUniverse(db, plan.universe);
    if (o.newWorld) await primeInstance(db, plan.universe.id);
  }
  for (const e of plan.entities) await saveEntity(db, e);
  for (const c of plan.characters) await saveCharacter(db, c);
  for (const s of plan.species) await saveSpecies(db, s);
  for (const l of plan.lore) await saveLore(db, l);
}

/** Save forged drafts, with their links, into a world (or a new one). */
export async function saveDrafts(db: SQLiteDatabase, drafts: Draft[], universeId: string | null): Promise<Plan> {
  const lib = await loadLibrary(db, universeId);
  const newWorld = drafts.some((d) => d.kind === 'world' && !d.existing);
  const plan = planDrafts(drafts, lib, universeId, { defaultData: DEFAULT_WORLD_DATA, calendar: { ...DEFAULT_WORLD_DATA.calendar, kind: 'custom', daysPerYear: 0 } });
  await savePlan(db, plan, { newWorld });
  return plan;
}

export type LibraryRow =
  | { kind: 'world'; row: Universe }
  | { kind: 'character'; row: Character }
  | { kind: 'location' | 'organization' | 'item'; row: WorldEntity }
  | { kind: 'species'; row: import('@/core/types').Species }
  | { kind: 'lore'; row: import('@/core/types').LoreEntry };

/** An existing entry as a draft, read against its world. */
export function rowDraft(r: LibraryRow, lib: Library): Draft {
  switch (r.kind) {
    case 'world': return worldDraft(r.row);
    case 'character': return characterDraft(r.row, lib);
    case 'species': return speciesDraft(r.row, lib);
    case 'lore': return loreDraft(r.row);
    default: return entityDraft(r.row, lib);
  }
}

/**
 * Apply an edited draft of an existing entry: the entry's own row comes back
 * for the editor to take, and links the edit implies on other entries are saved.
 */
export async function applyDraftEdit(db: SQLiteDatabase, draft: Draft, universeId: string | null, lib?: Library): Promise<{ self: unknown; notes: string[] }> {
  const l = lib ?? (await loadLibrary(db, universeId));
  const plan = planDrafts([draft], l, universeId);
  let self: unknown = null;
  const others: Plan = { universe: null, entities: [], characters: [], species: [], lore: [], notes: plan.notes };
  if (plan.universe && plan.universe.id === draft.id) self = plan.universe;
  for (const k of ['entities', 'characters', 'species', 'lore'] as const) {
    for (const row of plan[k] as { id: string }[]) {
      if (row.id === draft.id) self = row;
      else (others[k] as { id: string }[]).push(row);
    }
  }
  await savePlan(db, others);
  return { self, notes: plan.notes };
}

/** Names per reference kind, for ref pickers over drafts. */
export function namesByKind(pool: Draft[]): Record<'location' | 'organization' | 'item' | 'character' | 'species', string[]> {
  const of = (k: LibKind) => [...new Set(pool.filter((d) => d.kind === k).map((d) => d.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { location: of('location'), organization: of('organization'), item: of('item'), character: of('character'), species: of('species') };
}

export { libraryDrafts };
