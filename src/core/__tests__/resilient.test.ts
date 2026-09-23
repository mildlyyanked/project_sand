import { describe, expect, it } from 'vitest';
import { createClient, type FetchLike } from '../openrouter/client';
import { continueFrom, withResume } from '../openrouter/resilient';
import { DEFAULT_PARAMS, type ChatMessage } from '../types';

function flaky(script: { chunks: string[]; dieAfter?: boolean }[]) {
  const bodies: ChatMessage[][] = [];
  let call = 0;
  const fetchImpl: FetchLike = async (_u, init) => {
    bodies.push((JSON.parse(init.body!) as { messages: ChatMessage[] }).messages);
    const step = script[Math.min(call++, script.length - 1)]!;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const t of step.chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
        // Erroring synchronously would discard the queued chunks; a real socket delivers them first.
        if (step.dieAfter) setTimeout(() => c.error(new Error('Software caused connection abort')), 5);
        else { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); }
      },
    });
    return { ok: true, status: 200, body, text: async () => '', json: async () => ({}) };
  };
  return { client: withResume(createClient(fetchImpl), { delayMs: 1 }), bodies };
}

describe('withResume', () => {
  it('resumes a dropped stream from the text received so far', async () => {
    const { client, bodies } = flaky([{ chunks: ['The door ', 'gave way'], dieAfter: true }, { chunks: [' and the cold came in.'] }]);
    let text = '';
    const types: string[] = [];
    for await (const ev of client.stream({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'go' }], params: DEFAULT_PARAMS, zdr: false })) {
      types.push(ev.type);
      if (ev.type === 'text') text += ev.text;
    }
    expect(text).toBe('The door gave way and the cold came in.');
    expect(types).toContain('resume');
    expect(bodies[1]!.at(-1)).toEqual({ role: 'assistant', content: 'The door gave way' });
  });
  it('gives up after the resume budget and surfaces the error', async () => {
    const { client } = flaky([{ chunks: ['a'], dieAfter: true }]);
    await expect(async () => {
      for await (const _ of client.stream({ apiKey: 'k', model: 'm', messages: [], params: DEFAULT_PARAMS, zdr: false })) void _;
    }).rejects.toThrow('connection abort');
  });
  it('does not resume when nothing was received', async () => {
    const { client, bodies } = flaky([{ chunks: [], dieAfter: true }, { chunks: ['x'] }]);
    await expect(async () => {
      for await (const _ of client.stream({ apiKey: 'k', model: 'm', messages: [], params: DEFAULT_PARAMS, zdr: false })) void _;
    }).rejects.toThrow();
    expect(bodies.length).toBe(1);
  });
  it('extends an existing prefill instead of adding a second assistant turn', () => {
    expect(continueFrom([{ role: 'user', content: 'go' }, { role: 'assistant', content: 'The ' }], 'The door')).toEqual([{ role: 'user', content: 'go' }, { role: 'assistant', content: 'The door' }]);
  });
});
