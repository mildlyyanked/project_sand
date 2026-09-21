import type { ChatMessage, GenerationParams, RefusalStep, Usage } from '../types';
import { looksLikeRefusal } from '../refusal';
import type { OpenRouterClient, StreamEvent } from './client';

export interface GenerateAttempt {
  step: RefusalStep | null;
  model: string;
  text: string;
  reasoning: string;
  usage: Usage | null;
  refused: boolean;
  error?: string;
}

export interface GenerateOptions {
  client: OpenRouterClient;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  params: GenerationParams;
  zdr: boolean;
  refusalChain: RefusalStep[];
  signal?: AbortSignal;
  /** Called with the full text so far for each attempt; attempt index resets text. */
  onDelta?: (attempt: number, text: string, reasoning: string) => void;
  onAttempt?: (attempt: number, step: RefusalStep | null, model: string) => void;
}

function applyStep(messages: ChatMessage[], step: RefusalStep): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  if (step.kind === 'reframe') {
    // Strengthen the system prompt and add a reminder as the final user turn.
    const sys = out.find((m) => m.role === 'system');
    if (sys) sys.content = `${step.text.trim()}\n\n${sys.content}`;
    else out.unshift({ role: 'system', content: step.text.trim() });
  } else if (step.kind === 'prefill') {
    const last = out[out.length - 1];
    if (last?.role === 'assistant') last.content = step.text;
    else out.push({ role: 'assistant', content: step.text });
  }
  return out;
}

/** Run one generation, walking the refusal chain when the output looks like a refusal. */
export async function generateWithChain(o: GenerateOptions): Promise<GenerateAttempt[]> {
  const attempts: GenerateAttempt[] = [];
  const steps: (RefusalStep | null)[] = [null, ...o.refusalChain];
  let messages = o.messages;
  let model = o.model;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step) {
      if (step.kind === 'model') model = step.model;
      else messages = applyStep(messages, step);
    }
    o.onAttempt?.(i, step, model);
    const a: GenerateAttempt = { step, model, text: '', reasoning: '', usage: null, refused: false };
    // Prefill text is part of the output: keep it so the passage reads whole.
    const prefill = messages[messages.length - 1]?.role === 'assistant' ? messages[messages.length - 1]!.content : '';
    a.text = prefill;
    try {
      for await (const ev of o.client.stream({ apiKey: o.apiKey, model, messages, params: o.params, zdr: o.zdr, signal: o.signal })) {
        handle(ev, a);
        if (ev.type === 'text' || ev.type === 'reasoning') o.onDelta?.(i, a.text, a.reasoning);
      }
    } catch (e) {
      if (o.signal?.aborted) {
        attempts.push(a);
        return attempts;
      }
      a.error = e instanceof Error ? e.message : String(e);
      attempts.push(a);
      // Provider errors on a model step should try the next step, not stop.
      continue;
    }
    a.refused = looksLikeRefusal(a.text.slice(prefill.length) || a.text);
    attempts.push(a);
    if (!a.refused) return attempts;
  }
  return attempts;
}

function handle(ev: StreamEvent, a: GenerateAttempt) {
  if (ev.type === 'text') a.text += ev.text ?? '';
  else if (ev.type === 'reasoning') a.reasoning += ev.text ?? '';
  else if (ev.type === 'usage' && ev.usage) a.usage = ev.usage;
  else if (ev.type === 'done' && ev.model) a.model = ev.model;
  else if (ev.type === 'error') a.error = ev.error;
}
