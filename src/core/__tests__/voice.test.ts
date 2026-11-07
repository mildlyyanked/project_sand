import { describe, expect, it } from 'vitest';
import type { Character } from '../types';
import { buildVoicePrompt, hearPrompt, namedIn, parseVoiceBuild, playsLike, renderVoices, voiceAnchor, voiceOf, voicesInScene } from '../voice';
import { renderCharacter, renderStyle } from '../context/cards';
import { assembleContext } from '../context/assemble';
import { chroniclePrompt, parseChronicle } from '../world/chronicle';
import { parseInspired } from '../world/forge';
import { beat, character, session, style } from './fixtures';

const voiced = style({ name: 'Slaughterhouse', voice: { authors: ['Kurt Vonnegut'], strength: 'pastiche', tone: 'deadpan, humane', rules: 'Sentences:\n- Short and plain.\n- The narrator steps in.\nNever:\n- Explains a joke.', anchor: '' } });
const howie = (p: Partial<Character> = {}) => character({ id: 'h', name: 'Howie Brenner', voice: 'Fast, overlapping, always selling.', data: { inspiredBy: 'Adam Sandler in Uncut Gems', sayings: 'This is how I win.\nNo, no, listen to me.' } as Character['data'], ...p });

describe('voices built from writers', () => {
  it('lead the style card with who, how far, the rules, and that the voice wins', () => {
    const text = renderStyle(voiced);
    expect(text).toMatch(/^# Voice: Slaughterhouse\. Write like Kurt Vonnegut/);
    expect(text).toContain('every paragraph reads as theirs');
    expect(text).toContain('How this voice writes:\nSentences:');
    expect(text).toContain('the voice wins');
    expect(text).toContain('never their sentences');
  });

  it('are said again in one breath right before the passage', () => {
    expect(voiceAnchor(voiced)).toBe('Voice: write this like Kurt Vonnegut (pastiche). Short and plain. The narrator steps in. Explains a joke.');
    expect(voiceAnchor(style({ voice: { ...voiced.voice, anchor: 'Plain words, a joke that hurts.' } }))).toBe('Voice: write this like Kurt Vonnegut (pastiche). Plain words, a joke that hurts.');
    expect(voiceAnchor(style())).toBe('');
    // Older voices: the influences line still says who.
    expect(voiceOf(style({ influences: 'Joan Didion' })).authors).toEqual(['Joan Didion']);
    const ctx = assembleContext({ session: session(), path: [beat({ id: 'b1', parentId: null, text: 'The rain came.' })], style: voiced, characters: [], species: [], universe: null, lore: [], model: 'm' });
    expect(ctx.messages[ctx.messages.length - 1]!.content).toBe('Continue the manuscript.\n\nVoice: write this like Kurt Vonnegut (pastiche). Short and plain. The narrator steps in. Explains a joke.');
  });

  it('are built from authors into rules, an anchor, form and original samples', () => {
    const m = buildVoicePrompt({ authors: ['Don DeLillo'], strength: 'close', tone: '', wish: 'more dread', current: null });
    expect(m[1]!.content).toContain('Write like: Don DeLillo. How far: clearly theirs');
    expect(m[0]!.content).toContain('never quoted or closely paraphrased');
    const b = parseVoiceBuild('{"name":"White Noise","rules":["Sentences:","Flat declaratives.","Lists of brand names."],"anchor":"Dread in the supermarket light.","register":"clinical","bannedPhrases":["suddenly"],"samples":["' + 'x'.repeat(80) + '","short"],"tense":"Present"}')!;
    expect(b.voice).toEqual({ rules: 'Sentences:\n- Flat declaratives.\n- Lists of brand names.', anchor: 'Dread in the supermarket light.' });
    expect(b).toMatchObject({ name: 'White Noise', register: 'clinical', tense: 'Present', bannedPhrases: ['suddenly'] });
    expect(b.samples).toHaveLength(1);
    expect(parseVoiceBuild('nope')).toBeNull();
    expect(hearPrompt('VOICE', 'CRAFT', 'A scene.')[0]!.content).toBe('CRAFT\n\nVOICE');
  });
});

describe('characters keep their voices', () => {
  it('play like their inspiration unless that is switched off, and carry lines', () => {
    expect(playsLike(howie())).toContain('Plays like Adam Sandler in Uncut Gems: their manner, rhythm, energy');
    expect(playsLike(howie({ data: { inspiredBy: 'X', playsLike: false } }))).toBe('');
    const card = renderCharacter(howie());
    expect(card).toContain('Plays like Adam Sandler');
    expect(card).toContain('Sounds like:\n- This is how I win.\n- No, no, listen to me.');
  });

  it('match first names only as capitalised words', () => {
    expect(namedIn('Will you come?', { name: 'Will Hart' })).toBe(true);
    expect(namedIn('she will come', { name: 'Will Hart' })).toBe(false);
    expect(namedIn('HOWIE BRENNER shouted', { name: 'Howie Brenner' })).toBe(true);
  });

  it('are the ones in the scene, those just named first', () => {
    const mara = character({ id: 'm', name: 'Mara', voice: 'clipped' });
    const silent = character({ id: 's', name: 'Silas', voice: '' });
    const got = voicesInScene({ cast: [mara], people: [howie(), silent], last: 'Howie leaned in.', recent: 'Mara waited. Howie leaned in. Silas coughed.' });
    expect(got.map((c) => c.name)).toEqual(['Howie Brenner', 'Mara']);
    expect(voicesInScene({ cast: [mara], people: [], last: '', recent: '' }).map((c) => c.name)).toEqual(['Mara']);
    expect(renderVoices(got)).toContain('- Howie Brenner: plays like Adam Sandler in Uncut Gems; Fast, overlapping, always selling; sounds like “This is how I win.” / “No, no, listen to me.”');
  });

  it('reach the writer for someone who walks in from the world, card and reminder both', () => {
    const ctx = assembleContext({
      session: session(), style: null, characters: [character({ id: 'm', name: 'Mara', voice: 'clipped' })], species: [], universe: null, lore: [], model: 'm',
      path: [beat({ id: 'b1', parentId: null, text: 'Mara opened the door. Howie was already talking.' })],
      world: { entities: [], instance: null, events: [], siblings: [], now: 0, scene: { locationId: null, locationName: '' }, player: null, people: [howie()] },
    });
    const chars = ctx.layers.find((l) => l.key === 'characters')!;
    expect(chars.text).toContain('# Also in the scene\n\n## Howie Brenner');
    expect(chars.label).toBe('Characters · 1 + 1 in scene');
    expect(ctx.messages[ctx.messages.length - 1]!.content).toMatch(/Voices in this scene[\s\S]*- Mara: clipped\n- Howie Brenner: plays like/);
  });

  it('get their lines from an inspiration as one field', () => {
    expect(parseInspired('{"voice":"Fast.","sayings":["This is how I win.","Listen."]}', ['voice'])).toEqual({ voice: 'Fast.', sayings: 'This is how I win.\nListen.' });
  });
});

describe('canonizing keeps up in long scenes', () => {
  it('asks for newcomers first, and knows when a cut-off reply never reached them', () => {
    const p = chroniclePrompt({ worldName: 'W', now: 'day 1', location: '', known: [], passage: 'x', pov: null })[0]!.content;
    expect(p.indexOf('"newcomers"')).toBeLessThan(p.indexOf('"elapsed"'));
    expect(parseChronicle('{"newcomers": [{"name": "Sella Voss", "kind": "character", "note": "loader"}], "elapsed": "5 minutes"')!.newcomers.map((n) => n.name)).toEqual(['Sella Voss']);
    expect(parseChronicle('{"elapsed": "5 minutes", "present": ["a"]}')!.newcomersMissing).toBe(true);
    expect(parseChronicle('{"newcomers": [], "elapsed": "5 minutes"}')!.newcomersMissing).toBe(false);
  });
});
