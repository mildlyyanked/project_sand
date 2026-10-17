import type { Character, Style, Species } from '../types';
import { HEAT_LABELS } from '../types';

function field(label: string, value: string | undefined | null): string {
  const v = (value ?? '').trim();
  return v ? `${label}: ${v}` : '';
}

/** True when the voice card has nothing to say about the prose (prompt-only voice). */
export function styleCardEmpty(s: Style): boolean {
  return !s.pointOfView && !s.tense && !s.proseDensity && !s.dialogueRatio && !s.vocabulary && !s.influences && !s.bannedPhrases.length && !s.samples.some((p) => p.trim());
}

/**
 * The voice card. In play the game master's rules own perspective, tense,
 * density and length, so only the voice's texture goes in: register,
 * vocabulary, influences, banned phrases and the sample passages.
 */
export function renderStyle(s: Style, o: { play?: boolean } = {}): string {
  if (styleCardEmpty(s)) return '';
  const lines = o.play
    ? [
        `# Voice: ${s.name} (diction and texture; the game's rules set perspective and length)`,
        field('Register', s.register),
        field('Vocabulary', s.vocabulary),
        field('Influences', s.influences),
        s.bannedPhrases.length ? `Never use: ${s.bannedPhrases.join('; ')}` : '',
      ].filter(Boolean)
    : [
        `# Style: ${s.name}`,
        field('Point of view', s.pointOfView),
        field('Tense', s.tense),
        field('Prose density', s.proseDensity),
        field('Dialogue ratio', s.dialogueRatio),
        field('Register', s.register),
        field('Vocabulary', s.vocabulary),
        field('Influences', s.influences),
        s.bannedPhrases.length ? `Never use: ${s.bannedPhrases.join('; ')}` : '',
      ].filter(Boolean);
  if (s.samples.length) {
    lines.push('', o.play ? 'Sample passages in this voice (for word choice and rhythm only):' : 'Sample passages in this voice:');
    for (const p of s.samples) lines.push('---', p.trim());
    lines.push('---');
  }
  return lines.join('\n');
}

export function renderCharacter(c: Character, species?: Species | null, extra: string[] = [], tag = ''): string {
  return [
    `## ${c.name}${tag}`,
    field('Species', species?.name),
    field('Life stage', c.lifeStage),
    field('Summary', c.summary),
    field('Voice', c.voice),
    field('Tells', c.tells),
    field('Relationships', c.relationships),
    field('Limits', c.limits),
    field('Preferences', c.preferences),
    ...extra,
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderHeat(heat: number): string {
  const label = HEAT_LABELS[Math.max(0, Math.min(4, heat))];
  switch (heat) {
    case 0:
      return `Intensity: ${label}. Cut away before anything explicit; imply, do not show.`;
    case 1:
      return `Intensity: ${label}. Build tension slowly; keep physical detail restrained.`;
    case 2:
      return `Intensity: ${label}. Sensual and charged; explicit acts stay off the page.`;
    case 3:
      return `Intensity: ${label}. Explicit is fine; keep it in service of character and scene.`;
    default:
      return `Intensity: ${label}. No restraint on explicitness; follow the scene wherever it goes.`;
  }
}
