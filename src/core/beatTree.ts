import type { Beat, Id } from './types';

export interface BeatIndex {
  byId: Map<Id, Beat>;
  children: Map<Id | null, Beat[]>;
}

export function indexBeats(beats: Beat[]): BeatIndex {
  const byId = new Map<Id, Beat>();
  const children = new Map<Id | null, Beat[]>();
  for (const b of beats) byId.set(b.id, b);
  for (const b of beats) {
    const list = children.get(b.parentId) ?? [];
    list.push(b);
    children.set(b.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { byId, children };
}

/** Root-to-node path. Returns [] when the id is unknown. */
export function pathTo(index: BeatIndex, id: Id | null): Beat[] {
  const out: Beat[] = [];
  let cur = id ? index.byId.get(id) : undefined;
  while (cur) {
    out.push(cur);
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  }
  return out.reverse();
}

export function siblings(index: BeatIndex, id: Id): Beat[] {
  const b = index.byId.get(id);
  if (!b) return [];
  return index.children.get(b.parentId) ?? [];
}

/** Position of a node among its siblings, 1-based, with total. */
export function siblingPosition(index: BeatIndex, id: Id): { at: number; of: number } {
  const sibs = siblings(index, id);
  const at = sibs.findIndex((s) => s.id === id) + 1;
  return { at, of: sibs.length };
}

/** Follow the newest child repeatedly to find the leaf a branch leads to. */
export function leafOf(index: BeatIndex, id: Id): Beat {
  let cur = index.byId.get(id)!;
  for (;;) {
    const kids = index.children.get(cur.id);
    if (!kids || kids.length === 0) return cur;
    cur = kids[kids.length - 1]!;
  }
}

/** Next sibling in the given direction, wrapping. */
export function stepSibling(index: BeatIndex, id: Id, dir: 1 | -1): Beat | null {
  const sibs = siblings(index, id);
  if (sibs.length < 2) return null;
  const i = sibs.findIndex((s) => s.id === id);
  return sibs[(i + dir + sibs.length) % sibs.length] ?? null;
}

/** Does any branch point (node with >1 children) exist on the path? */
export function branchPoints(index: BeatIndex, path: Beat[]): Set<Id> {
  const out = new Set<Id>();
  for (const b of path) if ((index.children.get(b.parentId)?.length ?? 0) > 1) out.add(b.id);
  return out;
}

/** All descendants of a node (for delete-subtree). */
export function descendants(index: BeatIndex, id: Id): Beat[] {
  const out: Beat[] = [];
  const stack = [...(index.children.get(id) ?? [])];
  while (stack.length) {
    const b = stack.pop()!;
    out.push(b);
    stack.push(...(index.children.get(b.id) ?? []));
  }
  return out;
}

export function manuscriptText(path: Beat[]): string {
  return path
    .filter((b) => b.role === 'prose')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n');
}
