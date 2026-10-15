import type { SQLiteDatabase } from 'expo-sqlite';
import { recordSpend } from '@/db/repo/spend';
import { generateViaBackend } from './imageBackend';
import { client } from './client';
import { useSettings } from './settings';

/** Whether pictures can be painted here, or only described for another generator. */
export function paintReady(): { ok: true } | { ok: false; why: string; promptOnly?: boolean } {
  const { apiKey, defaults } = useSettings.getState();
  const b = defaults.imageBackend;
  if (!apiKey) return { ok: false, why: 'Add your OpenRouter key in Settings first.' };
  if (b.kind === 'prompt') return { ok: false, why: 'Pictures are set to prompt only: copy the prompt into a generator of your choice.', promptOnly: true };
  if (b.kind === 'openrouter' && !defaults.imageModel) return { ok: false, why: 'Pick an image model in Settings first.' };
  if (b.kind !== 'openrouter' && !b.baseUrl.trim()) return { ok: false, why: 'Set the image server address in Settings → Illustrations first.' };
  return { ok: true };
}

/** One picture from whichever painter Settings picks. References only reach OpenRouter image models. */
export async function paint(prompt: string, o: { zdr: boolean; signal?: AbortSignal; references?: string[]; spend?: SpendContext }): Promise<{ dataUrl: string; model: string; costUsd: number | null }> {
  const { apiKey, imageKey, defaults } = useSettings.getState();
  const b = defaults.imageBackend;
  const ready = paintReady();
  if (!ready.ok) throw new Error(ready.why);
  const out = b.kind === 'openrouter'
    ? await client.generateImage({ apiKey, model: defaults.imageModel, prompt, zdr: o.zdr, signal: o.signal, references: o.references })
    : await generateViaBackend(b, imageKey, prompt, o.signal);
  if (o.spend) await recordSpend(o.spend.db, { kind: 'image', model: out.model, sessionId: o.spend.sessionId, costUsd: out.costUsd, note: o.spend.note });
  return out;
}

/** Where to book a call's cost, for the Usage tab. */
export interface SpendContext { db: SQLiteDatabase; note: string; sessionId?: string | null }

/** The reply budget for a model: what was asked, within what its provider allows (8k when unknown; a cut-off reply is continued). */
export function replyBudget(model: string, wanted: number): number {
  const max = useSettings.getState().models.find((m) => m.id === model)?.maxOutput;
  return Math.max(256, Math.min(wanted, max && max > 0 ? max : 8000));
}

/**
 * The text of one library call (Forge, reforge, retcon, picture prompts).
 * Budgets are generous (a cap costs nothing unless used, and models that
 * always think spend part of it thinking). A reply cut off by the budget is continued
 * from where it stopped, up to three times, so long JSON arrives whole. Falls
 * back to the reasoning channel when the content is empty.
 */
export async function complete(o: { model: string; messages: Parameters<typeof client.stream>[0]['messages']; maxTokens: number; temperature?: number; signal?: AbortSignal; onText?: (chars: number) => void; spend?: SpendContext; continuations?: number }): Promise<{ text: string; finish?: string }> {
  const { apiKey, defaults } = useSettings.getState();
  if (!apiKey) throw new Error('Add your OpenRouter key in Settings first.');
  const maxTokens = replyBudget(o.model, o.maxTokens);
  let text = '';
  let reasoning = '';
  let finish: string | undefined;
  const spent = { cost: 0 as number | null, prompt: 0, completion: 0 };
  const run = async (messages: typeof o.messages) => {
    let part = '';
    let fin: string | undefined;
    for await (const ev of client.stream({ apiKey, model: o.model, messages, params: { temperature: o.temperature ?? 0.9, topP: 0.95, maxTokens, reasoning: false }, zdr: defaults.zdr, signal: o.signal })) {
      if (ev.type === 'text') { part += ev.text ?? ''; o.onText?.(text.length + part.length); }
      if (ev.type === 'reasoning') reasoning += ev.text ?? '';
      if (ev.type === 'done') fin = ev.finishReason;
      if (ev.type === 'usage' && ev.usage) {
        spent.cost = spent.cost == null || ev.usage.costUsd == null ? null : spent.cost + ev.usage.costUsd;
        spent.prompt += ev.usage.promptTokens;
        spent.completion += ev.usage.completionTokens;
      }
      if (ev.type === 'error') throw new Error(ev.error);
    }
    return { part, fin };
  };
  try {
    const first = await run(o.messages);
    text = first.part;
    finish = first.fin;
    for (let i = 0; i < (o.continuations ?? 3) && finish === 'length' && text.trim(); i++) {
      // Continue the cut-off reply from its last character.
      let next: { part: string; fin?: string };
      try {
        next = await run([...o.messages, { role: 'assistant', content: text }]);
      } catch {
        break;
      }
      if (!next.part.trim()) break;
      const restarted = /^\s*(```|\{)/.test(next.part) && /^\s*(```|\{)/.test(text);
      text = restarted ? next.part : text + next.part;
      finish = next.fin;
    }
  } finally {
    if (o.spend) await recordSpend(o.spend.db, { kind: 'library', model: o.model, sessionId: o.spend.sessionId, costUsd: spent.cost, promptTokens: spent.prompt, completionTokens: spent.completion, note: o.spend.note });
  }
  return { text: text.trim() ? text : reasoning, finish };
}
