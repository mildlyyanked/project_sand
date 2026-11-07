import { describe, expect, it } from 'vitest';
import { GALLERY, galleryId, galleryStyle } from '../voiceGallery';
import { renderStyle } from '../context/cards';
import { voiceAnchor } from '../voice';

describe('the voice gallery', () => {
  it('is a set of distinct, complete voices', () => {
    expect(GALLERY.length).toBeGreaterThanOrEqual(12);
    expect(new Set(GALLERY.map((g) => g.key)).size).toBe(GALLERY.length);
    expect(new Set(GALLERY.map((g) => g.name)).size).toBe(GALLERY.length);
    for (const g of GALLERY) {
      expect(g.authors.length, g.key).toBeGreaterThan(0);
      expect(g.rules, g.key).toContain('Never:');
      expect(g.anchor.length, g.key).toBeGreaterThan(30);
      const words = g.sample.split(/\s+/).length;
      expect(words, `${g.key}: ${words} words`).toBeGreaterThan(90);
      expect(words, `${g.key}: ${words} words`).toBeLessThan(260);
      // The same scene everywhere, so only the voice differs.
      expect(g.sample.toLowerCase(), g.key).toMatch(/bus|coach|omnibus/);
      expect(g.sample.toLowerCase(), g.key).toContain('rain');
      for (const b of g.bannedPhrases) expect(g.sample.toLowerCase(), `${g.key} uses ${b}`).not.toContain(b.toLowerCase());
    }
  });

  it('becomes an ordinary voice with a stable id, led by who it writes like', () => {
    const g = GALLERY.find((x) => x.key === 'vonnegut')!;
    const s = galleryStyle(g, 1);
    expect(s.id).toBe(galleryId('vonnegut'));
    expect(renderStyle(s)).toMatch(/^# Voice: Plain and Wry\. Write like Kurt Vonnegut/);
    expect(renderStyle(s)).toContain('Walter Pruitt waited');
    expect(voiceAnchor(s)).toContain('write this like Kurt Vonnegut (close)');
  });
});
