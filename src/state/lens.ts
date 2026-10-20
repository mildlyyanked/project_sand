import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { cardPrompt, guessPrompt, parseCard, parseGuess, parseScan, scanPrompt, type LensClue, type LensData, type LensPin, type LensPoint } from '@/core/lens';
import { characterDraft, draftCard, entityDraft, knowledge, libraryDrafts, normName, speciesDraft, type Library } from '@/core/world/drafts';
import { threadsForChronicle } from '@/core/world/gm';
import { renderPov } from '@/core/world/survival';
import { sceneAt } from '@/core/world/timeline';
import { formatShort } from '@/core/world/calendar';
import { newId, now } from '@/core/ids';
import { getLens, listLens, saveLens } from '@/db/repo/lens';
import { useSession } from './session';
import { initialScene } from './world';
import { complete } from './paint';
import { useSettings } from './settings';

/**
 * The Lens for the open story: which passages have been looked at (for their
 * highlights), the drawer's place in them, and the work of scanning a passage,
 * writing a point's card, and judging a theory on the clue board.
 */
interface LensState {
  sessionId: string | null;
  data: Record<string, LensData>;
  open: boolean;
  beatId: string | null;
  /** Indexes: a point of the passage, then into each card's "look closer". */
  path: number[];
  tab: 'scene' | 'clues';
  busy: 'scan' | 'card' | 'guess' | null;
  error: string | null;
  verdict: { verdict: 'hit' | 'close' | 'miss'; nudge: string } | null;
  load(db: SQLiteDatabase, sessionId: string): Promise<void>;
  show(beatId: string, path?: number[]): Promise<void>;
  showClues(): void;
  close(): void;
  go(path: number[]): Promise<void>;
  scan(beatId: string): Promise<void>;
  pin(name: string, text: string): Promise<void>;
  unpin(id: string): Promise<void>;
  guess(clueIds: string[], theory: string): Promise<void>;
  setTab(tab: 'scene' | 'clues'): void;
  clearError(): void;
}

/** The point a path leads to: a passage's point, then down through "look closer". */
export function pointAt(data: LensData | undefined, path: number[]): LensPoint | null {
  if (!data || !path.length) return null;
  let p: LensPoint | undefined = data.points[path[0]!];
  for (const i of path.slice(1)) p = p?.card?.closer[i];
  return p ?? null;
}

function withPoint(data: LensData, path: number[], fn: (p: LensPoint) => LensPoint): LensData {
  const walk = (list: LensPoint[], rest: number[]): LensPoint[] => list.map((p, i) => {
    if (i !== rest[0]) return p;
    if (rest.length === 1) return fn(p);
    return p.card ? { ...p, card: { ...p.card, closer: walk(p.card.closer, rest.slice(1)) } } : p;
  });
  return { ...data, points: walk(data.points, path) };
}

/** The library the open story can see, for linking names and grounding cards. */
function libraryOf(): Library {
  const s = useSession.getState();
  return { universe: s.bundle.universe, entities: s.wb.entities, characters: [...s.wb.people, ...s.bundle.characters.filter((c) => !s.wb.people.some((p) => p.id === c.id))], species: s.bundle.species, lore: s.bundle.lore };
}

export const useLens = create<LensState>((set, get) => ({
  sessionId: null,
  data: {},
  open: false,
  beatId: null,
  path: [],
  tab: 'scene',
  busy: null,
  error: null,
  verdict: null,

  async load(db, sessionId) {
    if (get().sessionId === sessionId) return;
    set({ sessionId, data: {}, open: false, beatId: null, path: [], error: null, verdict: null, busy: null });
    const all = await listLens(db, sessionId);
    if (get().sessionId === sessionId) set({ data: Object.fromEntries(all) });
  },

  async show(beatId, path = []) {
    set({ open: true, beatId, path, tab: 'scene', error: null });
    const { db } = useSession.getState();
    if (!get().data[beatId] && db) {
      const saved = await getLens(db, beatId);
      if (saved) set((s) => ({ data: { ...s.data, [beatId]: saved } }));
    }
    if (!get().data[beatId]) await get().scan(beatId);
    else if (path.length) await get().go(path);
  },

  showClues() {
    set({ open: true, tab: 'clues', error: null });
  },

  close() {
    set({ open: false, busy: null });
  },

  setTab(tab) {
    set({ tab, verdict: null });
  },

  clearError() {
    set({ error: null });
  },

  async scan(beatId) {
    const ss = useSession.getState();
    const { db, session } = ss;
    const beat = ss.index.byId.get(beatId);
    if (!db || !session || !beat || get().busy) return;
    const sid = session.id;
    set({ busy: 'scan', error: null });
    try {
      const lib = libraryOf();
      const known = [...lib.entities.map((e) => e.name), ...lib.characters.map((c) => c.name), ...lib.species.map((x) => x.name)];
      const pov = session.mode === 'pov' && ss.wb.player ? { name: ss.wb.player.name } : null;
      const { text } = await complete({ model: session.models.helper, messages: scanPrompt({ passage: beat.text, known, pov }), maxTokens: 3000, temperature: 0.4, spend: { db, note: 'lens', sessionId: sid } });
      const points = parseScan(text, beat.text).filter((p) => !pov || normName(p.name) !== normName(pov.name));
      if (!points.length) throw new Error('The Lens found nothing to look at in this passage. Try again, or another helper model.');
      const data: LensData = { points, at: now() };
      await saveLens(db, beatId, sid, data);
      if (get().sessionId === sid) set((s) => ({ data: { ...s.data, [beatId]: data } }));
    } catch (e) {
      if (get().sessionId === sid) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: null });
    }
  },

  async go(path) {
    set({ path, error: null });
    const { beatId } = get();
    if (!beatId || !path.length) return;
    const data = get().data[beatId];
    const point = pointAt(data, path);
    if (!data || !point || point.card || get().busy) return;
    const ss = useSession.getState();
    const { db, session } = ss;
    const beat = ss.index.byId.get(beatId);
    if (!db || !session || !beat) return;
    const sid = session.id;
    set({ busy: 'card' });
    try {
      // Ground the card: the entry it is, what bears on it, and what has happened to it.
      const lib = libraryOf();
      const pool = libraryDrafts(lib);
      const ref = pointAt(data, path.slice(0, 1))?.ref || point.ref;
      const entry = ref ? pool.find((d) => normName(d.name) === normName(ref)) : undefined;
      const e = entry && lib.entities.find((x) => x.id === entry.id);
      const c = entry && lib.characters.find((x) => x.id === entry.id);
      const sp = entry && lib.species.find((x) => x.id === entry.id);
      const own = e ? draftCard(entityDraft(e, lib)) : c ? draftCard(characterDraft(c, lib)) : sp ? draftCard(speciesDraft(sp, lib)) : '';
      const k = knowledge(pool, entry ?? { name: point.name }, `${point.name} ${point.blurb}`, 4000);
      const events = (ss.world?.events ?? []).filter((ev) => (entry && ev.entities.some((r) => r.id === entry.id)) || ev.title.toLowerCase().includes(point.name.toLowerCase()) || ev.text.toLowerCase().includes(point.name.toLowerCase()));
      const cal = ss.bundle.universe?.data.calendar;
      const history = events.slice(-8).map((ev) => `- ${formatShort(cal, ev.at)}: ${ev.title}${ev.text && ev.text !== ev.title ? `. ${ev.text}` : ''}`).join('\n');
      const scene = session.mode === 'pov' ? sceneAt(ss.path, initialScene(session, ss.wb)) : null;
      const pov = scene?.pov && ss.wb.player ? { name: ss.wb.player.name, sheet: renderPov(scene.pov, { name: ss.wb.player.name, currency: ss.bundle.universe?.data.currency ?? '', difficulty: session.pov?.difficulty ?? 'survival' }) } : null;
      const threads = pov ? threadsForChronicle(scene?.pov?.threads) : '';
      const trail = path.slice(0, -1).map((_, i) => pointAt(data, path.slice(0, i + 1))?.name ?? '').filter(Boolean);
      const { text } = await complete({ model: session.models.helper, messages: cardPrompt({ point, trail, passage: beat.text, knowledge: [own ? `# The entry\n${own}` : '', k].filter(Boolean).join('\n\n'), history, pov, threads }), maxTokens: 3000, temperature: 0.7, spend: { db, note: 'lens', sessionId: sid } });
      const card = parseCard(text);
      if (!card) throw new Error('The Lens could not read its notes on this. Try again.');
      const next = withPoint(get().data[beatId] ?? data, path, (p) => ({ ...p, card }));
      await saveLens(db, beatId, sid, next);
      if (get().sessionId !== sid) return;
      set((s) => ({ data: { ...s.data, [beatId]: next } }));
      // A trace of a thread goes on the clue board; which thread stays hidden.
      if (card.clue && session.mode === 'pov') {
        const cur = useSession.getState().session;
        if (cur?.id === sid) {
          const clues = cur.world.clues ?? [];
          if (!clues.some((x) => normName(x.text) === normName(card.clue!.text))) {
            const clue: LensClue = { id: newId(), name: point.name, text: card.clue.text, beatId, thread: card.clue.thread, solved: false };
            await useSession.getState().patch({ world: { ...cur.world, clues: [...clues, clue].slice(-40) } });
          }
        }
      }
    } catch (err) {
      if (get().sessionId === sid) set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ busy: null });
    }
  },

  async pin(name, text) {
    const cur = useSession.getState().session;
    const beatId = get().beatId;
    if (!cur || !beatId || !text.trim()) return;
    const pins = cur.world.pins ?? [];
    if (pins.some((p) => normName(p.text) === normName(text))) return;
    const pin: LensPin = { id: newId(), name, text: text.trim(), beatId };
    await useSession.getState().patch({ world: { ...cur.world, pins: [...pins, pin].slice(-60) } });
  },

  async unpin(id) {
    const cur = useSession.getState().session;
    if (!cur) return;
    await useSession.getState().patch({ world: { ...cur.world, pins: (cur.world.pins ?? []).filter((p) => p.id !== id) } });
  },

  async guess(clueIds, theory) {
    const ss = useSession.getState();
    const { db, session } = ss;
    if (!db || !session || session.mode !== 'pov' || get().busy) return;
    const clues = (session.world.clues ?? []).filter((c) => clueIds.includes(c.id));
    const scene = sceneAt(ss.path, initialScene(session, ss.wb));
    const open = (scene.pov?.threads ?? []).filter((t) => t.status === 'open');
    if (!clues.length) return set({ error: 'Pick the clues you think belong together.' });
    if (!open.length) return set({ verdict: { verdict: 'miss', nudge: 'Whatever this was, it has already run its course.' } });
    set({ busy: 'guess', error: null, verdict: null });
    try {
      const { text } = await complete({ model: session.models.helper, messages: guessPrompt({ clues, guess: theory, threads: threadsForChronicle(open) }), maxTokens: 1500, temperature: 0.3, spend: { db, note: 'lens', sessionId: session.id } });
      const r = parseGuess(text);
      if (!r) throw new Error('The game master could not weigh that theory. Try again.');
      set({ verdict: { verdict: r.verdict, nudge: r.nudge } });
      if (r.verdict === 'hit' && r.thread) {
        const name = normName(r.thread);
        await useSession.getState().updateThreads((ts) => ts.map((t) => (normName(t.name) === name ? { ...t, surfaced: true, suspected: theory.trim() || clues.map((c) => c.text).join(' / ') } : t)));
        const cur = useSession.getState().session;
        if (cur?.id === session.id) await useSession.getState().patch({ world: { ...cur.world, clues: (cur.world.clues ?? []).map((c) => (clueIds.includes(c.id) ? { ...c, solved: true } : c)) } });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: null });
    }
  },
}));

/** Helper-model availability for the Lens, so the screen can say why it is quiet. */
export function lensReady(): boolean {
  return !!useSettings.getState().apiKey;
}
