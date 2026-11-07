import type { Universe } from '../types';

/** A world in a line or two, for helpers that need its feel but not its whole card. */
export function worldLine(u: Universe | null | undefined, o: { long?: boolean } = {}): string {
  if (!u) return '';
  const d = u.data;
  const bits = [u.name, d.genre, o.long ? d.rules?.slice(0, 300) : ''].filter((x) => x && x.trim()).join('; ');
  const desc = u.description.trim().slice(0, o.long ? 900 : 400);
  return u.isDefault && !desc ? 'the real world, the present day' : [bits, desc].filter(Boolean).join('. ');
}
