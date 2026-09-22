import { describe, expect, it } from 'vitest';
import { briefNote, parseBrief } from '../helpers';

describe('parseBrief', () => {
  it('parses fenced JSON and fills defaults', () => {
    const b = parseBrief('Here you go:\n```json\n{"title":"Salt and Iron","premise":"A courier finds the cargo breathing.","ideas":["complicity"],"characters":[{"name":"Mara","role":"courier","wants":"out"}],"world":{"name":"The Port","description":"Fog."},"style":{"name":"Cold close","pointOfView":"third close","tense":"past","register":"blunt","proseDensity":"lean","influences":"Proulx"},"notes":"no gore"}\n```')!;
    expect(b.title).toBe('Salt and Iron');
    expect(b.characters[0]).toMatchObject({ name: 'Mara', role: 'courier', wants: 'out', summary: '' });
    expect(b.world?.name).toBe('The Port');
    expect(b.style?.register).toBe('blunt');
    expect(briefNote(b)).toContain('People: Mara (courier), wants out');
  });
  it('returns null on garbage and treats an unknown register as blunt', () => {
    expect(parseBrief('no json here')).toBeNull();
    expect(parseBrief('{"title":"x","style":{"register":"purple"}}')!.style?.register).toBe('blunt');
    expect(parseBrief('{"title":"x","world":{"name":""}}')!.world).toBeNull();
  });
});
