import { describe, expect, it } from 'vitest';
import { briefNote, imagePromptPrompt, parseBrief, parseSuggestions, suggestPrompt } from '../helpers';

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


describe('suggestions', () => {
  it('parses numbered and bulleted lines, at most three', () => {
    expect(parseSuggestions('1. She opens the letter\n2) He lies about the car\n- The storm reaches the house\n4. extra')).toEqual(['She opens the letter', 'He lies about the car', 'The storm reaches the house']);
  });
  it('drops noise lines', () => {
    expect(parseSuggestions('Sure:\n1. **Go down to the cellar**\n\nok')).toEqual(['Sure:', 'Go down to the cellar']);
  });
  it('asks for protagonist moves when the voice is second person', () => {
    const m = suggestPrompt({ brief: '', summary: '', recent: 'x', style: null, interactive: true });
    expect(m[0]!.content).toMatch(/protagonist does or says/);
  });
});

describe('image prompt', () => {
  it('carries the passage and never the character names as names', () => {
    const m = imagePromptPrompt({ passage: 'The lamp guttered.', characters: [], universe: null, style: null, brief: 'A quiet house.' });
    expect(m[1]!.content).toContain('The lamp guttered.');
    expect(m[0]!.content).toMatch(/never by name/);
  });
});
