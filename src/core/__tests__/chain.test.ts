import { describe, expect, it } from 'vitest';
import { createClient, type FetchLike } from '../openrouter/client';
import { generateWithChain, momentumTail, SOFTEN_SYSTEM } from '../openrouter/generate';
import { DEFAULT_PARAMS, type ChatMessage } from '../types';

const REFUSAL = "I'm sorry, but I can't write that.";
const PROSE = 'The door gave way and the cold came in with it.';

/** Scripted fetch: each call answers by inspecting the request body. */
function scripted(answer: (body: { model: string; messages: ChatMessage[]; temperature: number; top_p: number; max_tokens: number }) => string) {
  const calls: { model: string; messages: ChatMessage[]; temperature: number; top_p: number; max_tokens: number }[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body!) as (typeof calls)[number];
    calls.push(body);
    const text = answer(body);
    const enc = new TextEncoder();
    const chunk = `data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(chunk)); c.close(); } });
    return { ok: true, status: 200, body: stream, text: async () => '', json: async () => ({}) };
  };
  return { client: createClient(fetchImpl), calls };
}

const base = { apiKey: 'k', model: 'm/a', params: DEFAULT_PARAMS, zdr: false };
const messages: ChatMessage[] = [{ role: 'system', content: 'SYS' }, { role: 'assistant', content: 'She counted the crates twice. Then the lights went out.' }, { role: 'user', content: 'Now the Warden arrives.' }];

describe('momentumTail', () => {
  it('keeps a long last sentence alone, pads a short one with the sentence before, and caps length', () => {
    const long = 'The hold smelled of brine and old rope and something underneath both that nobody wanted to name.';
    expect(momentumTail(`Rain came. ${long}`)).toBe(long);
    expect(momentumTail('It rained for a week in the port. The hold smelled of brine.')).toBe('It rained for a week in the port. The hold smelled of brine.');
    expect(momentumTail(Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') + '.').split(/\s+/).length).toBe(28);
    expect(momentumTail('')).toBe('');
  });
});

describe('generateWithChain steps', () => {
  it('momentum prefills the manuscript tail and marks it for stripping', async () => {
    const { client, calls } = scripted((b) => (b.messages.at(-1)?.role === 'assistant' ? PROSE : REFUSAL));
    const attempts = await generateWithChain({ ...base, client, messages, refusalChain: [{ kind: 'momentum' }], momentumText: 'Then the lights went out.' });
    expect(attempts.map((a) => a.refused)).toEqual([true, false]);
    expect(calls[1]!.messages.at(-1)).toEqual({ role: 'assistant', content: 'Then the lights went out. ' });
    expect(attempts[1]!.stripPrefix).toBe('Then the lights went out. ');
    expect(attempts[1]!.text).toBe('Then the lights went out. ' + PROSE);
  });

  it('soften rewrites the instruction through the helper and replaces it in place', async () => {
    const { client, calls } = scripted((b) => {
      if (b.model === 'm/helper') return 'The Warden steps out of the dark at the far end of the hold.';
      return b.messages.some((m) => m.role === 'user' && m.content.includes('steps out of the dark')) ? PROSE : REFUSAL;
    });
    const attempts = await generateWithChain({ ...base, client, messages, refusalChain: [{ kind: 'soften' }], helperModel: 'm/helper', instructionText: 'Now the Warden arrives.' });
    expect(attempts.map((a) => a.refused)).toEqual([true, false]);
    expect(calls[1]!.model).toBe('m/helper');
    expect(calls[1]!.messages[0]!.content).toBe(SOFTEN_SYSTEM);
    expect(calls[2]!.messages.at(-1)!.content).toBe('The Warden steps out of the dark at the far end of the hold.');
  });

  it('skips soften without an instruction and does not spend a request', async () => {
    const { client, calls } = scripted(() => REFUSAL);
    const attempts = await generateWithChain({ ...base, client, messages, refusalChain: [{ kind: 'soften' }], helperModel: 'm/helper' });
    expect(calls.length).toBe(1);
    expect(attempts[1]!.skipped).toBeTruthy();
  });

  it('twostep writes the approach with a small budget and continues from it', async () => {
    let n = 0;
    const { client, calls } = scripted((b) => {
      n++;
      if (n === 1) return REFUSAL;
      if (b.max_tokens <= 450) return 'The corridor narrowed.';
      return ' Then he was there.';
    });
    const attempts = await generateWithChain({ ...base, client, messages, refusalChain: [{ kind: 'twostep' }] });
    expect(calls.length).toBe(3);
    expect(calls[1]!.messages.at(-1)!.content).toContain('only the approach');
    expect(calls[2]!.messages.at(-1)).toEqual({ role: 'assistant', content: 'The corridor narrowed.' });
    expect(attempts[1]!.text).toBe('The corridor narrowed. Then he was there.');
    expect(attempts[1]!.refused).toBe(false);
  });

  it('heat raises temperature and top-p; auto model consults the ledger and skips when empty', async () => {
    const { client, calls } = scripted((b) => (b.temperature > DEFAULT_PARAMS.temperature + 0.1 ? PROSE : REFUSAL));
    const attempts = await generateWithChain({ ...base, client, messages, refusalChain: [{ kind: 'model', model: 'auto' }, { kind: 'heat' }], autoModel: () => null });
    expect(attempts[1]!.skipped).toContain('ledger');
    expect(calls.length).toBe(2);
    expect(calls[1]!.temperature).toBeCloseTo(DEFAULT_PARAMS.temperature + 0.15);
    expect(calls[1]!.top_p).toBe(1);
    expect(attempts[2]!.refused).toBe(false);
  });

  it('auto model switches to the ledger pick and never repeats a tried model', async () => {
    const { client, calls } = scripted((b) => (b.model === 'm/best' ? PROSE : REFUSAL));
    const attempts = await generateWithChain({ ...base, client, messages, refusalChain: [{ kind: 'model', model: 'auto' }, { kind: 'model', model: 'auto' }], autoModel: (ex) => (ex.includes('m/best') ? null : 'm/best') });
    expect(calls.map((c) => c.model)).toEqual(['m/a', 'm/best']);
    expect(attempts[1]!.model).toBe('m/best');
    expect(attempts[1]!.refused).toBe(false);
  });
});
