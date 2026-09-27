import { fetch as expoFetch } from 'expo/fetch';
import { imageRequest, parseImageResponse, type ImageBackend } from '@/core/images';

/** One image from a self-chosen host: an OpenAI-shaped images endpoint or a Stable Diffusion web UI. */
export async function generateViaBackend(b: ImageBackend, apiKey: string, prompt: string, signal?: AbortSignal): Promise<{ dataUrl: string; model: string }> {
  const { url, body } = imageRequest(b, prompt);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let res: Awaited<ReturnType<typeof expoFetch>>;
  try {
    res = await expoFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new Error(`Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = json ? parseErr(json) : text.slice(0, 200);
    throw new Error(`${res.status} from the image server${msg ? `: ${msg}` : ''}`);
  }
  return { dataUrl: parseImageResponse(b.kind, json), model: b.model || (b.kind === 'a1111' ? 'sd-webui' : 'images-api') };
}

function parseErr(j: unknown): string {
  const e = (j as { error?: unknown; detail?: unknown }).error ?? (j as { detail?: unknown }).detail;
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown } | undefined)?.message;
  return typeof m === 'string' ? m : '';
}
