import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Beat, Character, ContextLayer, Id, Illustration, LoreEntry, RefusalStep, Session, Species, Style, Universe } from '@/core/types';
import { indexBeats, pathTo, type BeatIndex, descendants, leafOf, stepSibling } from '@/core/beatTree';
import { assembleContext, splitPath, summaryPrompt, type AssembleInput } from '@/core/context/assemble';
import { critiquePrompt, imagePromptPrompt, parseSuggestions, planPrompt, scenePrompt, suggestPrompt, transcriptOf } from '@/core/helpers';
import { renderHeat } from '@/core/context/cards';
import { manuscriptText } from '@/core/beatTree';
import { generateWithChain, momentumTail } from '@/core/openrouter/generate';
import { applyRepetition, trimDegenerate } from '@/core/repetition';
import { newId, now } from '@/core/ids';
import { client } from './client';
import { runInForeground } from './foreground';
import { removeImage, saveImage } from './images';
import { useSettings } from './settings';
import { deleteBeats, getSession, insertBeat, listBeats, makeBeat, patchSession, updateBeatText } from '@/db/repo/sessions';
import { deleteIllustration, getCharacters, getStyle, getUniverse, listIllustrations, listLore, listModelStats, listSpecies, recordAttempt, saveIllustration } from '@/db/repo/library';

export interface Streaming {
  text: string;
  reasoning: string;
  attempt: number;
  step: RefusalStep | null;
  model: string;
  phase: 'summarizing' | 'writing' | 'reweaving' | 'planning' | 'critiquing' | 'proposing' | 'suggesting' | 'illustrating';
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
  streaming: Streaming | null;
  drafts: Draft[];
  illustrations: Illustration[];
  suggestions: string[];
  sceneProposal: string | null;
  refusal: Refusal | null;
  error: string | null;
  notice: string | null;
  dropped: Set<string>;
  lastLog: string[];
  abort: AbortController | null;

  open(db: SQLiteDatabase, id: Id): Promise<void>;
  reload(): Promise<void>;
  patch(p: Partial<Session>): Promise<void>;
  setCurrent(id: Id | null): Promise<void>;
  addBeat(role: Beat['role'], text: string): Promise<Beat>;
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
  /** Passage to image prompt to picture, one tap. */
  illustrate(beatId: Id): Promise<void>;
  removeIllustration(id: Id): Promise<void>;
  clearRefusal(): void;
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
    const [style, characters, universe] = await Promise.all([getStyle(db, s.styleId), getCharacters(db, s.characterIds), s.universeId ? getUniverse(db, s.universeId) : Promise.resolve(null)]);
    const [species, lore] = s.universeId ? await Promise.all([listSpecies(db, s.universeId), listLore(db, s.universeId)]) : [await listSpecies(db, null), []];
    return { style, characters, species, universe, lore };
  }

  const assembleInput = (direction?: string, model?: string): AssembleInput | null => {
    const { session, path, bundle, dropped } = get();
    if (!session) return null;
    return { session, path, ...bundle, model: model ?? session.models.writer, direction, dropped };
  };

  return {
    db: null, session: null, beats: [], index: emptyIndex, path: [], bundle: emptyBundle, streaming: null, drafts: [], illustrations: [], suggestions: [], sceneProposal: null, refusal: null, error: null, notice: null, dropped: new Set(), lastLog: [], abort: null,

    async open(db, id) {
      const session = await getSession(db, id);
      if (!session) {
        set({ db, session: null, beats: [], index: emptyIndex, path: [], error: 'Session not found' });
        return;
      }
      const [beats, bundle, illustrations] = await Promise.all([listBeats(db, id), loadBundle(db, session), listIllustrations(db, id)]);
      const fresh = get().session?.id !== id;
      set({ db, session, bundle, illustrations, error: null, dropped: fresh ? new Set() : get().dropped, ...(fresh ? { suggestions: [], sceneProposal: null, drafts: [], refusal: null } : {}), ...recompute(beats, session) });
    },
    async reload() {
      const { db, session } = get();
      if (db && session) await get().open(db, session.id);
    },
    async patch(p) {
      const { db, session } = get();
      if (!db || !session) return;
      const next = await patchSession(db, session.id, p);
      if (!next) return;
      const needBundle = 'styleId' in p || 'characterIds' in p || 'universeId' in p;
      const bundle = needBundle ? await loadBundle(db, next) : get().bundle;
      set({ session: next, bundle, ...recompute(get().beats, next) });
    },
    async setCurrent(id) {
      await get().patch({ currentBeatId: id });
    },
    async addBeat(role, text) {
      const { db, session } = get();
      if (!db || !session) throw new Error('No session');
      const b = makeBeat({ sessionId: session.id, parentId: session.currentBeatId, role, text });
      await insertBeat(db, b);
      const beats = [...get().beats, b];
      const next = (await patchSession(db, session.id, { currentBeatId: b.id }))!;
      set({ session: next, ...recompute(beats, next) });
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
      set({ abort, error: null, suggestions: [], drafts: [], refusal: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model, phase: 'writing', startedAt: now(), parentId } });

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
        // Plan first: a short, cheap call to the helper that gives the writer a spine to follow.
        let plan = '';
        if (sess.planFirst) {
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
        const ctx = assembleContext({ session: sess, path, ...bundle, model, direction: o.direction, dropped: get().dropped, plan: plan.trim() || undefined, templates: useSettings.getState().templates });
        set({ lastLog: ctx.log });
        // Extra drafts: other models write the same passage as siblings, without the chain, so the writer can compare in place.
        const extra = o.regenerateId ? [] : sess.draftModels.filter((m) => m && m !== model);
        const draftJobs = extra.map(async (dm, i) => {
          const upd = (p: Partial<Draft>) => set((st) => ({ drafts: st.drafts.map((d, j) => (j === i ? { ...d, ...p } : d)) }));
          try {
            const dctx = model === dm ? ctx : assembleContext({ session: sess, path, ...bundle, model: dm, direction: o.direction, dropped: get().dropped, plan: plan.trim() || undefined, templates: useSettings.getState().templates });
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
        if (abort.signal.aborted) {
          await Promise.all(draftJobs);
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
        const recordRefusal = (auto: boolean) => {
          const refusedText = final.stripPrefix && final.text.startsWith(final.stripPrefix) ? final.text.slice(final.stripPrefix.length) : final.text;
          set({ refusal: { text: refusedText.trim(), model: final.model, transcript: transcriptOf(ctx.messages), instruction: lastBeat?.role === 'instruction' ? lastBeat.text : '', instructionBeatId: lastBeat?.role === 'instruction' ? lastBeat.id : null, parentId, regenerateId: o.regenerateId, direction: o.direction, heat: sess.explicit ? renderHeat(sess.heat) : null, auto } });
        };
        if (halted && final.refused) {
          await Promise.all(draftJobs);
          recordRefusal(true);
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
        await get().insertGenerated({ parentId, text: finalText.trim(), model: final.model, direction: o.direction, reasoning: final.reasoning, plan: plan.trim() || null, usage });
        // The passage is on the page; the footer now only tracks the extra drafts still writing.
        set((st) => (st.streaming ? { streaming: { ...st.streaming, text: '', reasoning: '' } } : {}));
        await Promise.all(draftJobs);
        const ran = attempts.filter((a) => !a.skipped);
        const okDrafts = get().drafts.filter((d) => d.done && !d.error && d.text.length > 40).length;
        if (okDrafts) set({ notice: `${okDrafts + 1} drafts written. Swipe the passage's arrows to compare; the others stay one swipe away.` });
        if (guarded.trimmed) set({ notice: 'Cut a tail where the prose broke down into a run-on. If this keeps happening, set the style card\'s repetition control to Off; sampler penalties can starve a long passage of articles and punctuation.' });
        else if (final.refused) {
          recordRefusal(false);
          set({ notice: `Every step of the refusal chain came back as a refusal (${ran.length} attempts). Kept the last one so you can judge; the clinic can work out why.` });
        }
        else if (ran.length > 1) set({ notice: `Pushed through on attempt ${ran.length}${final.step ? ` via ${final.step.kind}` : ''}${final.model !== model ? ` on ${final.model.split('/').pop()}` : ''}.` });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null, drafts: [] });
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

    async illustrate(beatId) {
      const { db, session, index, bundle } = get();
      const { apiKey, defaults } = useSettings.getState();
      if (!db || !session || get().streaming) return;
      if (!apiKey) {
        set({ error: 'Add your OpenRouter key in Settings first.' });
        return;
      }
      if (!defaults.imageModel) {
        set({ error: 'Pick an image model in Settings first.' });
        return;
      }
      const beat = index.byId.get(beatId);
      if (!beat) return;
      const abort = new AbortController();
      set({ abort, error: null, streaming: { text: '', reasoning: '', attempt: 0, step: null, model: session.models.helper, phase: 'illustrating', startedAt: now(), parentId: beat.parentId } });
      try {
        await runInForeground('Illustrating the passage', async () => {
          let prompt = '';
          for await (const ev of client.stream({ apiKey, model: session.models.helper, messages: imagePromptPrompt({ passage: beat.text, characters: bundle.characters, universe: bundle.universe, style: bundle.style, brief: session.brief }), params: { temperature: 0.7, topP: 0.95, maxTokens: 300, reasoning: false }, zdr: session.zdr, signal: abort.signal })) {
            if (ev.type === 'text') {
              prompt += ev.text ?? '';
              set((st) => (st.streaming ? { streaming: { ...st.streaming, text: prompt } } : {}));
            }
            if (ev.type === 'error') throw new Error(ev.error);
          }
          prompt = prompt.trim();
          if (!prompt) throw new Error('The helper produced no image prompt.');
          set((st) => (st.streaming ? { streaming: { ...st.streaming, model: defaults.imageModel } } : {}));
          const img = await client.generateImage({ apiKey, model: defaults.imageModel, prompt, zdr: session.zdr, signal: abort.signal });
          const id = newId();
          const uri = await saveImage(id, img.dataUrl);
          const ill = { id, sessionId: session.id, beatId, prompt, uri, model: img.model, createdAt: now() };
          await saveIllustration(db, ill);
          set({ illustrations: [...get().illustrations, ill] });
        });
      } catch (e) {
        if (!abort.signal.aborted) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ streaming: null, abort: null });
      }
    },
    clearRefusal: () => set({ refusal: null }),
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
