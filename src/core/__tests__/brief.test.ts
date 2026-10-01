import { describe, expect, it } from 'vitest';
import { briefNote, forgePrompt, imagePromptPrompt, parseBrief, parseClinicReply, parseForge, parseSuggestions, suggestPrompt } from '../helpers';

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

describe('clinic reply', () => {
  it('splits prose from a trailing edits block and keeps only known targets', () => {
    const r = parseClinicReply('The word "graphic" in your instruction reads as a category request.\n\n```json\n{"edits":[{"target":"instruction","text":"Mara closes the door behind him.","why":"in-world"},{"target":"nope","text":"x"},{"target":"direction","text":"Stay in scene."}]}\n```');
    expect(r.prose).toBe('The word "graphic" in your instruction reads as a category request.');
    expect(r.edits.map((e) => e.target)).toEqual(['instruction', 'direction']);
    expect(r.edits[0]!.why).toBe('in-world');
  });
  it('returns the whole text as prose when there is no block', () => {
    expect(parseClinicReply('Which model was this?')).toEqual({ prose: 'Which model was this?', edits: [] });
  });
});

describe('forge', () => {
  it('parses a world with its species and lore, keywords lower-cased', () => {
    const r = parseForge('world', '```json\n{"name":"Vell","description":"A drowned city.","species":[{"name":"Moulters","adulthood":"after the third moult","notes":"n"}],"lore":[{"title":"Tide law","keys":["Tide","COURT"],"text":"Rules.","alwaysOn":true}]}\n```');
    expect(r?.kind).toBe('world');
    if (r?.kind === 'world') {
      expect(r.world.species[0]!.adulthood).toBe('after the third moult');
      expect(r.world.lore[0]).toMatchObject({ title: 'Tide law', keys: ['tide', 'court'], alwaysOn: true });
    }
  });
  it('accepts a single object where a list was asked for, and defaults adult to true', () => {
    const r = parseForge('character', '{"name":"Ora","summary":"A judge.","species":"Moulters"}');
    expect(r?.kind === 'character' && r.characters[0]).toMatchObject({ name: 'Ora', adult: true, species: 'Moulters' });
    expect(parseForge('lore', 'nothing here')).toBeNull();
  });
  it('tells the model what is already there', () => {
    const m = forgePrompt('character', { wish: 'a smuggler', count: 1, ctx: { universe: { id: 'u', name: 'Vell', description: 'd', createdAt: 0, updatedAt: 0 }, species: [{ name: 'Moulters', adulthood: 'x' }], lore: [], characters: [{ name: 'Ora', summary: 'judge' }] } });
    expect(m[1]!.content).toContain('Ora: judge');
    expect(m[1]!.content).toContain('Moulters');
    expect(m[0]!.content).toContain('Exactly 1 item.');
  });
});
