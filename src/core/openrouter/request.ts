import type { ChatMessage, GenerationParams } from '../types';

/**
 * Everything OpenRouter-specific about the request body lives here so it can be
 * corrected in one place if a parameter name differs from what the docs say.
 */
export interface RequestOptions {
  model: string;
  messages: ChatMessage[];
  params: GenerationParams;
  zdr: boolean;
  stream: boolean;
  /** Fallback models OpenRouter may route to if the primary fails. */
  fallbackModels?: string[];
  providerIgnore?: string[];
  providerOrder?: string[];
}

export function buildRequestBody(o: RequestOptions): Record<string, unknown> {
  const provider: Record<string, unknown> = {
    // Exclude providers that may log or train on prompts.
    data_collection: 'deny',
    allow_fallbacks: true,
  };
  if (o.zdr) provider.zdr = true;
  if (o.providerIgnore?.length) provider.ignore = o.providerIgnore;
  if (o.providerOrder?.length) provider.order = o.providerOrder;
  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    stream: o.stream,
    temperature: o.params.temperature,
    top_p: o.params.topP,
    max_tokens: o.params.maxTokens,
    provider,
    // Ask for token counts and cost in the final chunk.
    usage: { include: true },
  };
  if (o.params.reasoning) body.reasoning = { effort: 'medium' };
  if (o.params.frequencyPenalty) body.frequency_penalty = o.params.frequencyPenalty;
  if (o.params.presencePenalty) body.presence_penalty = o.params.presencePenalty;
  if (o.params.repetitionPenalty && o.params.repetitionPenalty !== 1) body.repetition_penalty = o.params.repetitionPenalty;
  if (o.fallbackModels?.length) body.models = [o.model, ...o.fallbackModels];
  return body;
}

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/mildlyyanked/project_sand',
    'X-Title': 'Sand',
  };
}
