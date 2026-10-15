import type { Character } from '@/core/types';
import type { WorldEntity } from '@/core/world/types';
import type { RefOption, RefOptions } from './components/World';
import { imageOf } from '@/core/world/portraits';

/** Places as an indented tree, factions and things flat, people of this world: for reference pickers. */
export function refOptions(entities: WorldEntity[], people: Character[], exclude: string[] = []): RefOptions {
  const skip = new Set(exclude);
  const tree = (kind: WorldEntity['kind']): RefOption[] => {
    const items = entities.filter((e) => e.kind === kind && !skip.has(e.id));
    const out: RefOption[] = [];
    const ids = new Set(items.map((e) => e.id));
    const walk = (parent: string | null, depth: number) => {
      for (const e of items.filter((x) => (x.parentId && ids.has(x.parentId) ? x.parentId : null) === parent).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ id: e.id, name: e.name, depth, image: imageOf(e.data)?.uri, hint: e.summary });
        walk(e.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  };
  return { location: tree('location'), organization: tree('organization'), item: tree('item'), character: people.map((c) => ({ id: c.id, name: c.name, image: imageOf(c.data as Record<string, unknown>)?.uri, hint: c.summary })) };
}

/** The element and everything nested under it, so a place cannot be put inside itself. */
export function withDescendants(id: string, entities: WorldEntity[]): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const e of entities) if (e.parentId === out[i] && !out.includes(e.id)) out.push(e.id);
  return out;
}
