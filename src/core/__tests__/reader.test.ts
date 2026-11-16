import { describe, expect, it } from 'vitest';
import type { Beat } from '../types';
import { READERS, emptyReader, pageOf, pageText, parseReaderReply, personaOf, readerPrompt, shouldReact, typingMs, unreadOf, type ReaderMsg } from '../reader';

const beat = (id: string, role: Beat['role'], text: string): Beat => ({ id, sessionId: 's', parentId: null, role, text, model: null, direction: null, reasoning: null, plan: null, promptTokens: null, completionTokens: null, costUsd: null, createdAt: 0, at: null, state: null });
const path = [beat('a', 'prose', 'The rain had not stopped for three days.'), beat('n', 'instruction', 'Make her find the letter'), beat('b', 'prose', 'Mara found the letter under the floorboard.'), beat('c', 'note', 'secret: the letter is forged'), beat('d', 'prose', 'She did not open it.')];

describe('reading along', () => {
  it('reads only the page: prose, never directions or notes', () => {
    expect(pageOf(path).map((b) => b.id)).toEqual(['a', 'b', 'd']);
    const text = pageText(path, null);
    expect(text).toContain('Mara found the letter');
    expect(text).not.toContain('Make her find');
    expect(text).not.toContain('forged');
  });
  it('knows what is new since it last spoke, and marks it', () => {
    expect(unreadOf(path, 'b').map((b) => b.id)).toEqual(['d']);
    expect(unreadOf(path, null)).toHaveLength(3);
    expect(unreadOf(path, 'elsewhere').map((b) => b.id)).toEqual(['d']);
    const text = pageText(path, 'b');
    expect(text.indexOf('new since you last')).toBeGreaterThan(text.indexOf('Mara found'));
    expect(text.indexOf('new since you last')).toBeLessThan(text.indexOf('She did not open'));
  });
  it('keeps a long story to the last stretch, with what it remembers of the start', () => {
    const long = Array.from({ length: 40 }, (_, i) => beat(`p${i}`, 'prose', `Passage ${i}. ${'word '.repeat(150)}`));
    const text = pageText(long, 'p38', { budget: 3000, remembered: 'A heist went wrong in Vell.' });
    expect(text).toContain('What you remember of the earlier pages: A heist went wrong in Vell.');
    expect(text).toContain('Passage 39.');
    expect(text).not.toContain('Passage 2.');
  });
  it('talks like a person reading, in character, and never sees the plans', () => {
    const msgs: ReaderMsg[] = [{ id: '1', from: 'reader', text: 'ok i love her', at: 0 }, { id: '2', from: 'writer', text: 'should she open it?', at: 1, idea: null }];
    const p = readerPrompt({ persona: personaOf('editor'), title: 'The Letter', page: pageText(path, 'b'), messages: msgs, cue: { kind: 'reply' } });
    expect(p[0]!.content).toContain('Margot');
    expect(p[0]!.content).toContain('not an assistant');
    expect(p[0]!.content).toContain('"The Letter"');
    expect(p.map((m) => m.role)).toEqual(['system', 'assistant', 'user']);
    expect(JSON.stringify(p)).not.toContain('forged');
    const react = readerPrompt({ persona: READERS[0]!, title: '', page: 'x', messages: [], cue: { kind: 'react' } });
    expect(react[react.length - 1]!.content).toContain('PASS');
  });
  it('has a reader of your own when you describe one', () => {
    expect(personaOf('custom', { name: 'Gran', description: 'my grandmother, who reads Agatha Christie and trusts nobody' }).voice).toContain('trusts nobody');
    expect(personaOf('custom', { name: '', description: '' }).key).toBe('friend');
  });
  it('turns a reply into chat bubbles, with any idea kept apart', () => {
    const r = parseReaderReply('wait.\n\nis the letter even real??\n\nIDEA: let her burn it unread');
    expect(r.bubbles).toEqual(['wait.', 'is the letter even real??']);
    expect(r.idea).toBe('let her burn it unread');
    expect(parseReaderReply('PASS').pass).toBe(true);
    expect(parseReaderReply('**Great** pacing.\n- tight\n- tense').bubbles).toEqual(['Great pacing. tight tense']);
  });
  it('speaks up sparingly', () => {
    expect(shouldReact({ quiet: true, fresh: 5, freshChars: 9000, since: 9, roll: 0 })).toBe(false);
    expect(shouldReact({ quiet: false, fresh: 0, freshChars: 0, since: 9, roll: 0 })).toBe(false);
    expect(shouldReact({ quiet: false, fresh: 1, freshChars: 800, since: 2, roll: 0.99 })).toBe(true);
    expect(shouldReact({ quiet: false, fresh: 1, freshChars: 800, since: 0, roll: 0.9 })).toBe(false);
    expect(shouldReact({ quiet: false, fresh: 1, freshChars: 800, since: 0, roll: 0.1 })).toBe(true);
    expect(typingMs('hi')).toBeLessThan(typingMs('a much longer message about the letter and what it means'));
    expect(emptyReader().on).toBe(false);
  });
});
