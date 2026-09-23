import type { OpenRouterClient, StreamEvent, StreamRequest } from './client';
import type { ChatMessage } from '../types';

const RETRYABLE = /connection|abort|reset|network|socket|timed? ?out|EPIPE|ECONN|unexpected end|stream/i;

/**
 * Wrap a client so a stream that dies mid-way (backgrounded process, network
 * hop, provider hiccup) is resumed instead of failed: the text received so far
 * becomes an assistant prefill and the request is re-issued. Callers see one
 * continuous stream of events.
 */
export function withResume(client: OpenRouterClient, opts: { maxResumes?: number; delayMs?: number } = {}): OpenRouterClient {
  const maxResumes = opts.maxResumes ?? 3;
  const delayMs = opts.delayMs ?? 800;
  async function* stream(req: StreamRequest): AsyncGenerator<StreamEvent> {
    let received = '';
    let resumes = 0;
    let messages = req.messages;
    for (;;) {
      try {
        for await (const ev of client.stream({ ...req, messages })) {
          if (ev.type === 'text') received += ev.text ?? '';
          if (ev.type === 'error' && RETRYABLE.test(ev.error ?? '') && received && resumes < maxResumes) throw new Error(ev.error);
          yield ev;
        }
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const canResume = !req.signal?.aborted && received.length > 0 && resumes < maxResumes && RETRYABLE.test(msg);
        if (!canResume) throw e;
        resumes++;
        yield { type: 'resume', text: `Connection dropped; resuming (${resumes})`, model: req.model } as StreamEvent;
        await new Promise((r) => setTimeout(r, delayMs * resumes));
        messages = continueFrom(req.messages, received);
      }
    }
  }
  return { ...client, stream };
}

/** Messages that pick up mid-reply: everything so far becomes the assistant prefill. */
export function continueFrom(messages: ChatMessage[], received: string): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  if (last?.role === 'assistant') last.content = received.startsWith(last.content) ? received : last.content + received;
  else out.push({ role: 'assistant', content: received });
  return out;
}
