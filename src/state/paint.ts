import type { SQLiteDatabase } from 'expo-sqlite';
import type { Usage } from '@/core/types';
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

/** The text of one helper or writer call, falling back to the reasoning channel when the content is empty. */
export async function complete(o: { model: string; messages: Parameters<typeof client.stream>[0]['messages']; maxTokens: number; temperature?: number; signal?: AbortSignal; onText?: (chars: number) => void; spend?: SpendContext }): Promise<{ text: string; finish?: string }> {
  const { apiKey, defaults } = useSettings.getState();
  if (!apiKey) throw new Error('Add your OpenRouter key in Settings first.');
  let text = '';
  let reasoning = '';
  let finish: string | undefined;
  let usage: Usage | undefined;
  for await (const ev of client.stream({ apiKey, model: o.model, messages: o.messages, params: { temperature: o.temperature ?? 0.9, topP: 0.95, maxTokens: o.maxTokens, reasoning: false }, zdr: defaults.zdr, signal: o.signal })) {
    if (ev.type === 'text') { text += ev.text ?? ''; o.onText?.(text.length); }
    if (ev.type === 'reasoning') reasoning += ev.text ?? '';
    if (ev.type === 'done') finish = ev.finishReason;
    if (ev.type === 'usage' && ev.usage) usage = ev.usage;
    if (ev.type === 'error') throw new Error(ev.error);
  }
  if (o.spend) await recordSpend(o.spend.db, { kind: 'library', model: o.model, sessionId: o.spend.sessionId, costUsd: usage?.costUsd ?? null, promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens, note: o.spend.note });
  return { text: text.trim() ? text : reasoning, finish };
}
