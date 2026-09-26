import type { ChatMessage, GenerationParams, RefusalStep, Usage } from '../types';
import { looksLikeRefusal } from '../refusal';
import { DEFAULT_TEMPLATES } from '../prompts';
import type { OpenRouterClient, StreamEvent } from './client';

export interface GenerateAttempt {
  step: RefusalStep | null;
  model: string;
  text: string;
  reasoning: string;
  usage: Usage | null;
  refused: boolean;
  /** Text at the start of `text` that already exists in the manuscript and must not be inserted again. */
  stripPrefix: string;
  error?: string;
  skipped?: string;
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
  providerIgnore?: string[];
  providerOrder?: string[];
  /** Model used for the soften step. */
  helperModel?: string;
  /** Tail of the manuscript, for the momentum step. */
  momentumText?: string;
  /** The writer's latest instruction, for the soften step. */
  instructionText?: string;
  /** Resolves 'auto' in a model step. */
  autoModel?: (exclude: string[]) => string | null;
  /** Overrides the Soften step's system prompt. */
  softenSystem?: string;
  onDelta?: (attempt: number, text: string, reasoning: string) => void;
  onAttempt?: (attempt: number, step: RefusalStep | null, model: string) => void;
}

interface Plan {
  messages: ChatMessage[];
  params: GenerationParams;
  model: string;
  stripPrefix: string;
}

function setPrefill(messages: ChatMessage[], text: string): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  if (last?.role === 'assistant') last.content = text;
  else out.push({ role: 'assistant', content: text });
  return out;
}

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return i;
  return -1;
}

export const SOFTEN_SYSTEM = DEFAULT_TEMPLATES.soften;

/** Run one generation, walking the refusal chain when the output looks like a refusal. */
export async function generateWithChain(o: GenerateOptions): Promise<GenerateAttempt[]> {
  const attempts: GenerateAttempt[] = [];
  const steps: (RefusalStep | null)[] = [null, ...o.refusalChain];
  let plan: Plan = { messages: o.messages, params: o.params, model: o.model, stripPrefix: '' };
  const tried = [o.model];
  const route = { providerIgnore: o.providerIgnore, providerOrder: o.providerOrder };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const a: GenerateAttempt = { step, model: plan.model, text: '', reasoning: '', usage: null, refused: false, stripPrefix: '' };

    // Apply the step to the plan. Some steps cannot apply and are skipped without a request.
    if (step) {
      switch (step.kind) {
        case 'reframe': {
          const msgs = plan.messages.map((m) => ({ ...m }));
          const sys = msgs.find((m) => m.role === 'system');
          if (sys) sys.content = `${step.text.trim()}\n\n${sys.content}`;
          else msgs.unshift({ role: 'system', content: step.text.trim() });
          plan = { ...plan, messages: msgs };
          break;
        }
        case 'prefill':
          plan = { ...plan, messages: setPrefill(plan.messages, step.text), stripPrefix: '' };
          break;
        case 'model': {
          const next = step.model === 'auto' ? o.autoModel?.(tried) ?? null : step.model;
          if (!next || tried.includes(next)) {
            a.skipped = step.model === 'auto' ? 'no better model in the ledger yet' : 'already tried';
            attempts.push(a);
            continue;
          }
          tried.push(next);
          plan = { ...plan, model: next };
          break;
        }
        case 'momentum': {
          const tail = (o.momentumText ?? '').trim();
          if (!tail) {
            a.skipped = 'nothing to carry momentum from';
            attempts.push(a);
            continue;
          }
          plan = { ...plan, messages: setPrefill(plan.messages, tail + ' '), stripPrefix: tail + ' ' };
          break;
        }
        case 'soften': {
          const instr = (o.instructionText ?? '').trim();
          const idx = lastUserIndex(plan.messages);
          if (!instr || !o.helperModel || idx < 0) {
            a.skipped = 'no instruction to soften';
            attempts.push(a);
            continue;
          }
          try {
            let note = '';
            for await (const ev of o.client.stream({ apiKey: o.apiKey, model: o.helperModel, messages: [{ role: 'system', content: o.softenSystem ?? SOFTEN_SYSTEM }, { role: 'user', content: instr }], params: { temperature: 0.5, topP: 0.9, maxTokens: 300, reasoning: false }, zdr: o.zdr, signal: o.signal, ...route })) {
              if (ev.type === 'text') note += ev.text ?? '';
            }
            note = note.trim();
            if (!note) throw new Error('empty');
            const msgs = plan.messages.map((m) => ({ ...m }));
            // Replace the instruction wherever it was sent; keep everything else.
            let replaced = false;
            for (const m of msgs) {
              if (m.role === 'user' && m.content.includes(instr)) {
                m.content = m.content.replace(instr, note);
                replaced = true;
              }
            }
            if (!replaced) msgs[idx]!.content = `${note}\n\n${msgs[idx]!.content}`;
            plan = { ...plan, messages: msgs };
          } catch {
            a.skipped = 'helper could not rewrite the instruction';
            attempts.push(a);
            continue;
          }
          break;
        }
        case 'heat':
          plan = { ...plan, params: { ...plan.params, temperature: Math.min(1.5, plan.params.temperature + 0.15), topP: 1 } };
          break;
        case 'twostep':
          // Handled below: it is two requests inside one attempt.
          break;
      }
    }

    a.model = plan.model;
    o.onAttempt?.(i, step, plan.model);
    const prefill = plan.messages[plan.messages.length - 1]?.role === 'assistant' ? plan.messages[plan.messages.length - 1]!.content : '';

    try {
      if (step?.kind === 'twostep') {
        // Pass one: only the approach, short budget.
        const idx = lastUserIndex(plan.messages);
        const lead = plan.messages.map((m) => ({ ...m }));
        if (idx >= 0) lead[idx]!.content += '\n\nFor now write only the approach to what comes next: the atmosphere, the first moves, the moment just before. Stop there, mid-scene.';
        let leadText = prefill;
        for await (const ev of o.client.stream({ apiKey: o.apiKey, model: plan.model, messages: lead, params: { ...plan.params, maxTokens: Math.min(450, plan.params.maxTokens) }, zdr: o.zdr, signal: o.signal, ...route })) {
          handle(ev, a);
          if (ev.type === 'text') { leadText += ev.text ?? ''; o.onDelta?.(i, leadText, a.reasoning); }
        }
        if (looksLikeRefusal(leadText.slice(prefill.length))) {
          a.text = leadText;
          a.stripPrefix = plan.stripPrefix;
          a.refused = true;
          attempts.push(a);
          continue;
        }
        // Pass two: continue from inside the scene.
        const second = setPrefill(plan.messages, leadText);
        a.text = leadText;
        for await (const ev of o.client.stream({ apiKey: o.apiKey, model: plan.model, messages: second, params: plan.params, zdr: o.zdr, signal: o.signal, ...route })) {
          handle(ev, a);
          if (ev.type === 'text' || ev.type === 'reasoning') o.onDelta?.(i, a.text, a.reasoning);
        }
        a.stripPrefix = plan.stripPrefix;
        a.refused = looksLikeRefusal(a.text.slice(leadText.length) || a.text);
      } else {
        a.text = prefill;
        for await (const ev of o.client.stream({ apiKey: o.apiKey, model: plan.model, messages: plan.messages, params: plan.params, zdr: o.zdr, signal: o.signal, ...route })) {
          handle(ev, a);
          if (ev.type === 'text' || ev.type === 'reasoning') o.onDelta?.(i, a.text, a.reasoning);
        }
        a.stripPrefix = plan.stripPrefix;
        a.refused = looksLikeRefusal(a.text.slice(prefill.length) || a.text);
      }
    } catch (e) {
      if (o.signal?.aborted) {
        a.stripPrefix = plan.stripPrefix;
        attempts.push(a);
        return attempts;
      }
      a.error = e instanceof Error ? e.message : String(e);
      attempts.push(a);
      continue;
    }
    attempts.push(a);
    if (!a.refused) return attempts;
  }
  return attempts;
}

function handle(ev: StreamEvent, a: GenerateAttempt) {
  if (ev.type === 'text') a.text += ev.text ?? '';
  else if (ev.type === 'reasoning') a.reasoning += ev.text ?? '';
  else if (ev.type === 'usage' && ev.usage) a.usage = a.usage ? { promptTokens: a.usage.promptTokens + ev.usage.promptTokens, completionTokens: a.usage.completionTokens + ev.usage.completionTokens, costUsd: (a.usage.costUsd ?? 0) + (ev.usage.costUsd ?? 0) } : ev.usage;
  else if (ev.type === 'done' && ev.model) a.model = ev.model;
  else if (ev.type === 'error') a.error = ev.error;
}

/** Last sentence or so of a passage, for the momentum step. */
export function momentumTail(text: string, maxWords = 28): string {
  const t = text.trim();
  if (!t) return '';
  const sentences = t.split(/(?<=[.!?…"”])\s+/);
  let out = sentences[sentences.length - 1] ?? '';
  for (let i = sentences.length - 2; i >= 0 && (out.split(/\s+/).length < 12); i--) out = `${sentences[i]} ${out}`;
  const words = out.split(/\s+/);
  return words.length > maxWords ? words.slice(-maxWords).join(' ') : out;
}
