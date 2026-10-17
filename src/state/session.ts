import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Beat, Character, ChatMessage, ContextLayer, Id, Illustration, LoreEntry, RefusalStep, Session, Species, Style, Universe } from '@/core/types';
import { indexBeats, pathTo, type BeatIndex, descendants, leafOf, stepSibling } from '@/core/beatTree';
import { assembleContext, splitPath, summaryPrompt, type AssembleInput, type WorldContext } from '@/core/context/assemble';
import type { CheckResult, SceneState } from '@/core/world/types';
import { rollCheck } from '@/core/world/dice';
import { applyDelta, sheetDiff, useItem as spendItem, parseEffects, type PovDelta } from '@/core/world/survival';
import { formatDuration as formatDurationShort } from '@/core/world/calendar';
import { sceneAt } from '@/core/world/timeline';
import { DEFAULT_ART_STYLE, newcomersPrompt, parseNewcomers, type Newcomer } from '@/core/world/forge';
import { normName } from '@/core/world/drafts';
import { imageOf, namedIn } from '@/core/world/portraits';
import { buildWorldContext, chronicle, chronicleOn, emptyWorldBundle, gmRead, initialScene, loadWorldBundle, seedThreads, type WorldBundle } from './world';
import type { GmRead } from '@/core/world/gm';
import { clinicOpening, clinicSystem, critiquePrompt, imagePromptPrompt, parseClinicReply, parseSuggestions, planPrompt, scenePrompt, suggestPrompt, transcriptOf, type ClinicEdit } from '@/core/helpers';
import { renderHeat } from '@/core/context/cards';
import { manuscriptText } from '@/core/beatTree';
import { generateWithChain, momentumTail } from '@/core/openrouter/generate';
import { applyRepetition, trimDegenerate } from '@/core/repetition';
import { newId, now } from '@/core/ids';
import { client } from './client';
import { runInForeground } from './foreground';
import { imageDataUrl, removeImage, saveImage } from './images';
import { generateViaBackend } from './imageBackend';
import { useSettings } from './settings';
import { recordSpend } from '@/db/repo/spend';
import { deleteEventsForBeat } from '@/db/repo/world';
import { deleteBeats, getSession, insertBeat, listBeats, makeBeat, patchSession, updateBeatText, updateBeatWorld, upsertSession } from '@/db/repo/sessions';
import { deleteIllustration, getCharacters, getStyle, getUniverse, listIllustrations, listLore, listModelStats, listSpecies, recordAttempt, saveIllustration } from '@/db/repo/library';

export interface Streaming {
  text: string;
  reasoning: string;
  attempt: number;
  step: RefusalStep | null;
  model: string;
  phase: 'summarizing' | 'writing' | 'reweaving' | 'planning' | 'critiquing' | 'proposing' | 'suggesting' | 'illustrating' | 'refereeing' | 'chronicling';
  startedAt: number;
  /** Beat being replaced (regenerate) or the parent for a new beat. */
  parentId: Id | null;
}

/** A sibling draft written by an extra model alongside the main passage. */
export interface Draft {
  model: string;
  text: string;
  done: boolean;
  error?: string;
}

/** A refusal the chain could not, or was told not to, get past. The clinic works from this. */
export interface Refusal {
  text: string;
  model: string;
  transcript: string;
  instruction: string;
  /** The instruction beat that was sent last, if any; the clinic can rewrite it. */
  instructionBeatId: Id | null;
  parentId: Id | null;
  regenerateId?: Id;
  direction?: string;
  heat: string | null;
  /** True when a Diagnose step stopped the chain: open the clinic without asking. */
  auto: boolean;
}

/** The refusal clinic's conversation. Kept here so leaving and returning never re-asks the editor model. */
export interface ClinicTurn {
  role: 'user' | 'assistant';
  text: string;
  edits: ClinicEdit[];
  applied: number[];
}
export interface ClinicState {
  turns: ClinicTurn[];
  convo: ChatMessage[];
  busy: boolean;
  pending: string | null;
  error: string | null;
}

interface Bundle {
  style: Style | null;
  characters: Character[];
  species: Species[];
  universe: Universe | null;
  lore: LoreEntry[];
}

interface SessionState {
  db: SQLiteDatabase | null;
  session: Session | null;
  beats: Beat[];
  index: BeatIndex;
  path: Beat[];
  bundle: Bundle;
  /** Places, factions, things, the instance and the player's character. */
  wb: WorldBundle;
  /** World context at the current beat; null for vanilla stories. */
  world: WorldContext | null;
  /** Survival thresholds crossed in the last passage, told to the writer on the next one. */
  survivalNotes: string[];
  refreshWorld(): Promise<void>;
  /** POV: use one of an inventory item; its effects apply now, then the narrator continues. */
  useItem(name: string): Promise<void>;
  /** POV quick action or writer instruction: add it and continue. */
  act(text: string): Promise<void>;
  /** Set the in-world time at the current beat (or the story's opening time when empty). */
  setClock(minutes: number): Promise<void>;
  /** Correct the player's sheet by hand: applied to the latest passage, so undo and branches keep their own books. */
  adjustSheet(delta: PovDelta): Promise<void>;
  /** Run the chronicle again for a passage (the latest one): its time, place, events and the sheet, from the moment before it. */
  rechronicle(beatId: Id): Promise<void>;
  streaming: Streaming | null;
  drafts: Draft[];
  illustrations: Illustration[];
  suggestions: string[];
  sceneProposal: string | null;
  refusal: Refusal | null;
  clinic: ClinicState | null;
  /** The manuscript opened the clinic for this refusal; do not open it again on its own. */
  ackClinic(): void;
  /** Start the clinic's diagnosis if it has not started; a no-op when a conversation exists or a call is in flight. */
  clinicStart(): Promise<void>;
  clinicSend(text: string): Promise<void>;
  /** Ask again after a failed round, with the same conversation. */
  clinicRetry(): Promise<void>;
  clinicMarkApplied(turn: number, edit: number): void;
  /** An image prompt written for a passage: to copy out, or to review and then paint. */
  imagePrompt: { beatId: Id; prompt: string; canPaint: boolean } | null;
  clearImagePrompt(): void;
  /** Paint a prompt the writer has seen (and maybe edited) with the configured backend. */
  paint(beatId: Id, prompt: string): Promise<void>;
  /** Set by diagnoseNow: the running chain stops and the last refusal opens the clinic. */
  diagnoseOnStop: boolean;
  error: string | null;
  notice: string | null;
  dropped: Set<string>;
  lastLog: string[];
  abort: AbortController | null;

  open(db: SQLiteDatabase, id: Id): Promise<void>;
  reload(): Promise<void>;
  patch(p: Partial<Session>): Promise<void>;
  setCurrent(id: Id | null): Promise<void>;
  addBeat(role: Beat['role'], text: string, extra?: { state?: SceneState | null; at?: number | null }): Promise<Beat>;
  editBeat(id: Id, text: string): Promise<void>;
  deleteFrom(id: Id): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  swipe(id: Id, dir: 1 | -1): Promise<void>;
  preview(direction?: string, model?: string): ReturnType<typeof assembleContext> | null;
  generate(o?: { direction?: string; regenerateId?: Id; model?: string; parentId?: Id | null }): Promise<void>;
  stop(): void;
  summarizeNow(): Promise<void>;
  toggleDropped(key: string): void;
  clearError(): void;
  setNotice(n: string | null): void;
  insertGenerated(o: { parentId: Id | null; text: string; model: string; direction?: string; reasoning?: string; plan?: string | null; usage?: { promptTokens: number; completionTokens: number; costUsd: number | null } | null; keepCurrent?: boolean }): Promise<Beat>;
  critiqueAndRedo(beatId: Id): Promise<void>;
  /** Ask the helper for a scene plan; the result waits in sceneProposal. */
  proposeScene(wish: string): Promise<void>;
  clearScene(): void;
  /** Three short instructions the writer could send next. */
  suggest(): Promise<void>;
  clearSuggestions(): void;
  /** Passage to image prompt to picture, one tap. With promptOnly, or the prompt-only backend, it stops at the prompt. */
  illustrate(beatId: Id, o?: { promptOnly?: boolean }): Promise<void>;
  /** Names the story brought in that the library lacks: kept on the session until canonized or dismissed. */
  addNewcomers(list: Newcomer[]): Promise<void>;
  /** Ask the helper which names in a passage are new to the library. */
  findNewcomers(beatId: Id): Promise<void>;
  dismissNewcomer(name: string): Promise<void>;
  /** A newcomer became a library entry: drop it from the list, reload the world, and cast a new character. */
  canonized(name: string, characterIds: Id[]): Promise<void>;
  removeIllustration(id: Id): Promise<void>;
  clearRefusal(): void;
  /** Stop retrying right now and take the refusal seen so far to the clinic. */
  diagnoseNow(): void;
  /** Retry the refused passage, optionally with a one-time direction or on another model. */
  retryRefusal(o?: { direction?: string; model?: string }): Promise<void>;
}

const emptyIndex = indexBeats([]);
const emptyBundle: Bundle = { style: null, characters: [], species: [], universe: null, lore: [] };

export const useSession = create<SessionState>((set, get) => {
  const recompute = (beats: Beat[], session: Session) => {
    const index = indexBeats(beats);
    const path = pathTo(index, session.currentBeatId);
    return { beats, index, path };
  };

  async function loadBundle(db: SQLiteDatabase, s: Session): Promise<Bundle> {
    const ids = s.mode === 'pov' && s.pov?.characterId && !s.characterIds.includes(s.pov.characterId) ? [s.pov.characterId, ...s.characterIds] : s.characterIds;
    const [style, characters, universe] = await Promise.all([getStyle(db, s.styleId), getCharacters(db, ids), s.universeId ? getUniverse(db, s.universeId) : Promise.resolve(null)]);
    const [species, lore] = s.universeId ? await Promise.all([listSpecies(db, s.universeId), listLore(db, s.universeId)]) : [await listSpecies(db, null), []];
    return { style, characters, species, universe, lore };
  }

  let clinicStarting = false;
  /** Patches in flight; a reload during one keeps the in-memory session. */
  let patching = 0;
  /** Sessions whose threads were seeded (or tried) this run, so a failed seed is not retried every turn. */
  const threadsTried = new Set<string>();

  /** One round of the clinic. Runs to completion even if the screen is left; the result lands in the store. */
  async function clinicAsk(history: ChatMessage[]): Promise<void> {
    const { session } = get();
    const { apiKey, defaults } = useSettings.getState();
    if (!session || !apiKey) return;
    const editorModel = defaults.editorModel || session.models.writer || defaults.models.writer;
    const patch = (p: Partial<ClinicState>) => set((st) => (st.clinic ? { clinic: { ...st.clinic, ...p } } : {}));
    patch({ busy: true, pending: '', error: null });
    let out = '';
    try {
      await runInForeground('Diagnosing the refusal', async () => {
        for await (const ev of client.stream({ apiKey, model: editorModel, messages: history, params: { temperature: 0.4, topP: 0.9, maxTokens: 2500, reasoning: false }, zdr: session.zdr })) {
          if (ev.type === 'text') {
            out += ev.text ?? '';
            patch({ pending: parseClinicReply(out).prose || out });
          }
          if (ev.type === 'error') throw new Error(ev.error);
        }
      });
      const parsed = parseClinicReply(out);
      set((st) => (st.clinic ? { clinic: { ...st.clinic, convo: [...history, { role: 'assistant', content: out }], turns: [...st.clinic.turns, { role: 'assistant', text: parsed.prose, edits: parsed.edits, applied: [] }], busy: false, pending: null } } : {}));
    } catch (e) {
      patch({ busy: false, pending: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const assembleInput = (direction?: string, model?: string): AssembleInput | null => {
    const { session, path, bundle, dropped, world } = get();
    if (!session) return null;
    return { session, path, ...bundle, model: model ?? session.models.writer, direction, dropped, world: world ?? undefined, templates: useSettings.getState().templates };
  };

  return {
    db: null, session: null, beats: [], index: emptyIndex, path: [], bundle: emptyBundle, wb: emptyWorldBundle, world: null, survivalNotes: [], streaming: null, drafts: [], illustrations: [], suggestions: [], sceneProposal: null, refusal: null, clinic: null, imagePrompt: null, diagnoseOnStop: false, error: null, notice: null, dropped: new Set(), lastLog: [], abort: null,

    async open(db, id) {
      const row = await getSession(db, id);
      if (!row) {
        set({ db, session: null, beats: [], index: emptyIndex, path: [], error: 'Session not found' });
        return;
      }
      const fresh = get().session?.id !== id;
      // A reload must never undo a change that is newer in memory than in the row it just read.
      const inMemory = get().session;
      const session = !fresh && inMemory && (patching > 0 || inMemory.updatedAt > row.updatedAt) ? inMemory : row;
      const [beats, bundle, illustrations, wb] = await Promise.all([listBeats(db, id), loadBundle(db, session), listIllustrations(db, id), loadWorldBundle(db, session)]);
      set({ db, session, bundle, wb, illustrations, error: null, dropped: fresh ? new Set() : get().dropped, ...(fresh ? { suggestions: [], sceneProposal: null, drafts: [], refusal: null, clinic: null, survivalNotes: [], world: null } : {}), ...recompute(beats, session) });
      await get().refreshWorld();
    },
    async refreshWorld() {
      const { db, session, path, wb } = get();
      if (!db || !session) return;
      const world = (await buildWorldContext(db, session, path, wb, { survivalNotes: get().survivalNotes })) ?? null;
      if (get().session?.id === session.id) set({ world });
    },
    async reload() {
      const { db, session } = get();
      if (db && session) await get().open(db, session.id);
    },
    async patch(p) {
      const { db, session } = get();
      if (!db || !session) return;
      // Build on what is in memory, not on a fresh read of the row: two quick changes must both survive.
      const next: Session = { ...session, ...p, updatedAt: now() };
      patching++;
      try {
        set({ session: next, ...recompute(get().beats, next) });
        await upsertSession(db, next);
        const needBundle = 'styleId' in p || 'characterIds' in p || 'universeId' in p || 'pov' in p || 'mode' in p;
        if (needBundle) set({ bundle: await loadBundle(db, next) });
        if (needBundle || 'instanceId' in p) set({ wb: await loadWorldBundle(db, next) });
        if (needBundle || 'instanceId' in p || 'currentBeatId' in p || 'world' in p || 'clockStart' in p) await get().refreshWorld();
      } finally {
        patching--;
      }
    },
    async setCurrent(id) {
      await get().patch({ currentBeatId: id });
    },
    async addBeat(role, text, extra) {
      const { db, session } = get();
      if (!db || !session) throw new Error('No session');
      const b = makeBeat({ sessionId: session.id, parentId: session.currentBeatId, role, text, state: extra?.state ?? null, at: extra?.at ?? null });
      await insertBeat(db, b);
      const beats = [...get().beats, b];
      const next = (await patchSession(db, session.id, { currentBeatId: b.id }))!;
      set({ session: next, ...recompute(beats, next) });
      await get().refreshWorld();
      return b;
    },
    async editBeat(id, text) {
      const { db } = get();
      if (!db) return;
      await updateBeatText(db, id, text);
      const beats = get().beats.map((b) => (b.id === id ? { ...b, text } : b));
      set(recompute(beats, get().session!));
    },
    async deleteFrom(id) {
      const { db, session, index } = get();
      if (!db || !session) return;
      const target = index.byId.get(id);
      if (!target) return;
      const ids = [id, ...descendants(index, id).map((b) => b.id)];
      await deleteBeats(db, ids);
      const beats = get().beats.filter((b) => !ids.includes(b.id));
      const onPath = get().path.some((b) => b.id === id);
      const patch: Partial<Session> = onPath ? { currentBeatId: target.parentId } : {};
      if (session.summaryUpToBeatId && ids.includes(session.summaryUpToBeatId)) {
        patch.summary = '';
        patch.summaryUpToBeatId = null;
      }
      const next = (await patchSession(db, session.id, patch))!;
      set({ session: next, ...recompute(beats, next) });
      await get().refreshWorld();
    },
    async undo() {
      const { path } = get();
      const last = path[path.length - 1];
      if (!last) return;
      await get().setCurrent(last.parentId);
    },
    async redo() {
      const { session, index } = get();
      if (!session) return;
      const kids = index.children.get(session.currentBeatId) ?? [];
      const next = kids[kids.length - 1];
      if (next) await get().setCurrent(next.id);
    },
    async swipe(id, dir) {
      const { index } = get();
      const sib = stepSibling(index, id, dir);
      if (!sib) return;
      await get().setCurrent(leafOf(index, sib.id).id);
    },
    preview(direction, model) {
      const input = assembleInput(direction, model);
      return input ? assembleContext(input) : null;
    },
    toggleDropped(key) {
      const d = new Set(get().dropped);
      if (d.has(key)) d.delete(key);
      else d.add(key);
      set({ dropped: d });
    },
    clearError: () => set({ error: null }),
    setNotice: (notice) => set({ notice }),
    stop() {
      get().abort?.abort();
    },

    async insertGenerated({ parentId, text, model, direction, reasoning, plan, usage, keepCurrent }) {
      const { db, session } = get();
      if (!db || !session) throw new Error('No session');
      const b = makeBeat({ sessionId: session.id, parentId, role: 'prose', text, model, direction: direction ?? null, reasoning: reasoning || null, plan: plan || null, promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null, costUsd: usage?.costUsd ?? null });
      await insertBeat(db, b);
      const beats = [...get().beats, b];
      const next = keepCurrent ? get().session! : (await patchSession(db, session.id, { currentBeatId: b.id }))!;
      set({ session: next, ...recompute(beats, next) });
      if (!keepCurrent) void get().refreshWorld();
      return b;
    },

    async critiqueAndRedo(beatId) {
      const { db, session, index, bundle } = get();
      const { apiKey } = useSettings.getState();
      if (!db || !session || !apiKey || get().streaming) return;
      const beat = index.byId.get(beatId);
      if (!beat) return;
      const before = pathTo(index, beat.parentId);
      const previous = [...before].reverse().find((b) => b.role === 'prose')?.text ?? '';
      const abort = new AbortController();
      set({ abort, error: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'critiquing', startedAt: now(), parentId: beat.parentId } });
      let notes = '';
      try {
        await runInForeground('Critiquing the passage', async () => {
          for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: critiquePrompt({ brief: session.brief, style: bundle.style, previous, passage: beat.text }, useSettings.getState().templates), params: { temperature: 0.3, topP: 0.9, maxTokens: 500, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
            if (ev.type === 'text') {
              notes += ev.text ?? '';
              set((s) => (s.streaming ? { streaming: { ...s.streaming, text: notes } } : {}));
            }
            if (ev.type === 'error') throw new Error(ev.error);
          }
        });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
        set({ streaming: null, abort: null });
        return;
      }
      set({ streaming: null, abort: null });
      if (!notes.trim()) return;
      await get().generate({ regenerateId: beatId, direction: `Editor's notes on the previous attempt. Fix every one of them:\n${notes.trim()}` });
    },

    async summarizeNow() {
      const { db, session, path } = get();
      const { apiKey } = useSettings.getState();
      if (!db || !session || !apiKey) return;
      const { summarized, overflow, recent } = splitPath(path, session, session.strategy);
      // Summarize everything except the recent window.
      const toFold = overflow.length ? overflow : recent.slice(0, Math.max(0, recent.length - 2));
      if (!toFold.length) {
        set({ notice: 'Nothing to summarize yet' });
        return;
      }
      const abort = new AbortController();
      set({ streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.summarizer, phase: 'summarizing', startedAt: now(), parentId: null }, abort, error: null });
      await runInForeground('Summarizing the story so far', async () => {
      try {
        let text = '';
        for await (const ev of client.stream({ apiKey, model: session.models.summarizer, messages: summaryPrompt(session.summary, toFold, useSettings.getState().templates), params: { temperature: 0.3, topP: 0.9, maxTokens: 1200, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
          if (ev.type === 'text') {
            text += ev.text ?? '';
            set((s) => (s.streaming ? { streaming: { ...s.streaming, text } } : {}));
          }
          if (ev.type === 'error') throw new Error(ev.error);
        }
        const upto = toFold[toFold.length - 1]!.id;
        await get().patch({ summary: text.trim(), summaryUpToBeatId: upto });
        set({ notice: `Folded ${toFold.length + summarized.length > toFold.length ? toFold.length : toFold.length} beats into the summary` });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }
      });
    },

    async generate(o = {}) {
      const { db, session, bundle, index } = get();
      const { apiKey } = useSettings.getState();
      if (!db || !session) return;
      if (!apiKey) {
        set({ error: 'Add your OpenRouter key in Settings first.' });
        return;
      }
      if (get().streaming) return;
      if (session.explicit && bundle.characters.some((c) => !c.adult)) {
        set({ error: 'Explicit sessions require every attached character to be flagged adult.' });
        return;
      }
      const model = o.model ?? session.models.writer;
      // Regenerate: the new beat becomes a sibling of the target.
      let parentId: Id | null = o.parentId !== undefined ? o.parentId : session.currentBeatId;
      if (o.regenerateId) {
        const target = index.byId.get(o.regenerateId);
        if (!target) return;
        parentId = target.parentId;
      }
      let path = pathTo(index, parentId);
      const abort = new AbortController();
      set({ abort, error: null, suggestions: [], drafts: [], refusal: null, diagnoseOnStop: false, streaming: { text: '', reasoning: '', attempt: 0, step: null, model, phase: 'writing', startedAt: now(), parentId } });

      await runInForeground('Writing the next passage', async () => {
      try {
        // Fold overflow into the summary first, so the model never loses the middle.
        let sess = session;
        const parts = splitPath(path, sess, sess.strategy);
        if (parts.overflow.length) {
          set((s) => (s.streaming ? { streaming: { ...s.streaming, phase: 'summarizing', model: sess.models.summarizer } } : {}));
          let text = '';
          for await (const ev of client.stream({ apiKey, model: sess.models.summarizer, messages: summaryPrompt(sess.summary, parts.overflow, useSettings.getState().templates), params: { temperature: 0.3, topP: 0.9, maxTokens: 1200, reasoning: false }, zdr: sess.zdr, signal: abort.signal })) {
            if (ev.type === 'text') text += ev.text ?? '';
            if (ev.type === 'error') throw new Error(ev.error);
          }
          if (text.trim()) {
            sess = (await patchSession(db, sess.id, { summary: text.trim(), summaryUpToBeatId: parts.overflow[parts.overflow.length - 1]!.id }))!;
            set({ session: sess });
          }
          set((s) => (s.streaming ? { streaming: { ...s.streaming, phase: 'writing', model } } : {}));
        }
        const lastProse = [...path].reverse().find((b) => b.role === 'prose');
        const lastBeat = path[path.length - 1];
        const wb = get().wb;
        const playing = sess.mode === 'pov' && !!wb.player;
        // Play: the game master reads the turn (what the player is after, how the world answers, what changes),
        // and if it is tested the dice are rolled here, not by the model. Threads are prepared once, before the first read.
        let check: CheckResult | null = null;
        let read: GmRead | null = null;
        const action = [lastBeat?.role === 'instruction' ? lastBeat.text : '', o.direction ?? ''].filter(Boolean).join('; ');
        if (playing && !o.regenerateId) {
          set((s) => (s.streaming ? { streaming: { ...s.streaming, phase: 'refereeing', model: sess.models.helper } } : {}));
          try {
            let scene = sceneAt(path, initialScene(sess, wb));
            if (scene.pov && !scene.pov.threads?.length && !threadsTried.has(sess.id)) {
              threadsTried.add(sess.id);
              const threads = await seedThreads({ apiKey, model: sess.models.helper, zdr: sess.zdr, signal: abort.signal, session: sess, universe: bundle.universe, species: bundle.species, wb, recent: lastProse?.text ?? '' });
              if (threads.length) {
                const tip = path[path.length - 1];
                if (tip) {
                  const state = { ...scene, pov: { ...scene.pov, threads } };
                  await updateBeatWorld(db, tip.id, tip.at, state);
                  const beats = get().beats.map((b) => (b.id === tip.id ? { ...b, state } : b));
                  set(recompute(beats, sess));
                  path = path.map((b) => (b.id === tip.id ? { ...b, state } : b));
                } else {
                  sess = { ...sess, pov: sess.pov ? { ...sess.pov, threads } : sess.pov };
                  await upsertSession(db, sess);
                  set({ session: sess });
                }
                scene = sceneAt(path, initialScene(sess, wb));
              }
            }
            read = await gmRead({ apiKey, model: sess.models.helper, zdr: sess.zdr, signal: abort.signal, action, scene, player: wb.player!, universe: bundle.universe, difficulty: sess.pov?.difficulty ?? 'survival', recent: lastProse?.text ?? '', checks: sess.pov?.checks !== false, wb });
            const ruling = read?.ruling;
            if (ruling) check = rollCheck({ attribute: ruling.attribute, difficulty: ruling.difficulty, score: wb.player!.data.attributes?.[ruling.attribute], state: scene.pov, why: ruling.why, onSuccess: ruling.onSuccess, onFailure: ruling.onFailure });
          } catch {
            if (abort.signal.aborted) return;
          }
          set((s) => (s.streaming ? { streaming: { ...s.streaming, phase: 'writing', model } } : {}));
        }
        if (o.regenerateId && playing) {
          const prev = index.byId.get(o.regenerateId)?.state?.pov;
          check = prev?.lastCheck ?? null;
          read = prev?.lastRead ?? null;
        }
        const world = await buildWorldContext(db, sess, path, wb, { check, read, survivalNotes: get().survivalNotes });
        // Plan first: a short, cheap call to the helper that gives the writer a spine to follow. Not in play: the player is the plan.
        let plan = '';
        if (sess.planFirst && !playing) {
          set((s) => (s.streaming ? { streaming: { ...s.streaming, phase: 'planning', model: sess.models.helper } } : {}));
          try {
            const instruction = [lastBeat?.role === 'instruction' ? lastBeat.text : '', o.direction ?? ''].filter(Boolean).join('; ');
            for await (const ev of client.stream({ apiKey, model: sess.models.helper, messages: planPrompt({ brief: sess.brief, summary: sess.summary, recent: lastProse?.text ?? '', instruction, opening: !lastProse && !sess.summary, style: bundle.style }, useSettings.getState().templates), params: { temperature: 0.5, topP: 0.9, maxTokens: 260, reasoning: false }, zdr: sess.zdr, signal: abort.signal })) {
              if (ev.type === 'text') plan += ev.text ?? '';
            }
          } catch {
            if (abort.signal.aborted) return;
            plan = '';
          }
          set((s) => (s.streaming ? { streaming: { ...s.streaming, phase: 'writing', model } } : {}));
        }
        const ctx = assembleContext({ session: sess, path, ...bundle, model, direction: o.direction, dropped: get().dropped, plan: plan.trim() || undefined, templates: useSettings.getState().templates, world });
        set({ lastLog: ctx.log });
        // Extra drafts: other models write the same passage as siblings, without the chain, so the writer can compare in place.
        const extra = o.regenerateId ? [] : sess.draftModels.filter((m) => m && m !== model);
        const draftJobs = extra.map(async (dm, i) => {
          const upd = (p: Partial<Draft>) => set((st) => ({ drafts: st.drafts.map((d, j) => (j === i ? { ...d, ...p } : d)) }));
          try {
            const dctx = model === dm ? ctx : assembleContext({ session: sess, path, ...bundle, model: dm, direction: o.direction, dropped: get().dropped, plan: plan.trim() || undefined, templates: useSettings.getState().templates, world });
            let text = '';
            let cost: number | null = null;
            for await (const ev of client.stream({ apiKey, model: dm, messages: dctx.messages, params: applyRepetition(sess.params, bundle.style?.repetition), zdr: sess.zdr, providerIgnore: bundle.style?.providerIgnore, providerOrder: bundle.style?.providerOrder, signal: abort.signal })) {
              if (ev.type === 'text') { text += ev.text ?? ''; upd({ text }); }
              if (ev.type === 'usage') cost = ev.usage?.costUsd ?? null;
              if (ev.type === 'error') throw new Error(ev.error);
            }
            const clean = trimDegenerate(text).text.trim();
            upd({ done: true, text: clean });
            if (clean.length > 40 && !abort.signal.aborted) await get().insertGenerated({ parentId, text: clean, model: dm, direction: o.direction, plan: plan.trim() || null, usage: cost != null ? { promptTokens: 0, completionTokens: 0, costUsd: cost } : null, keepCurrent: true });
          } catch (e) {
            upd({ done: true, error: e instanceof Error ? e.message : String(e) });
          }
        });
        if (extra.length) set({ drafts: extra.map((m) => ({ model: m, text: '', done: false })) });
        const stats = await listModelStats(db);
        const autoModel = (exclude: string[]) => {
          const ranked = stats
            .filter((st) => st.attempts >= 2 && !exclude.includes(st.model))
            .sort((a, b) => a.refusals / a.attempts - b.refusals / b.attempts || b.attempts - a.attempts);
          const best = ranked[0];
          return best && best.refusals / best.attempts < 0.34 ? best.model : null;
        };
        const attempts = await generateWithChain({
          client, apiKey, model, messages: ctx.messages, params: applyRepetition(sess.params, bundle.style?.repetition), zdr: sess.zdr, refusalChain: bundle.style?.refusalChain ?? [], signal: abort.signal,
          providerIgnore: bundle.style?.providerIgnore, providerOrder: bundle.style?.providerOrder,
          helperModel: sess.models.helper,
          momentumText: lastProse ? momentumTail(lastProse.text) : '',
          instructionText: [lastBeat?.role === 'instruction' ? lastBeat.text : '', o.direction ?? ''].filter(Boolean).join('\n') || undefined,
          autoModel,
          softenSystem: useSettings.getState().templates.soften,
          onAttempt: (attempt, step, m) => set((s) => (s.streaming ? { streaming: { ...s.streaming, attempt, step, model: m, text: '', reasoning: '' } } : {})),
          onDelta: (_a, text, reasoning) => set((s) => (s.streaming ? { streaming: { ...s.streaming, text, reasoning } } : {})),
        });
        for (const a of attempts) if (!a.skipped && !a.error) void recordAttempt(db, a.model, a.refused);
        const recordRefusal = (att: (typeof attempts)[number], auto: boolean) => {
          const refusedText = att.stripPrefix && att.text.startsWith(att.stripPrefix) ? att.text.slice(att.stripPrefix.length) : att.text;
          set({ clinic: null, refusal: { text: refusedText.trim(), model: att.model, transcript: transcriptOf(ctx.messages), instruction: lastBeat?.role === 'instruction' ? lastBeat.text : '', instructionBeatId: lastBeat?.role === 'instruction' ? lastBeat.id : null, parentId, regenerateId: o.regenerateId, direction: o.direction, heat: sess.explicit ? renderHeat(sess.heat) : null, auto } });
        };
        if (abort.signal.aborted) {
          await Promise.all(draftJobs);
          if (get().diagnoseOnStop) {
            const refused = [...attempts].reverse().find((a) => a.refused && !a.skipped);
            if (refused) recordRefusal(refused, true);
            else set({ notice: 'Stopped before a refusal was recorded.' });
            return;
          }
          const partial = attempts[attempts.length - 1];
          const partialText = partial && partial.stripPrefix && partial.text.startsWith(partial.stripPrefix) ? partial.text.slice(partial.stripPrefix.length) : partial?.text ?? '';
          if (partial && partialText.trim().length > 40) {
            await get().insertGenerated({ parentId, text: partialText.trim(), model: partial.model, direction: o.direction, reasoning: partial.reasoning });
            set({ notice: 'Stopped. Kept the partial passage.' });
          }
          return;
        }
        const final = [...attempts].reverse().find((a) => !a.skipped) ?? attempts[attempts.length - 1];
        if (!final) return;
        const halted = attempts[attempts.length - 1]?.step?.kind === 'diagnose';
        if (halted && final.refused) {
          await Promise.all(draftJobs);
          recordRefusal(final, true);
          return;
        }
        if (final.error && !final.text.trim()) {
          await Promise.all(draftJobs);
          set({ error: final.error });
          return;
        }
        const rawText = final.stripPrefix && final.text.startsWith(final.stripPrefix) ? final.text.slice(final.stripPrefix.length) : final.text;
        const guarded = trimDegenerate(rawText);
        const finalText = guarded.text;
        const totalCost = attempts.reduce((n, a) => n + (a.usage?.costUsd ?? 0), 0);
        const usage = final.usage ? { ...final.usage, costUsd: attempts.some((a) => a.usage?.costUsd != null) ? totalCost : null } : null;
        const mainBeat = await get().insertGenerated({ parentId, text: finalText.trim(), model: final.model, direction: o.direction, reasoning: final.reasoning, plan: plan.trim() || null, usage });
        // The passage is on the page; the footer now only tracks the extra drafts still writing.
        set((st) => (st.streaming ? { streaming: { ...st.streaming, text: '', reasoning: '' } } : {}));
        // The chronicle: time, place, events, and in play the player's books. A refusal is not chronicled.
        if (chronicleOn(sess) && !final.refused && finalText.trim()) {
          set((st) => (st.streaming ? { streaming: { ...st.streaming, phase: 'chronicling', model: sess.models.helper } } : {}));
          try {
            const out = await chronicle({ db, apiKey, model: sess.models.helper, zdr: sess.zdr, signal: abort.signal, session: sess, universe: bundle.universe, species: bundle.species, wb, beat: mainBeat, parentPath: path, action, check, read });
            if (out) {
              const beats = get().beats.map((b) => (b.id === mainBeat.id ? { ...b, at: out.at, state: out.scene } : b));
              set({ survivalNotes: out.notes, ...recompute(beats, get().session!) });
              if (out.newcomers.length) await get().addNewcomers(out.newcomers);
              if (out.scene.pov?.down && !sceneAt(path, initialScene(sess, wb)).pov?.down) set({ notice: sess.pov?.difficulty === 'hardcore' ? `${wb.player?.name ?? 'Your character'} has fallen. Undo to try again from an earlier moment, or play out the end.` : `${wb.player?.name ?? 'Your character'} is down. The story goes on, at a cost.` });
            } else if (check || read) {
              // Keep the roll on the passage even when the chronicle could not be read.
              const scene = sceneAt(path, initialScene(sess, wb));
              const state = { ...scene, pov: scene.pov ? { ...scene.pov, lastCheck: check, lastRead: read } : undefined };
              await updateBeatWorld(db, mainBeat.id, null, state);
              set(recompute(get().beats.map((b) => (b.id === mainBeat.id ? { ...b, state } : b)), get().session!));
            }
          } catch (e) {
            if (!abort.signal.aborted) set({ notice: `The chronicle could not record this passage (${e instanceof Error ? e.message : String(e)}). The story is unaffected; time and events stand where they were.` });
          }
          await get().refreshWorld();
        }
        await Promise.all(draftJobs);
        const ran = attempts.filter((a) => !a.skipped);
        const okDrafts = get().drafts.filter((d) => d.done && !d.error && d.text.length > 40).length;
        if (okDrafts) set({ notice: `${okDrafts + 1} drafts written. Swipe the passage's arrows to compare; the others stay one swipe away.` });
        if (guarded.trimmed) set({ notice: 'Cut a tail where the prose broke down into a run-on. If this keeps happening, set the style card\'s repetition control to Off; sampler penalties can starve a long passage of articles and punctuation.' });
        else if (final.refused) {
          recordRefusal(final, false);
          set({ notice: `Every step of the refusal chain came back as a refusal (${ran.length} attempts). Kept the last one so you can judge; the clinic can work out why.` });
        }
        else if (ran.length > 1) set({ notice: `Pushed through on attempt ${ran.length}${final.step ? ` via ${final.step.kind}` : ''}${final.model !== model ? ` on ${final.model.split('/').pop()}` : ''}.` });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null, drafts: [], diagnoseOnStop: false });
      }
      });
    },

    async proposeScene(wish) {
      const { session, path, bundle } = get();
      const { apiKey } = useSettings.getState();
      if (!session || !apiKey || get().streaming) return;
      const abort = new AbortController();
      set({ abort, error: null, sceneProposal: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'proposing', startedAt: now(), parentId: session.currentBeatId } });
      try {
        await runInForeground('Planning the next scene', async () => {
          const recent = manuscriptText(path.slice(-3));
          let text = '';
          for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: scenePrompt({ universe: bundle.universe, characters: bundle.characters, style: bundle.style, summary: session.summary, recent, wish }), params: { temperature: 0.9, topP: 0.95, maxTokens: 500, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
            if (ev.type === 'text') {
              text += ev.text ?? '';
              set((st) => (st.streaming ? { streaming: { ...st.streaming, text } } : {}));
            }
            if (ev.type === 'error') throw new Error(ev.error);
          }
          set({ sceneProposal: text.trim() || null });
        });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }
    },
    clearScene: () => set({ sceneProposal: null }),

    async suggest() {
      const { session, path, bundle } = get();
      const { apiKey } = useSettings.getState();
      if (!session || !apiKey || get().streaming) return;
      const abort = new AbortController();
      set({ abort, error: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'suggesting', startedAt: now(), parentId: session.currentBeatId } });
      try {
        const recent = [...path].reverse().find((b) => b.role === 'prose')?.text ?? '';
        const interactive = /second person|\byou\b/i.test(bundle.style?.pointOfView ?? '');
        let text = '';
        for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: suggestPrompt({ brief: session.brief, summary: session.summary, recent, style: bundle.style, interactive }), params: { temperature: 0.9, topP: 0.95, maxTokens: 200, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
          if (ev.type === 'text') text += ev.text ?? '';
          if (ev.type === 'error') throw new Error(ev.error);
        }
        const list = parseSuggestions(text);
        if (!list.length) throw new Error('The helper did not return suggestions. Try again.');
        set({ suggestions: list });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }
    },
    clearSuggestions: () => set({ suggestions: [] }),

    clearImagePrompt: () => set({ imagePrompt: null }),
    async illustrate(beatId, o = {}) {
      const { db, session, index, bundle } = get();
      const { apiKey, imageKey, defaults } = useSettings.getState();
      const backend = defaults.imageBackend;
      const promptOnly = o.promptOnly || backend.kind === 'prompt';
      if (!db || !session || get().streaming) return;
      if (!apiKey) {
        set({ error: 'Add your OpenRouter key in Settings first.' });
        return;
      }
      if (!promptOnly && backend.kind === 'openrouter' && !defaults.imageModel) {
        set({ error: 'Pick an image model in Settings first.' });
        return;
      }
      if (!promptOnly && backend.kind !== 'openrouter' && !backend.baseUrl.trim()) {
        set({ error: 'Set the image server address in Settings → Illustrations first.' });
        return;
      }
      const beat = index.byId.get(beatId);
      if (!beat) return;
      // People named in the passage, from the cast and the world, with their looks and portraits.
      const { wb } = get();
      const people = [...bundle.characters, ...wb.people, ...(wb.player ? [wb.player] : [])].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
      const named = people.filter((c) => namedIn(beat.text, c.name));
      const refs = backend.kind === 'openrouter' && defaults.portraitReferences ? named.filter((c) => imageOf(c.data as Record<string, unknown>)).slice(0, 3) : [];
      const scene = beat.state ?? sceneAt(get().path, initialScene(session, wb));
      const placeEnt = scene.locationId ? wb.entities.find((e) => e.id === scene.locationId) : undefined;
      const place = placeEnt ? [placeEnt.name, placeEnt.summary, typeof placeEnt.data.description === 'string' ? placeEnt.data.description : ''].filter(Boolean).join('. ').slice(0, 400) : scene.locationName || undefined;
      const abort = new AbortController();
      set({ abort, error: null, imagePrompt: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'illustrating', startedAt: now(), parentId: beat.parentId } });
      try {
        await runInForeground(promptOnly ? 'Describing the picture' : 'Illustrating the passage', async () => {
          let prompt = '';
          const canPaint = backend.kind !== 'prompt';
          for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: imagePromptPrompt({ passage: beat.text, characters: named.length ? named : bundle.characters, universe: bundle.universe, style: bundle.style, brief: session.brief, place, references: refs.length, fixedStyle: true }), params: { temperature: 0.7, topP: 0.95, maxTokens: 3000, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
            if (ev.type === 'text') {
              prompt += ev.text ?? '';
              set((st) => (st.streaming ? { streaming: { ...st.streaming, text: prompt } } : {}));
            }
            if (ev.type === 'error') throw new Error(ev.error);
          }
          prompt = prompt.trim();
          if (!prompt) throw new Error('The helper produced no image prompt.');
          // The world's art direction leads, so illustrations match its portraits and views.
          const art = bundle.universe?.data.artStyle?.trim() || defaults.artStyle.trim() || DEFAULT_ART_STYLE;
          prompt = `${art.replace(/[.\s]+$/, '')}. ${prompt}`;
          if (promptOnly || defaults.reviewImagePrompt) {
            set({ imagePrompt: { beatId, prompt, canPaint } });
            return;
          }
          await paintWith(prompt);
        });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }

      async function paintWith(prompt: string) {
        set((st) => (st.streaming ? { streaming: { ...st.streaming, model: backend.kind === 'openrouter' ? defaults.imageModel : backend.model || backend.kind, text: prompt } } : {}));
        const references = (await Promise.all(refs.map((c) => imageDataUrl(imageOf(c.data as Record<string, unknown>)!.uri)))).filter((x): x is string => !!x);
        const img = backend.kind === 'openrouter'
          ? await client.generateImage({ apiKey, model: defaults.imageModel, prompt, zdr: session!.zdr, signal: abort.signal, references })
          : await generateViaBackend(backend, imageKey, prompt, abort.signal);
        const id = newId();
        const uri = await saveImage(id, img.dataUrl);
        const ill = { id, sessionId: session!.id, beatId, prompt, uri, model: img.model, createdAt: now() };
        await saveIllustration(db!, ill);
        await recordSpend(db!, { kind: 'image', model: img.model, sessionId: session!.id, costUsd: img.costUsd, note: 'illustration' });
        set({ illustrations: [...get().illustrations, ill] });
      }
    },
    async paint(beatId, prompt) {
      const { db, session, index } = get();
      const { apiKey, imageKey, defaults } = useSettings.getState();
      const backend = defaults.imageBackend;
      const beat = index.byId.get(beatId);
      if (!db || !session || !beat || get().streaming || !prompt.trim() || backend.kind === 'prompt') return;
      const abort = new AbortController();
      set({ abort, error: null, imagePrompt: null, streaming: { text: prompt, reasoning: '', attempt: 0, step: null, model: backend.kind === 'openrouter' ? defaults.imageModel : backend.model || backend.kind, phase: 'illustrating', startedAt: now(), parentId: beat.parentId } });
      try {
        await runInForeground('Painting the picture', async () => {
          const { wb, bundle } = get();
          const people = [...bundle.characters, ...wb.people, ...(wb.player ? [wb.player] : [])];
          const refs = backend.kind === 'openrouter' && defaults.portraitReferences ? people.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i && namedIn(beat.text, c.name) && imageOf(c.data as Record<string, unknown>)).slice(0, 3) : [];
          const references = (await Promise.all(refs.map((c) => imageDataUrl(imageOf(c.data as Record<string, unknown>)!.uri)))).filter((x): x is string => !!x);
          const img = backend.kind === 'openrouter'
            ? await client.generateImage({ apiKey, model: defaults.imageModel, prompt: prompt.trim(), zdr: session.zdr, signal: abort.signal, references })
            : await generateViaBackend(backend, imageKey, prompt.trim(), abort.signal);
          const id = newId();
          const uri = await saveImage(id, img.dataUrl);
          const ill = { id, sessionId: session.id, beatId, prompt: prompt.trim(), uri, model: img.model, createdAt: now() };
          await saveIllustration(db, ill);
          await recordSpend(db, { kind: 'image', model: img.model, sessionId: session.id, costUsd: img.costUsd, note: 'illustration' });
          set({ illustrations: [...get().illustrations, ill] });
        });
      } catch (e) {
        // Keep the prompt on screen so it can be edited and tried again.
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e), imagePrompt: { beatId, prompt, canPaint: true } });
      } finally {
        set({ streaming: null, abort: null });
      }
    },
    async addNewcomers(list) {
      const { session } = get();
      if (!session || !list.length) return;
      const dismissed = new Set((session.world.dismissed ?? []).map(normName));
      const have = session.world.newcomers ?? [];
      const seen = new Set(have.map((n) => normName(n.name)));
      const add = list.filter((n) => { const k = normName(n.name); if (dismissed.has(k) || seen.has(k)) return false; seen.add(k); return true; });
      if (!add.length) return;
      await get().patch({ world: { ...session.world, newcomers: [...have, ...add].slice(-20) } });
    },
    async findNewcomers(beatId) {
      const { session, index, wb, bundle } = get();
      const { apiKey } = useSettings.getState();
      const beat = index.byId.get(beatId);
      if (!session || !beat || get().streaming) return;
      if (!apiKey) return set({ error: 'Add your OpenRouter key in Settings first.' });
      const known = [...wb.people, ...bundle.characters].map((c) => c.name).concat(wb.entities.map((e) => e.name), bundle.species.map((x) => x.name), wb.player ? [wb.player.name] : []);
      const abort = new AbortController();
      set({ abort, error: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'chronicling', startedAt: now(), parentId: beat.parentId } });
      try {
        let text = '';
        for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: newcomersPrompt({ passage: beat.text, known }), params: { temperature: 0.2, topP: 0.9, maxTokens: 3000, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
          if (ev.type === 'text') text += ev.text ?? '';
          if (ev.type === 'error') throw new Error(ev.error);
        }
        const found = parseNewcomers(text, known).map((n) => ({ ...n, beatId }));
        const before = get().session?.world.newcomers?.length ?? 0;
        await get().addNewcomers(found);
        const added = (get().session?.world.newcomers?.length ?? 0) - before;
        set({ notice: added ? `Found ${added} new name${added === 1 ? '' : 's'}. Canonize them from the bar above the composer.` : 'No names in this passage that the library does not already have.' });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }
    },
    async dismissNewcomer(name) {
      const { session } = get();
      if (!session) return;
      const k = normName(name);
      await get().patch({ world: { ...session.world, newcomers: (session.world.newcomers ?? []).filter((n) => normName(n.name) !== k), dismissed: [...(session.world.dismissed ?? []), name].slice(-200) } });
    },
    async canonized(name, characterIds) {
      const { session, db } = get();
      if (!session || !db) return;
      const k = normName(name);
      const cast = [...session.characterIds, ...characterIds.filter((id) => !session.characterIds.includes(id) && id !== session.pov?.characterId)];
      await get().patch({ world: { ...session.world, newcomers: (session.world.newcomers ?? []).filter((n) => normName(n.name) !== k) }, characterIds: cast });
      set({ wb: await loadWorldBundle(db, get().session!) });
      await get().refreshWorld();
    },
    async useItem(name) {
      const { session, path, wb } = get();
      if (!session || session.mode !== 'pov' || get().streaming) return;
      const scene = sceneAt(path, initialScene(session, wb));
      if (!scene.pov) return;
      const item = scene.pov.inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (!item) return;
      const def = wb.entities.find((e) => e.kind === 'item' && (e.id === item.itemId || e.name.toLowerCase() === item.name.toLowerCase()));
      const effects = parseEffects(def?.data.effects ?? item.note ?? '');
      const used = spendItem(scene.pov, item.name, effects);
      const effectText = Object.entries(effects).map(([k, v]) => `${k} ${v! > 0 ? '+' : ''}${v}`).join(', ');
      set({ survivalNotes: used.notes });
      await get().addBeat('instruction', `You use the ${item.name}.${effectText ? ` (Already applied: ${effectText}.)` : ''}`, { state: { ...scene, pov: used.state } });
      await get().generate();
    },
    async act(text) {
      const v = text.trim();
      if (!v || get().streaming) return;
      await get().addBeat('instruction', v);
      await get().generate();
    },
    async setClock(minutes) {
      const { db, session, path } = get();
      if (!db || !session) return;
      const m = Math.max(0, Math.round(minutes));
      const tip = path[path.length - 1];
      if (!tip) {
        await get().patch({ clockStart: m });
        return;
      }
      await updateBeatWorld(db, tip.id, m, tip.state);
      set(recompute(get().beats.map((b) => (b.id === tip.id ? { ...b, at: m } : b)), session));
      await get().refreshWorld();
    },
    async adjustSheet(delta) {
      const { db, session, path, wb } = get();
      if (!db || !session || session.mode !== 'pov') return;
      const tip = path[path.length - 1];
      const scene = sceneAt(path, initialScene(session, wb));
      if (!scene.pov) return;
      const next = applyDelta(scene.pov, delta).state;
      if (!tip) {
        set({ notice: 'Write or play the opening first; the sheet is kept on passages.' });
        return;
      }
      const state = { ...scene, pov: next };
      await updateBeatWorld(db, tip.id, tip.at, state);
      set(recompute(get().beats.map((b) => (b.id === tip.id ? { ...b, state } : b)), session));
      await get().refreshWorld();
    },
    async rechronicle(beatId) {
      const { db, session, path, index, wb, bundle } = get();
      const { apiKey } = useSettings.getState();
      const beat = index.byId.get(beatId);
      const at = path.findIndex((b) => b.id === beatId);
      if (!db || !session || !beat || at < 0 || get().streaming) return;
      if (!apiKey) return set({ error: 'Add your OpenRouter key in Settings first.' });
      const parentPath = path.slice(0, at);
      const lastProse = parentPath.map((b, i) => ({ b, i })).filter((x) => x.b.role === 'prose').pop()?.i ?? -1;
      const action = parentPath.slice(lastProse + 1).filter((b) => b.role === 'instruction').map((b) => b.text).join('\n');
      const before = sceneAt(parentPath, initialScene(session, wb)).pov;
      const abort = new AbortController();
      set({ abort, error: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'chronicling', startedAt: now(), parentId: beat.parentId } });
      try {
        await deleteEventsForBeat(db, beat.id);
        const out = await chronicle({ db, apiKey, model: session.models.helper, zdr: session.zdr, signal: abort.signal, session, universe: bundle.universe, species: bundle.species, wb, beat, parentPath, action, check: beat.state?.pov?.lastCheck ?? null, read: beat.state?.pov?.lastRead ?? null });
        if (!out) throw new Error('The chronicle could not be read. Try again, or correct the sheet by hand.');
        set({ survivalNotes: out.notes, ...recompute(get().beats.map((b) => (b.id === beat.id ? { ...b, at: out.at, state: out.scene } : b)), get().session!) });
        if (out.newcomers.length) await get().addNewcomers(out.newcomers);
        const diff = sheetDiff(before, out.scene.pov, bundle.universe?.data.currency || 'coins');
        set({ notice: `Recorded again: ${formatDurationShort(out.minutes)}${diff.length ? `; ${diff.join(', ')}` : '; no change to the sheet'}.` });
        await get().refreshWorld();
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }
    },
    clearRefusal: () => set({ refusal: null, clinic: null }),
    ackClinic: () => set((st) => (st.refusal ? { refusal: { ...st.refusal, auto: false } } : {})),
    async clinicStart() {
      const { db, session, refusal, bundle, clinic } = get();
      if (!db || !session || !refusal || clinic || clinicStarting) return;
      clinicStarting = true;
      try {
        const ledger = await listModelStats(db);
        const opening: ChatMessage[] = [clinicSystem(), clinicOpening({ model: refusal.model, refusal: refusal.text, transcript: refusal.transcript, instruction: refusal.instruction, voiceSystem: bundle.style?.system ?? '', postHistory: bundle.style?.postHistory ?? '', brief: session.brief, heat: refusal.heat, ledger })];
        set({ clinic: { turns: [], convo: opening, busy: false, pending: null, error: null } });
      } finally {
        clinicStarting = false;
      }
      await clinicAsk(get().clinic!.convo);
    },
    async clinicRetry() {
      const c = get().clinic;
      if (!c || c.busy) return;
      await clinicAsk(c.convo);
    },
    async clinicSend(text) {
      const c = get().clinic;
      const v = text.trim();
      if (!c || c.busy || !v) return;
      const convo = [...c.convo, { role: 'user' as const, content: v }];
      set({ clinic: { ...c, turns: [...c.turns, { role: 'user', text: v, edits: [], applied: [] }], convo } });
      await clinicAsk(convo);
    },
    clinicMarkApplied: (turn, edit) => set((st) => (st.clinic ? { clinic: { ...st.clinic, turns: st.clinic.turns.map((t, i) => (i === turn ? { ...t, applied: [...t.applied, edit] } : t)) } } : {})),
    diagnoseNow() {
      if (!get().streaming || get().streaming?.phase !== 'writing') return;
      set({ diagnoseOnStop: true });
      get().abort?.abort();
    },
    async retryRefusal(o = {}) {
      const r = get().refusal;
      if (!r) return;
      set({ refusal: null });
      // A kept refusal sits on the page as the current beat; the retry replaces it as a sibling.
      const cur = get().session?.currentBeatId ?? null;
      const keptRefusal = !r.auto && cur && cur !== r.parentId ? cur : undefined;
      await get().generate({ parentId: keptRefusal ? undefined : r.parentId, regenerateId: keptRefusal ?? r.regenerateId, direction: o.direction ?? r.direction, model: o.model });
    },
    async removeIllustration(id) {
      const { db, illustrations } = get();
      if (!db) return;
      const ill = illustrations.find((i) => i.id === id);
      await deleteIllustration(db, id);
      if (ill) await removeImage(ill.uri);
      set({ illustrations: illustrations.filter((i) => i.id !== id) });
    },
  };
});

export function layerSummary(layers: ContextLayer[]): string {
  return layers.filter((l) => !l.dropped).map((l) => `${l.label} ${l.tokens}`).join(' · ');
}
