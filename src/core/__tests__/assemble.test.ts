import { describe, expect, it } from 'vitest';
import { assembleContext, resolvePreset, splitPath } from '../context/assemble';
import { beat, character, lore, preset, session, style } from './fixtures';

const path = [
  beat({ id: 'b1', parentId: null, text: 'Mara checked the hold.' }),
  beat({ id: 'b2', parentId: 'b1', text: 'Now bring in the Warden.', role: 'instruction' }),
  beat({ id: 'b3', parentId: 'b2', text: 'The Warden stepped from the dark.' }),
];

describe('assembleContext', () => {
  it('orders layers and folds system layers into one message', () => {
    const ctx = assembleContext({ session: session(), path, preset: preset(), style: style(), characters: [character()], species: [], universe: null, lore: [], model: 'm/writer' });
    expect(ctx.layers.map((l) => l.key)).toEqual(['system', 'style', 'characters', 'beat:b1', 'beat:b2', 'beat:b3']);
    expect(ctx.messages[0]!.role).toBe('system');
    expect(ctx.messages[0]!.content).toContain('SYS');
    expect(ctx.messages[0]!.content).toContain('# Style: Terse');
    expect(ctx.messages[0]!.content).toContain('## Mara');
    expect(ctx.messages.map((m) => m.role)).toEqual(['system', 'assistant', 'user', 'assistant', 'user']);
    expect(ctx.messages[ctx.messages.length - 1]!.content).toBe('Continue the manuscript.');
  });
  it('adds a user turn when the path is empty', () => {
    const ctx = assembleContext({ session: session(), path: [], preset: null, style: null, characters: [], species: [], universe: null, lore: [], model: 'x' });
    expect(ctx.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(ctx.messages[1]!.content).toContain('This is the opening');
  });
  it('triggers lore from recent beats and respects the lore budget', () => {
    const entries = [lore({ id: 'warden', keys: ['warden'], priority: 2 }), lore({ id: 'hold', keys: ['hold'], priority: 1 }), lore({ id: 'quiet', keys: ['zzz'] }), lore({ id: 'always', alwaysOn: true })];
    const ctx = assembleContext({ session: session({ universeId: 'u1' }), path, preset: null, style: null, characters: [], species: [], universe: { id: 'u1', name: 'W', description: 'desc', createdAt: 0, updatedAt: 0 }, lore: entries, model: 'x' });
    const loreLayer = ctx.layers.find((l) => l.key === 'lore')!;
    expect(loreLayer.text).toContain('## warden');
    expect(loreLayer.text).toContain('## hold');
    expect(loreLayer.text).not.toContain('## quiet');
    expect(loreLayer.text.indexOf('warden')).toBeLessThan(loreLayer.text.indexOf('hold'));
    expect(ctx.layers.find((l) => l.key === 'universe')!.text).toContain('## always');
  });
  it('puts heat, direction and post-history at the end, then prefill last', () => {
    const ctx = assembleContext({ session: session({ explicit: true, heat: 4 }), path, preset: preset({ postHistory: 'POST', prefill: 'She' }), style: null, characters: [], species: [], universe: null, lore: [], model: 'x', direction: 'slower' });
    const last = ctx.messages[ctx.messages.length - 1]!;
    expect(last).toEqual({ role: 'assistant', content: 'She' });
    const post = ctx.messages[ctx.messages.length - 2]!;
    expect(post.role).toBe('user');
    expect(post.content).toContain('POST');
    expect(post.content).toContain('Unrestrained');
    expect(post.content).toContain('Direction for this passage: slower');
  });
  it('does not mention heat when the session is not explicit', () => {
    const ctx = assembleContext({ session: session({ explicit: false, heat: 4 }), path, preset: null, style: null, characters: [], species: [], universe: null, lore: [], model: 'x' });
    expect(JSON.stringify(ctx.messages)).not.toContain('Intensity');
  });
  it('drops layers the inspector marked dropped', () => {
    const ctx = assembleContext({ session: session(), path, preset: null, style: style(), characters: [], species: [], universe: null, lore: [], model: 'x', dropped: new Set(['style']) });
    expect(ctx.layers.find((l) => l.key === 'style')!.dropped).toBe(true);
    expect(ctx.messages[0]!.content).not.toContain('Style');
  });
  it('splits summarized, overflow and recent by budget', () => {
    const long = Array.from({ length: 10 }, (_, i) => beat({ id: `b${i + 1}`, parentId: i ? `b${i}` : null, text: 'word '.repeat(400) }));
    const s = session({ strategy: { recentBudget: 1200, summaryBudget: 500, loreScanBeats: 3, loreBudget: 500, summarizeThreshold: 2000 }, summary: 'so far', summaryUpToBeatId: 'b3' });
    const parts = splitPath(long, s, s.strategy);
    expect(parts.summarized.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(parts.recent.length).toBeGreaterThan(0);
    expect(parts.recent.length).toBeLessThan(7);
    expect(parts.overflow.length + parts.recent.length).toBe(7);
    const ctx = assembleContext({ session: s, path: long, preset: null, style: null, characters: [], species: [], universe: null, lore: [], model: 'x' });
    expect(ctx.layers.find((l) => l.key === 'overflow')!.dropped).toBe(true);
    expect(ctx.layers.find((l) => l.key === 'summary')!.text).toContain('so far');
  });
  it('applies model overrides by exact id and prefix', () => {
    const p = preset({ modelOverrides: { 'anthropic/*': { prefill: 'A' }, 'anthropic/claude-x': { system: 'X' } } });
    expect(resolvePreset(p, 'anthropic/claude-x')).toEqual({ system: 'X', prefill: 'A', postHistory: '' });
    expect(resolvePreset(p, 'openai/gpt')).toEqual({ system: 'SYS', prefill: '', postHistory: '' });
  });
});

describe('brief, opening and plan', () => {
  it('sends the brief as a system layer and an opening directive when there is no prose yet', () => {
    const ctx = assembleContext({ session: session({ brief: 'Premise: a yacht.' }), path: [], preset: null, style: null, characters: [], species: [], universe: null, lore: [], model: 'x' });
    expect(ctx.layers.map((l) => l.key)).toEqual(['system', 'brief', 'post']);
    expect(ctx.messages[0]!.content).toContain('# The story\nPremise: a yacht.');
    expect(ctx.messages[ctx.messages.length - 1]!.content).toContain('This is the opening');
  });
  it('drops the opening directive once prose exists and carries the plan', () => {
    const ctx = assembleContext({ session: session(), path, preset: null, style: null, characters: [], species: [], universe: null, lore: [], model: 'x', plan: 'Elias meets Serena on deck.' });
    const last = ctx.messages[ctx.messages.length - 1]!;
    expect(last.content).not.toContain('This is the opening');
    expect(last.content).toContain('Plan for this passage');
    expect(last.content).toContain('Elias meets Serena on deck.');
  });
});
