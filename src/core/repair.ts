/** A passage belongs to the story its tree starts in. RN-free so it can be tested. */
export interface BeatRow { id: string; parent_id: string | null; session_id: string }

/**
 * Passages filed under a story other than the one their tree starts in, with
 * the story they belong to. `top` marks the first misfiled passage of a chain
 * (its parent is filed correctly): the one its story should move on to.
 */
export function misfiledBeats(rows: BeatRow[]): { id: string; owner: string; parentId: string | null; top: boolean }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const root = new Map<string, string>();
  const ownerOf = (id: string): string => {
    const chain: string[] = [];
    let cur = byId.get(id);
    while (cur && !root.has(cur.id) && cur.parent_id && byId.has(cur.parent_id) && chain.length < 100000) {
      chain.push(cur.id);
      cur = byId.get(cur.parent_id);
    }
    const owner = cur ? root.get(cur.id) ?? cur.session_id : '';
    if (cur) root.set(cur.id, owner);
    for (const c of chain) root.set(c, owner);
    return owner;
  };
  const out: { id: string; owner: string; parentId: string | null; top: boolean }[] = [];
  for (const r of rows) {
    const owner = ownerOf(r.id);
    if (owner && owner !== r.session_id) {
      const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
      out.push({ id: r.id, owner, parentId: r.parent_id, top: !!parent && parent.session_id !== r.session_id });
    }
  }
  return out;
}
