import { fetch as expoFetch } from 'expo/fetch';
import { createClient, type FetchLike } from '@/core/openrouter/client';
import { withResume } from '@/core/openrouter/resilient';

const fetchLike: FetchLike = async (url, init) => {
  const res = await expoFetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: init.signal ?? undefined });
  return { ok: res.ok, status: res.status, body: res.body, text: () => res.text(), json: () => res.json() };
};

export const client = withResume(createClient(fetchLike));
