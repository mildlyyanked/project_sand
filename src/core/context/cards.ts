import type { Character, Style, Species } from '../types';
import { HEAT_LABELS } from '../types';

function field(label: string, value: string | undefined | null): string {
  const v = (value ?? '').trim();
  return v ? `${label}: ${v}` : '';
}

export function renderStyle(s: Style): string {
  const lines = [
    `# Style: ${s.name}`,
    field('Point of view', s.pointOfView),
    field('Tense', s.tense),
    field('Prose density', s.proseDensity),
    field('Dialogue ratio', s.dialogueRatio),
    field('Register', s.register),
    field('Vocabulary', s.vocabulary),
    s.bannedPhrases.length ? `Never use: ${s.bannedPhrases.join('; ')}` : '',
  ].filter(Boolean);
  if (s.samples.length) {
    lines.push('', 'Sample passages in this voice:');
    for (const p of s.samples) lines.push('---', p.trim());
    lines.push('---');
  }
  return lines.join('\n');
}

export function renderCharacter(c: Character, species?: Species | null): string {
  return [
    `## ${c.name}`,
    field('Species', species?.name),
    field('Life stage', c.lifeStage),
    field('Summary', c.summary),
    field('Voice', c.voice),
    field('Tells', c.tells),
    field('Relationships', c.relationships),
    field('Limits', c.limits),
    field('Preferences', c.preferences),
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
