import { describe, expect, it } from 'vitest';
import { applyRepetition, degenerationOnset, repeatedPhrases, trimDegenerate } from '../repetition';
import { renderStyle } from '../context/cards';
import { DEFAULT_PARAMS } from '../types';
import { style } from './fixtures';

describe('applyRepetition', () => {
  it('fills penalties from the style level and lets session values win', () => {
    expect(applyRepetition(DEFAULT_PARAMS, 'off').frequencyPenalty).toBeUndefined();
    expect(applyRepetition(DEFAULT_PARAMS, 'light').frequencyPenalty).toBeUndefined();
    expect(applyRepetition(DEFAULT_PARAMS, 'light').presencePenalty).toBe(0.15);
    expect(applyRepetition(DEFAULT_PARAMS, 'medium').frequencyPenalty).toBe(0.04);
    expect(applyRepetition({ ...DEFAULT_PARAMS, frequencyPenalty: 0.9 }, 'medium').frequencyPenalty).toBe(0.9);
    expect(applyRepetition({ ...DEFAULT_PARAMS, frequencyPenalty: 0.9 }, 'medium').presencePenalty).toBe(0.3);
  });
});

describe('repeatedPhrases', () => {
  it('finds phrases reused from earlier passages and within the passage', () => {
    const earlier = 'The hold smelled of brine and old rope. Mara counted the crates twice.';
    const latest = 'The hold smelled of brine again. She counted the crates twice, then counted the crates twice more.';
    const hits = repeatedPhrases(latest, earlier);
    expect(hits).toContain('hold smelled of');
    expect(hits).toContain('counted the crates');
    expect(repeatedPhrases('Rain came sideways off the water.', earlier)).toEqual([]);
  });
});

describe('style card', () => {
  it('renders influences but never a repetition instruction', () => {
    const text = renderStyle(style({ influences: 'Annie Proulx, early Cormac McCarthy', repetition: 'strong' }));
    expect(text).toContain('Influences: Annie Proulx');
    expect(text.toLowerCase()).not.toContain('repet');
  });
});

describe('degeneration guard', () => {
  const sound = Array.from({ length: 10 }, (_, i) => `Elias stands at the rail of the yacht and watches the water slap the hull, and his sister laughs at something one of the guests has said about the heat of the afternoon (${i}).`).join(' ');
  it('leaves normal prose alone', () => {
    expect(degenerationOnset(sound)).toBe(-1);
    expect(trimDegenerate(sound).trimmed).toBe(false);
  });
  it('cuts a run-on tail that lost its articles and punctuation', () => {
    const telegraphic = 'Near starboard rail stands Ines beside hot tub carved into teak decking like open wound filled with moving turquoise water. Poppy crosses deck holding two fresh flutes by stems between fingers like cigarettes passes one toward Camille without breaking stride. Camille left foot slips six inches sideways on wet teak near hot tub edge while steam rises around knees.';
    const runOn = 'For half-second she windmills arms gracefully enough it could pass for dance move if not for shriek caught high behind teeth as champagne glass drops from other hand and shatters against deck rail before hitting water below deck line somewhere out toward sea glass splinters catching sunlight mid-air like flung sequins falling into blue nothingness behind stern wake churning white foam across surface where hull cuts deeper water now picking up speed under captain steady throttle increase toward whatever coordinates have been programmed into navigation system since departure from Portofino this morning while parents watch screens ashore waiting for scandal worth documenting among rich children doing nothing interesting yet except drinking too much champagne too early afternoon under Mediterranean sun too bright for comfort without sunglasses everyone else already wearing except Elias who squints against reflected glare';
    const text = `${sound} ${telegraphic} ${runOn}`;
    const at = degenerationOnset(text);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(sound.length + 1);
    const out = trimDegenerate(text);
    expect(out.trimmed).toBe(true);
    expect(out.text.endsWith('(9).')).toBe(true);
  });
  it('does not trim when most of the passage is broken', () => {
    const runOn = Array.from({ length: 200 }, () => 'word').join(' ');
    expect(trimDegenerate(`Short lead. ${runOn}`).trimmed).toBe(false);
  });
});
