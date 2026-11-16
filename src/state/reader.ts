import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, now } from '@/core/ids';
import { emptyReader, pageOf, pageText, parseReaderReply, personaOf, readerPrompt, shouldReact, typingMs, unreadOf, type ReaderCue, type ReaderData, type ReaderKey, type ReaderMsg } from '@/core/reader';
import { getReader, saveReader } from '@/db/repo/reader';
import { agentModel } from './agent';
import { complete } from './paint';
import { useSession } from './session';

/**
 * Read with me, on the story screen: the reader's conversation for the open
 * story, what they are typing, and the newest thing they said while the
 * panel was closed (shown as a peek above the composer).
 */
interface ReaderState {
  sessionId: string | null;
  data: ReaderData;
  open: boolean;
  typing: boolean;
  error: string | null;
  /** Something the reader said while the panel was closed. */
  peek: ReaderMsg | null;
  load(db: SQLiteDatabase, sessionId: string): Promise<void>;
  setOpen(db: SQLiteDatabase, open: boolean): void;
  start(db: SQLiteDatabase): Promise<void>;
  send(db: SQLiteDatabase, text: string): Promise<void>;
  /** New pages are in: the reader reads them, and may say something. */
  react(db: SQLiteDatabase): Promise<void>;
  setPersona(db: SQLiteDatabase, key: ReaderKey, custom?: { name: string; description: string } | null): Promise<void>;
  setQuiet(db: SQLiteDatabase, quiet: boolean): Promise<void>;
  /** Forget the conversation; the reader keeps reading from here. */
  restart(db: SQLiteDatabase): Promise<void>;
  /** The writer took up an idea. */
  used(db: SQLiteDatabase, msgId: string): Promise<void>;
  dismissPeek(): void;
  clearError(): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let busy = false;

export const useReader = create<ReaderState>((set, get) => {
  const write = async (db: SQLiteDatabase, data: ReaderData) => {
    const id = get().sessionId;
    set({ data });
    if (id) await saveReader(db, id, data);
  };

  /** Ask the reader for their next turn, and let it arrive message by message. */
  async function turn(db: SQLiteDatabase, cue: ReaderCue): Promise<void> {
    const sid = get().sessionId;
    const { session, path } = useSession.getState();
    if (!sid || !session || session.id !== sid) return;
    const data = get().data;
    const persona = personaOf(data.persona, data.custom);
    const remembered = session.summaryUpToBeatId ? session.summary : '';
    const messages = readerPrompt({ persona, title: session.title, page: pageText(path, data.readTo, { remembered }), messages: data.messages, cue });
    const last = pageOf(path).slice(-1)[0]?.id ?? data.readTo;
    set({ typing: true, error: null });
    try {
      const { text } = await complete({ model: agentModel(), messages, maxTokens: 700, temperature: 0.95, stallMs: 120000, spend: { db, note: `reader: ${session.title}` } });
      if (get().sessionId !== sid) return;
      const reply = parseReaderReply(text);
      if (reply.pass) { await write(db, { ...get().data, readTo: last, since: 0 }); return; }
      const bubbles = reply.bubbles.length ? reply.bubbles : ['…'];
      // Like texting: a pause to type each message, then it lands.
      for (let i = 0; i < bubbles.length; i++) {
        await wait(typingMs(bubbles[i]!));
        if (get().sessionId !== sid) return;
        const m: ReaderMsg = { id: newId(), from: 'reader', text: bubbles[i]!, at: now(), ...(i === bubbles.length - 1 && reply.idea ? { idea: reply.idea } : {}) };
        const cur = get().data;
        const away = !get().open;
        await write(db, { ...cur, messages: [...cur.messages, m], readTo: last, since: 0, unread: away ? cur.unread + 1 : 0 });
        if (away && i === 0) set({ peek: m });
      }
    } catch (e) {
      if (get().sessionId === sid) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (get().sessionId === sid) set({ typing: false });
    }
  }

  const once = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    try { await fn(); } finally { busy = false; }
  };

  return {
    sessionId: null,
    data: emptyReader(),
    open: false,
    typing: false,
    error: null,
    peek: null,
    async load(db, sessionId) {
      if (get().sessionId === sessionId) return;
      set({ sessionId, data: emptyReader(), open: false, typing: false, peek: null, error: null });
      const data = await getReader(db, sessionId);
      if (get().sessionId === sessionId) set({ data });
    },
    setOpen(db, open) {
      set({ open, ...(open ? { peek: null } : {}) });
      if (open && get().data.unread) void write(db, { ...get().data, unread: 0 });
    },
    async start(db) {
      // The hello goes first: switching on also brings in the new pages, and they must wait for it.
      await once(async () => {
        await write(db, { ...get().data, on: true, readTo: null, since: 0 });
        await turn(db, { kind: 'hello' });
      });
    },
    async send(db, text) {
      const t = text.trim();
      if (!t) return;
      const m: ReaderMsg = { id: newId(), from: 'writer', text: t, at: now() };
      await write(db, { ...get().data, on: true, messages: [...get().data.messages, m] });
      // Waits its turn if the reader is mid-reaction, so the writer is always answered.
      while (busy) await wait(250);
      await once(() => turn(db, { kind: 'reply' }));
    },
    async react(db) {
      const d = get().data;
      if (!d.on || busy) return;
      const { path, session } = useSession.getState();
      if (!session || session.mode !== 'writer') return;
      const fresh = unreadOf(path, d.readTo);
      if (!fresh.length) return;
      // Everything since they last spoke counts as new; read quietly, it piles up until it is worth a word.
      const speak = shouldReact({ quiet: d.quiet, fresh: fresh.length, freshChars: fresh.reduce((n, b) => n + b.text.length, 0), since: 0, roll: Math.random() });
      if (!speak) return;
      await once(() => turn(db, { kind: 'react' }));
    },
    async setPersona(db, key, custom) {
      await write(db, { ...get().data, persona: key, custom: custom ?? get().data.custom });
    },
    async setQuiet(db, quiet) {
      await write(db, { ...get().data, quiet });
    },
    async restart(db) {
      const last = pageOf(useSession.getState().path).slice(-1)[0]?.id ?? null;
      await write(db, { ...get().data, messages: [], unread: 0, since: 0, readTo: last });
      set({ peek: null });
    },
    async used(db, msgId) {
      await write(db, { ...get().data, messages: get().data.messages.map((m) => (m.id === msgId ? { ...m, used: true } : m)) });
    },
    dismissPeek: () => set({ peek: null }),
    clearError: () => set({ error: null }),
  };
});
