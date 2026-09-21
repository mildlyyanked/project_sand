import type { Beat, Id } from '@/core/types';
import { reweavePrompt } from '@/core/helpers';
import { makeBeat, insertBeat, patchSession } from '@/db/repo/sessions';
import { now } from '@/core/ids';
import { client } from './client';
import { useSession } from './session';
import { useSettings } from './settings';

/**
 * Replace a beat on the current path with an edited version and rewrite the
 * later passages so they agree with the change. Everything lands on a new
 * branch; the original stays reachable through the sibling control.
 */
export async function reweave(beatId: Id, editedText: string): Promise<void> {
  const st = useSession.getState();
  const { db, session, path } = st;
  const { apiKey } = useSettings.getState();
  if (!db || !session) return;
  const idx = path.findIndex((b) => b.id === beatId);
  if (idx < 0) return;
  const original = path[idx]!;
  const downstream = path.slice(idx + 1);
  const prose = downstream.filter((b) => b.role === 'prose');

  const abort = new AbortController();
  useSession.setState({ abort, error: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'reweaving', startedAt: now(), parentId: original.parentId } });
  try {
    let rewritten: string[] = [];
    if (prose.length && apiKey) {
      let text = '';
      const msgs = reweavePrompt({ original: original.text, edited: editedText, downstream: prose.map((b) => b.text).join('\n---\n') });
      for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: msgs, params: { temperature: 0.4, topP: 0.9, maxTokens: 6000, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
        if (ev.type === 'text') {
          text += ev.text ?? '';
          useSession.setState((s) => (s.streaming ? { streaming: { ...s.streaming, text } } : {}));
        }
        if (ev.type === 'error') throw new Error(ev.error);
      }
      rewritten = text.split(/\n\s*---\s*\n/).map((x) => x.trim()).filter(Boolean);
      if (rewritten.length !== prose.length) rewritten = prose.length === 1 ? [text.trim()] : [];
    }
    if (abort.signal.aborted) return;
    const edited: Beat = makeBeat({ sessionId: session.id, parentId: original.parentId, role: original.role, text: editedText, model: original.model, direction: original.direction });
    await insertBeat(db, edited);
    const inserted: Beat[] = [edited];
    let parentId = edited.id;
    let pi = 0;
    for (const b of downstream) {
      const text = b.role === 'prose' ? rewritten[pi++] ?? b.text : b.text;
      const nb = makeBeat({ sessionId: session.id, parentId, role: b.role, text, model: b.role === 'prose' && rewritten.length ? session.models.helper : b.model, direction: b.direction });
      await insertBeat(db, nb);
      inserted.push(nb);
      parentId = nb.id;
    }
    await patchSession(db, session.id, { currentBeatId: parentId });
    await st.reload();
    useSession.setState({ notice: rewritten.length ? `Reweaved ${prose.length} later passage${prose.length === 1 ? '' : 's'} on a new branch.` : downstream.length ? 'Edited on a new branch. Later passages were copied unchanged.' : 'Edited on a new branch.' });
  } catch (e) {
    if (!abort.signal.aborted) useSession.setState({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    useSession.setState({ streaming: null, abort: null });
  }
}
