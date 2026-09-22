import { describe, expect, it } from 'vitest';
import { applyRepetition, repeatedPhrases } from '../repetition';
import { renderStyle } from '../context/cards';
import { DEFAULT_PARAMS } from '../types';
import { style } from './fixtures';

describe('applyRepetition', () => {
  it('fills penalties from the style level and lets session values win', () => {
    expect(applyRepetition(DEFAULT_PARAMS, 'off').frequencyPenalty).toBeUndefined();
    expect(applyRepetition(DEFAULT_PARAMS, 'medium').frequencyPenalty).toBe(0.45);
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
