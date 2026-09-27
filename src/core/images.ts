/**
 * Image backends other than OpenRouter. Both are plain HTTP contracts that many
 * hosts and local servers speak, so an open-weights model can be used without
 * a provider's moderation layer:
 *
 * - `openai`: POST {baseUrl}/images/generations, the OpenAI images shape. Spoken by
 *   hosted APIs built on open models (Venice, Together, fal, RunPod templates…) and by
 *   local servers that expose it.
 * - `a1111`: POST {baseUrl}/sdapi/v1/txt2img, the AUTOMATIC1111 / Forge / SD.Next
 *   web UI API. Run it on a PC with `--api --listen` and point the phone at it.
 * - `prompt`: no painting at all. The image prompt is shown to copy into any
 *   generator's web page, such as Perchance, which has no API.
 */
export type ImageBackendKind = 'openrouter' | 'openai' | 'a1111' | 'prompt';

export interface ImageBackend {
  kind: ImageBackendKind;
  /** Base URL without a trailing slash, e.g. https://api.venice.ai/api/v1 or http://192.168.1.20:7860 */
  baseUrl: string;
  /** Model or checkpoint name; empty means the server's default. */
  model: string;
  /** Sent as negative_prompt where the backend has one. */
  negativePrompt: string;
  /** Sampling steps for a1111; 0 means the server's default. */
  steps: number;
  /** Square size in pixels. */
  size: number;
}

export const DEFAULT_IMAGE_BACKEND: ImageBackend = { kind: 'openrouter', baseUrl: '', model: '', negativePrompt: '', steps: 0, size: 1024 };

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** The request for a backend, so it can be inspected and tested without a network. */
export function imageRequest(b: ImageBackend, prompt: string): { url: string; body: Record<string, unknown> } {
  if (b.kind === 'a1111') {
    const body: Record<string, unknown> = { prompt, width: b.size, height: b.size, negative_prompt: b.negativePrompt };
    if (b.steps > 0) body.steps = b.steps;
    if (b.model.trim()) body.override_settings = { sd_model_checkpoint: b.model.trim() };
    return { url: `${trimBase(b.baseUrl)}/sdapi/v1/txt2img`, body };
  }
  const body: Record<string, unknown> = { prompt, n: 1, size: `${b.size}x${b.size}`, response_format: 'b64_json' };
  if (b.model.trim()) body.model = b.model.trim();
  if (b.negativePrompt.trim()) body.negative_prompt = b.negativePrompt.trim();
  return { url: `${trimBase(b.baseUrl)}/images/generations`, body };
}

/** The image as a data URL, from either response shape. */
export function parseImageResponse(kind: ImageBackendKind, json: unknown): string {
  const j = (json ?? {}) as { images?: unknown; data?: unknown; error?: unknown; detail?: unknown };
  if (kind === 'a1111') {
    const first = Array.isArray(j.images) ? j.images[0] : undefined;
    if (typeof first !== 'string' || !first) throw new Error(errorText(j) || 'The server returned no image.');
    return first.startsWith('data:') ? first : `data:image/png;base64,${first}`;
  }
  const first = Array.isArray(j.data) ? (j.data[0] as { b64_json?: string; url?: string } | undefined) : undefined;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  if (first?.url) return first.url;
  throw new Error(errorText(j) || 'The server returned no image.');
}

function errorText(j: { error?: unknown; detail?: unknown }): string {
  const e = j.error ?? j.detail;
  if (!e) return '';
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' ? m : JSON.stringify(e).slice(0, 200);
}

export function describeBackend(b: ImageBackend): string {
  if (b.kind === 'openrouter') return 'OpenRouter';
  if (b.kind === 'prompt') return 'nothing here; the prompt is copied to a generator of your choice';
  if (b.kind === 'a1111') return `Stable Diffusion web UI at ${trimBase(b.baseUrl) || '…'}`;
  return `${trimBase(b.baseUrl) || '…'}${b.model ? ` · ${b.model}` : ''}`;
}
