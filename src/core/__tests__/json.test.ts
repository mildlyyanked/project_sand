import { describe, expect, it } from 'vitest';
import { lenientJson } from '../json';

describe('lenientJson', () => {
  it('parses strict JSON, fenced JSON, and JSON after a sentence', () => {
    expect(lenientJson('{"a":1}')).toEqual({ a: 1 });
    expect(lenientJson('Here you go:\n```json\n{"a":1}\n```\nEnjoy.')).toEqual({ a: 1 });
    expect(lenientJson('Sure! {"a":{"b":[1,2]}} done')).toEqual({ a: { b: [1, 2] } });
  });
  it('repairs literal newlines inside strings and trailing commas', () => {
    expect(lenientJson('{"description": "First paragraph.\n\nSecond paragraph.", "list": [1, 2,],}')).toEqual({ description: 'First paragraph.\n\nSecond paragraph.', list: [1, 2] });
    expect(lenientJson('{"t": "a\ttab", "q": "say \\"hi\\""}')).toEqual({ t: 'a\ttab', q: 'say "hi"' });
  });
  it('gives up on truncated output', () => {
    expect(lenientJson('{"a": "unfinished')).toBeNull();
    expect(lenientJson('no json here')).toBeNull();
  });
});
