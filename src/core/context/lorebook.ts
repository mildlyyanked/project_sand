import type { LoreEntry } from '../types';

/** Lore entries whose keys appear in the scanned text, highest priority first. */
export function triggeredLore(entries: LoreEntry[], scanText: string): LoreEntry[] {
  const hay = scanText.toLowerCase();
  return entries
    .filter((e) => !e.alwaysOn && e.keys.some((k) => k && hay.includes(k.toLowerCase())))
    .sort((a, b) => b.priority - a.priority);
}

export function alwaysOnLore(entries: LoreEntry[]): LoreEntry[] {
  return entries.filter((e) => e.alwaysOn).sort((a, b) => b.priority - a.priority);
}
