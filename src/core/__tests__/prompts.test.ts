import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, mergeTemplates } from '../prompts';
import { assembleContext } from '../context/assemble';
import { labPrompt, parseLabResult, transcriptOf } from '../helpers';
import { session } from './fixtures';

describe('prompt templates', () => {
  it('merges overrides and ignores blanks', () => {
    const t = mergeTemplates({ opening: 'Open it.', craft: '   ' });
    expect(t.opening).toBe('Open it.');
    expect(t.craft).toBe(DEFAULT_TEMPLATES.craft);
  });
  it('flow through assembly', () => {
    const t = mergeTemplates({ craft: 'CUSTOM SYSTEM', opening: 'CUSTOM OPENING' });
    const ctx = assembleContext({ session: session(), path: [], preset: null, style: null, characters: [], species: [], universe: null, lore: [], model: 'x', templates: t });
    expect(ctx.messages[0]!.content).toBe('CUSTOM SYSTEM');
    expect(ctx.messages[1]!.content).toBe('CUSTOM OPENING');
  });
});

describe('lab', () => {
  it('builds a prompt with the goal, sample and full request, and parses the reply', () => {
    const msgs = labPrompt({ target: 'system', current: 'OLD', goal: 'Less purple', sample: 'She walked in.', lastPassage: 'A sky with no corners.', fullPrompt: '[system]\nOLD' });
    expect(msgs[1]!.content).toContain('Goal: Less purple');
    expect(msgs[1]!.content).toContain('Reference sample');
    expect(msgs[0]!.content).toContain('"revised": string');
    const r = parseLabResult('```json\n{"revised":"NEW","rationale":"why","changes":["a","b"]}\n```')!;
    expect(r.revised).toBe('NEW');
    expect(r.changes).toEqual(['a', 'b']);
    expect(parseLabResult('nope')).toBeNull();
    const style = parseLabResult('{"revised":{"tense":"present"},"rationale":"","changes":[]}')!;
    expect(style.revised).toEqual({ tense: 'present' });
  });
  it('renders a transcript', () => {
    expect(transcriptOf([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }])).toBe('[system]\nS\n\n[user]\nU');
  });
});
