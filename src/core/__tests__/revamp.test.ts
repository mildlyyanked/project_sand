import { describe, expect, it } from 'vitest';
import type { Character } from '../types';
import type { WorldEntity } from '../world/types';
import { LOCATION_FIELDS, THREAT_LEVELS, levelOf } from '../world/schema';
import { entryShape, fieldValue, inspirePrompt, parseFieldValue, parseInspired } from '../world/forge';
import { renderFields } from '../world/render';
import { upgradeV3Character, upgradeV3Entity } from '../world/upgrade';
import { changedFields, parseAgentReply, removing, retconChanges } from '../world/agent';
import { finishInspire } from '../jobs';
import type { Draft } from '../world/drafts';

const danger = LOCATION_FIELDS.find((f) => f.key === 'danger')!;
const ent = (data: Record<string, unknown>): WorldEntity => ({ id: 'p', universeId: 'u', kind: 'location', name: 'The Gull', parentId: null, summary: '', keys: [], data, createdAt: 0, updatedAt: 0 });

describe('threat in play', () => {
  it('names each level by what it does, rounding up', () => {
    expect(THREAT_LEVELS.map((l) => l.label)).toEqual(['Safe', 'Rough', 'Dangerous', 'Deadly']);
    expect(levelOf(THREAT_LEVELS, 0)!.label).toBe('Safe');
    expect(levelOf(THREAT_LEVELS, 1)!.label).toBe('Rough');
    expect(levelOf(THREAT_LEVELS, 4)!.label).toBe('Deadly');
    expect(levelOf(THREAT_LEVELS, undefined)).toBeNull();
  });

  it('is play-only, and reads and writes as levels', () => {
    expect(danger).toMatchObject({ type: 'level', play: true, section: 'play' });
    expect(renderFields(LOCATION_FIELDS, { danger: 3 }, () => undefined)).toEqual([]);
    expect(renderFields(LOCATION_FIELDS, { danger: 3 }, () => undefined, { play: true })[0]).toMatch(/^Threat in play: Dangerous\. Four times/);
    expect(entryShape('location')).toContain('"danger": one of 0 (safe) | 2 (rough) | 3 (dangerous) | 5 (deadly)');
    expect(fieldValue(danger, 4)).toBe(5);
    expect(fieldValue(danger, 'rough')).toBe(2);
    expect(parseFieldValue(danger, 'Deadly, because of the eels')).toBe(5);
  });

  it('old danger numbers snap up once; lookalikes become look-only inspirations', () => {
    expect(upgradeV3Entity(ent({ danger: 1 })).row.data.danger).toBe(2);
    expect(upgradeV3Entity(ent({ danger: 2 })).changed).toBe(false);
    expect(upgradeV3Entity(ent({})).changed).toBe(false);
    const c = { id: 'm', universeId: 'u', speciesId: null, name: 'Mara', lifeStage: '', adult: true, summary: '', voice: '', tells: '', relationships: '', limits: '', preferences: '', data: { lookalike: 'Tilda Swinton' } as Character['data'], createdAt: 0, updatedAt: 0 } as Character;
    const r = upgradeV3Character(c).row.data as Record<string, unknown>;
    expect(r).toEqual({ inspiredBy: 'Tilda Swinton', inspire: ['look'] });
  });
});

describe('inspired by', () => {
  const draft: Draft = { id: 'm', kind: 'character', name: 'Mara Voss', existing: true, fields: { summary: 'A smuggler.', appearance: 'Tall.', voice: 'Dry.' } };
  it('asks only for what the inspiration shapes, never naming the source in what it writes', () => {
    const m = inspirePrompt({ draft, who: 'Lisbeth Salander', aspects: ['mind', 'voice'], knowledge: 'K' });
    expect(m[0]!.content).toContain('"personality"');
    expect(m[0]!.content).toContain('"voice"');
    expect(m[0]!.content).not.toContain('"appearance"');
    expect(m[0]!.content).toContain('Never name Lisbeth Salander');
  });
  it('becomes one change to the character, with only the fields it rewrote', () => {
    expect(parseInspired('{"appearance":"x","personality":"Guarded.","voice":"Clipped."}', ['mind', 'voice'])).toEqual({ personality: 'Guarded.', voice: 'Clipped.' });
    const out = finishInspire({ model: 'm', messages: [], draft, who: 'Lisbeth Salander', aspects: ['mind', 'voice'] }, '{"personality":"Guarded.","voice":"Clipped."}');
    expect(out.drafts[0]).toMatchObject({ id: 'm', existing: true, fields: { personality: 'Guarded.', voice: 'Clipped.', appearance: 'Tall.' } });
    expect(changedFields(out.drafts[0]!)).toEqual(['personality', 'voice']);
    expect(() => finishInspire({ model: 'm', messages: [], draft, who: 'X', aspects: ['look'] }, 'no')).toThrow(/did not write/);
  });
});

describe('the agent reworks what exists', () => {
  it('reads revisions, renames and removals', () => {
    const r = parseAgentReply('Done: the house becomes a chapel.\n```json\n{"revise":[{"entry":"The Gull","change":"Now a drowned chapel.","rename":"The Bell Chapel"},{"entry":""}],"remove":[{"entry":"Old Mill","why":"never fit"}]}\n```');
    expect(r.revise).toEqual([{ entry: 'The Gull', change: 'Now a drowned chapel.', rename: 'The Bell Chapel' }]);
    expect(r.remove).toEqual([{ entry: 'Old Mill', why: 'never fit' }]);
    expect(r.reply).toBe('Done: the house becomes a chapel.');
  });
  it('turns retcon edits into one change per entry, renames included, and keeps removals', () => {
    const pool: Draft[] = [
      { id: 'g', kind: 'location', name: 'The Gull', fields: { description: 'A tavern.' } },
      { id: 'm', kind: 'character', name: 'Mara', fields: { home: 'The Gull', backstory: 'Grew up in the Gull.' } },
    ];
    const gone: Draft = { ...pool[1]!, id: 'x', name: 'Old Mill', existing: true, fields: { _remove: true } };
    const out = retconChanges(pool, [
      { id: 'g', key: 'name', after: 'The Bell Chapel' }, { id: 'g', key: 'description', after: 'A drowned chapel.' },
      { id: 'm', key: 'home', after: 'The Bell Chapel' }, { id: 'm', key: 'backstory', after: 'Grew up in the chapel.' }, { id: 'x', key: 'summary', after: 'y' },
    ], 'The Gull reworked', [gone]);
    const g = out.find((d) => d.id === 'g')!;
    expect(g.name).toBe('The Bell Chapel');
    expect(g.fields._was).toBe('The Gull');
    expect(changedFields(g)).toEqual(['name', 'description']);
    expect(changedFields(out.find((d) => d.id === 'm')!)).toEqual(['home', 'backstory']);
    expect(removing(out.find((d) => d.id === 'x')!)).toBe(true);
    expect(out.find((d) => d.id === 'x')!.fields.summary).toBeUndefined();
  });
});
