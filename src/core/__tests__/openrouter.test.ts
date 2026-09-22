import { describe, expect, it } from 'vitest';
import { createSseParser } from '../openrouter/sse';
import { buildRequestBody } from '../openrouter/request';
import { createClient, type FetchLike } from '../openrouter/client';
import { generateWithChain } from '../openrouter/generate';
import { looksLikeRefusal } from '../refusal';
import { DEFAULT_PARAMS } from '../types';

describe('sse parser', () => {
  it('splits payloads across chunk boundaries and ignores comments', () => {
    const p = createSseParser();
    expect(p.push(': keepalive\n\ndata: {"a":1}\n\nda')).toEqual(['{"a":1}']);
    expect(p.push('ta: {"b":2}\r\n\r\ndata: [DONE]\n\n')).toEqual(['{"b":2}', '[DONE]']);
    expect(p.flush()).toEqual([]);
  });
});

describe('request body', () => {
  it('always denies data collection and adds zdr on request', () => {
    const b = buildRequestBody({ model: 'm', messages: [], params: DEFAULT_PARAMS, zdr: false, stream: true }) as { provider: Record<string, unknown>; usage: unknown; reasoning?: unknown };
    expect(b.provider.data_collection).toBe('deny');
    expect(b.provider.zdr).toBeUndefined();
    expect(b.usage).toEqual({ include: true });
    expect(b.reasoning).toBeUndefined();
    const z = buildRequestBody({ model: 'm', messages: [], params: { ...DEFAULT_PARAMS, reasoning: true }, zdr: true, stream: true }) as { provider: Record<string, unknown>; reasoning?: unknown };
    expect(z.provider.zdr).toBe(true);
    expect(z.reasoning).toBeDefined();
  });
});

function streamFetch(lines: string[], status = 200): FetchLike {
  return async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    });
    return { ok: status < 400, status, body, text: async () => lines.join(''), json: async () => JSON.parse(lines.join('')) };
  };
}

const chunk = (delta: object, extra: object = {}) => `data: ${JSON.stringify({ model: 'm/real', choices: [{ delta }], ...extra })}\n\n`;

describe('client.stream', () => {
  it('yields text, reasoning, usage and done', async () => {
    const client = createClient(streamFetch([chunk({ reasoning: 'think' }), chunk({ content: 'Hel' }), chunk({ content: 'lo' }, { usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 } }), 'data: [DONE]\n\n']));
    const events = [];
    for await (const e of client.stream({ apiKey: 'k', model: 'm', messages: [], params: DEFAULT_PARAMS, zdr: false })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['reasoning', 'text', 'text', 'usage', 'done']);
    expect(events[3]!.usage).toEqual({ promptTokens: 3, completionTokens: 2, costUsd: 0.001 });
    expect(events[4]!.model).toBe('m/real');
  });
  it('throws on http errors with the api message', async () => {
    const client = createClient(async () => ({ ok: false, status: 402, body: null, text: async () => JSON.stringify({ error: { message: 'Insufficient credits' } }), json: async () => ({}) }));
    await expect(async () => {
      for await (const _ of client.stream({ apiKey: 'k', model: 'm', messages: [], params: DEFAULT_PARAMS, zdr: false })) void _;
    }).rejects.toThrow('Insufficient credits');
  });
});

describe('refusal detection', () => {
  it('flags refusals and passes prose', () => {
    expect(looksLikeRefusal("I'm sorry, but I can't continue this story.")).toBe(true);
    expect(looksLikeRefusal('As an AI language model I must decline.')).toBe(true);
    expect(looksLikeRefusal('Mara said, "I\'m sorry. I can\'t help you with the Warden." She turned away and the corridor swallowed her.')).toBe(true);
    expect(looksLikeRefusal('The hold smelled of brine. Mara counted the crates twice.')).toBe(false);
    expect(looksLikeRefusal('')).toBe(true);
  });
});

describe('generateWithChain', () => {
  it('walks the chain until an attempt is not a refusal', async () => {
    let call = 0;
    const seen: { model: string; body: string }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push({ model: JSON.parse(init.body!).model, body: init.body! });
      call++;
      const text = call < 3 ? "I'm sorry, I can't write that." : 'The door gave way.';
      return streamFetch([chunk({ content: text }), 'data: [DONE]\n\n'])(_url, init);
    };
    const client = createClient(fetchImpl);
    const attempts = await generateWithChain({
      client, apiKey: 'k', model: 'm/a', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'go' }], params: DEFAULT_PARAMS, zdr: false,
      refusalChain: [{ kind: 'reframe', text: 'FRAME' }, { kind: 'prefill', text: 'The' }, { kind: 'model', model: 'm/b' }],
    });
    expect(attempts.map((a) => a.refused)).toEqual([true, true, false]);
    expect(seen[1]!.body).toContain('FRAME');
    expect(JSON.parse(seen[2]!.body).messages.at(-1)).toEqual({ role: 'assistant', content: 'The' });
    expect(attempts[2]!.text).toBe('TheThe door gave way.');
    expect(seen.length).toBe(3);
  });
  it('continues past provider errors on a step', async () => {
    let call = 0;
    const client = createClient(async (u, i) => {
      call++;
      if (call === 1) return { ok: false, status: 500, body: null, text: async () => 'boom', json: async () => ({}) };
      return streamFetch([chunk({ content: 'Fine prose here.' }), 'data: [DONE]\n\n'])(u, i);
    });
    const attempts = await generateWithChain({ client, apiKey: 'k', model: 'm/a', messages: [{ role: 'user', content: 'go' }], params: DEFAULT_PARAMS, zdr: false, refusalChain: [{ kind: 'model', model: 'm/b' }] });
    expect(attempts[0]!.error).toBe('boom');
    expect(attempts[1]!.model).toBe('m/real');
    expect(attempts[1]!.refused).toBe(false);
  });
});

describe('repetition penalties', () => {
  it('sends penalties only when set and non-neutral', () => {
    const none = buildRequestBody({ model: 'm', messages: [], params: DEFAULT_PARAMS, zdr: false, stream: true }) as Record<string, unknown>;
    expect(none.frequency_penalty).toBeUndefined();
    expect(none.repetition_penalty).toBeUndefined();
    const some = buildRequestBody({ model: 'm', messages: [], params: { ...DEFAULT_PARAMS, frequencyPenalty: 0.45, presencePenalty: 0.3, repetitionPenalty: 1.1 }, zdr: false, stream: true }) as Record<string, unknown>;
    expect(some.frequency_penalty).toBe(0.45);
    expect(some.presence_penalty).toBe(0.3);
    expect(some.repetition_penalty).toBe(1.1);
    const neutral = buildRequestBody({ model: 'm', messages: [], params: { ...DEFAULT_PARAMS, repetitionPenalty: 1 }, zdr: false, stream: true }) as Record<string, unknown>;
    expect(neutral.repetition_penalty).toBeUndefined();
  });
});
