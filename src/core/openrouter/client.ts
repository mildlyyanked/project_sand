import type { ChatMessage, GenerationParams, ModelInfo, Usage } from '../types';
import { createSseParser } from './sse';
import { buildRequestBody, headers, OPENROUTER_BASE } from './request';

export type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface StreamEvent {
  type: 'text' | 'reasoning' | 'usage' | 'done' | 'error' | 'resume';
  text?: string;
  usage?: Usage;
  error?: string;
  model?: string;
}

export interface StreamRequest {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  params: GenerationParams;
  zdr: boolean;
  signal?: AbortSignal;
  fallbackModels?: string[];
  providerIgnore?: string[];
  providerOrder?: string[];
}

export class OpenRouterError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function createClient(fetchImpl: FetchLike) {
  async function* stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const body = buildRequestBody({ model: req.model, messages: req.messages, params: req.params, zdr: req.zdr, stream: true, fallbackModels: req.fallbackModels, providerIgnore: req.providerIgnore, providerOrder: req.providerOrder });
    const res = await fetchImpl(`${OPENROUTER_BASE}/chat/completions`, { method: 'POST', headers: headers(req.apiKey), body: JSON.stringify(body), signal: req.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text;
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        msg = j.error?.message ?? text;
      } catch {}
      throw new OpenRouterError(msg || `HTTP ${res.status}`, res.status);
    }
    if (!res.body) {
      // Non-streaming fallback (e.g. environments without body streams).
      const j = JSON.parse(await res.text()) as CompletionJson;
      const c = j.choices?.[0];
      if (c?.message?.reasoning) yield { type: 'reasoning', text: c.message.reasoning };
      if (c?.message?.content) yield { type: 'text', text: c.message.content };
      const u = usageFrom(j);
      if (u) yield { type: 'usage', usage: u };
      yield { type: 'done', model: j.model };
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    let model: string | undefined;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        const payloads = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
        for (const p of payloads) {
          if (p === '[DONE]') continue;
          let j: CompletionJson;
          try {
            j = JSON.parse(p) as CompletionJson;
          } catch {
            continue;
          }
          if (j.error) {
            yield { type: 'error', error: j.error.message ?? 'Unknown error' };
            continue;
          }
          model = j.model ?? model;
          const d = j.choices?.[0]?.delta;
          if (d?.reasoning) yield { type: 'reasoning', text: d.reasoning };
          if (d?.content) yield { type: 'text', text: d.content };
          const u = usageFrom(j);
          if (u) yield { type: 'usage', usage: u };
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock?.();
    }
    yield { type: 'done', model };
  }

  async function listModels(apiKey: string): Promise<ModelInfo[]> {
    const res = await fetchImpl(`${OPENROUTER_BASE}/models`, { headers: headers(apiKey) });
    if (!res.ok) throw new OpenRouterError(`Could not list models (HTTP ${res.status})`, res.status);
    const j = (await res.json()) as { data?: RawModel[] };
    return (j.data ?? []).map(toModelInfo);
  }

  async function listZdrModelIds(apiKey: string): Promise<Set<string>> {
    // OpenRouter exposes ZDR-eligible endpoints via the models endpoint filter.
    const res = await fetchImpl(`${OPENROUTER_BASE}/models?supported_parameters=&zdr=true`, { headers: headers(apiKey) });
    if (!res.ok) return new Set();
    const j = (await res.json()) as { data?: RawModel[] };
    return new Set((j.data ?? []).map((m) => m.id));
  }

  async function keyInfo(apiKey: string): Promise<{ label: string; usage: number; limit: number | null } | null> {
    const res = await fetchImpl(`${OPENROUTER_BASE}/key`, { headers: headers(apiKey) });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { label?: string; usage?: number; limit?: number | null } };
    return { label: j.data?.label ?? '', usage: j.data?.usage ?? 0, limit: j.data?.limit ?? null };
  }

  /**
   * One image from a chat-completions call with image output. OpenRouter returns
   * images on the message as data URLs; the first one is what we keep.
   */
  async function generateImage(o: { apiKey: string; model: string; prompt: string; zdr: boolean; signal?: AbortSignal }): Promise<{ dataUrl: string; model: string }> {
    const provider: Record<string, unknown> = { data_collection: 'deny', allow_fallbacks: true };
    if (o.zdr) provider.zdr = true;
    const body = { model: o.model, messages: [{ role: 'user', content: o.prompt }], modalities: ['image', 'text'], stream: false, provider };
    const res = await fetchImpl(`${OPENROUTER_BASE}/chat/completions`, { method: 'POST', headers: headers(o.apiKey), body: JSON.stringify(body), signal: o.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {}
      throw new OpenRouterError(msg || `HTTP ${res.status}`, res.status);
    }
    const j = JSON.parse(text) as ImageCompletionJson;
    if (j.error) throw new OpenRouterError(j.error.message ?? 'Image generation failed', res.status);
    const found = extractImage(j);
    if (!found.url) throw new OpenRouterError(found.reason, res.status);
    return { dataUrl: found.url, model: j.model ?? o.model };
  }

  return { stream, listModels, listZdrModelIds, keyInfo, generateImage };
}

export type OpenRouterClient = ReturnType<typeof createClient>;

interface CompletionJson {
  id?: string;
  model?: string;
  error?: { message?: string; code?: number };
  choices?: { delta?: { content?: string; reasoning?: string }; message?: { content?: string; reasoning?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; total_cost?: number };
}

function usageFrom(j: CompletionJson): Usage | null {
  if (!j.usage) return null;
  return { promptTokens: j.usage.prompt_tokens ?? 0, completionTokens: j.usage.completion_tokens ?? 0, costUsd: j.usage.cost ?? j.usage.total_cost ?? null };
}

interface ImageCompletionJson {
  model?: string;
  error?: { message?: string };
  choices?: {
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: {
      content?: string | { type?: string; text?: string; image_url?: { url?: string } }[] | null;
      images?: { image_url?: { url?: string } }[];
    };
  }[];
}

/**
 * The image from an image-output completion, or the most useful reason there
 * is none. OpenRouter puts images on `message.images`; some providers return
 * content parts instead; a safety block leaves an empty message with a
 * telling finish reason.
 */
export function extractImage(j: ImageCompletionJson): { url: string | null; reason: string } {
  const c = j.choices?.[0];
  const msg = c?.message;
  const fromImages = msg?.images?.find((i) => i.image_url?.url)?.image_url?.url;
  if (fromImages) return { url: fromImages, reason: '' };
  const parts = Array.isArray(msg?.content) ? msg.content : [];
  const fromParts = parts.find((p) => p.image_url?.url)?.image_url?.url;
  if (fromParts) return { url: fromParts, reason: '' };
  const textContent = typeof msg?.content === 'string' ? msg.content.trim() : parts.map((p) => p.text ?? '').join(' ').trim();
  if (/^data:image\//.test(textContent)) return { url: textContent, reason: '' };
  const finish = [c?.native_finish_reason, c?.finish_reason].filter(Boolean).join(' / ');
  const filtered = /safety|filter|block|prohibited|recitation|moderat/i.test(finish);
  if (filtered) return { url: null, reason: `The provider blocked this picture (${finish}). OpenRouter's image models carry their providers' filters; edit the prompt before painting, paint with your own host (Settings → Illustrations), or use Prompt only and paste it into a generator.` };
  if (textContent) return { url: null, reason: `The model answered with text instead of an image: ${textContent.slice(0, 240)}` };
  if (!c) return { url: null, reason: 'OpenRouter returned no choices for the image request. Try again, or pick another image model.' };
  return { url: null, reason: `The model returned an empty reply${finish ? ` (${finish})` : ''}. On an explicit scene that is usually the provider's filter; otherwise pick a model that lists image output.` };
}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  top_provider?: { context_length?: number };
  architecture?: { output_modalities?: string[] };
}

export function toModelInfo(m: RawModel): ModelInfo {
  const per = (s?: string) => (s ? Number(s) * 1_000_000 : 0);
  return {
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? m.top_provider?.context_length ?? 0,
    promptPricePerM: per(m.pricing?.prompt),
    completionPricePerM: per(m.pricing?.completion),
    supportsReasoning: (m.supported_parameters ?? []).some((p) => p === 'reasoning' || p === 'include_reasoning'),
    privacy: 'unknown',
    outputImage: (m.architecture?.output_modalities ?? []).includes('image'),
  };
}
