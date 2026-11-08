import type { ChatMessage, Id } from './types';
import type { Draft, LibKind } from './world/drafts';
import { normName } from './world/drafts';
import type { ForgeKind } from './world/forge';
import { ensureAnchor, parseBible, parseFieldValue, parseForgeDrafts, parseInspired } from './world/forge';
import type { InspireAspect } from './world/types';
import { parseVoiceBuild, type VoiceBuild } from './voice';
import type { ArtBible, FieldDef } from './world/schema';
import { buildMap, type BuildChild } from './map/build';
import { parseMapPlan } from './map/plan';
import type { MapDoc, MapKind, MapPin, ThemeKey } from './map/types';

/**
 * Library work that runs in the background: forging entries, reforging a
 * field, writing a style bible, the world agent's replies and its question
 * of the day. A job is written down before it runs and its result is kept
 * until someone decides on it, so closing a sheet, leaving a screen or
 * restarting the app loses nothing: the result waits in the world's inbox.
 * Everything here is pure; the runner lives in state/jobs.ts.
 */
export type JobKind = 'forge' | 'reforge' | 'bible' | 'workshop' | 'question' | 'inspire' | 'voice' | 'hear' | 'map';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ForgeInput {
  kind: ForgeKind;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  inspiredBy?: string;
  anchor?: { kind: LibKind; name: string } | null;
  canon?: string | null;
  /** Names already in the world, as kind:name: never offered twice. */
  taken: string[];
}
export interface ForgeOutput { drafts: Draft[]; truncated: boolean }

export interface ReforgeInput { model: string; messages: ChatMessage[]; draft: Draft; key: string; def: FieldDef; options: string[]; maxTokens: number }
export interface ReforgeOutput { value: unknown }

export interface BibleInput { model: string; messages: ChatMessage[]; only?: keyof ArtBible; maxTokens?: number }
export interface BibleOutput { bible: Partial<ArtBible> }

export interface WorkshopInput { model: string; messages: ChatMessage[]; maxTokens?: number; /** The thread message this reply answers. */ replyTo: Id; focus?: { kind: LibKind; id: string; name: string } | null; taken: string[] }
export interface WorkshopOutput { reply: string; drafts: Draft[]; brief: string | null }

export interface InspireInput { model: string; messages: ChatMessage[]; draft: Draft; who: string; aspects: InspireAspect[]; maxTokens?: number }

/** Build a voice from who it writes like. */
export interface VoiceInput { model: string; messages: ChatMessage[]; styleId: string; maxTokens?: number }
/** A test passage in a voice, on a fixed scene. */
export interface HearInput { model: string; messages: ChatMessage[]; styleId: string; scene: string; maxTokens?: number }
export interface HearOutput { text: string }

/** A map drawn for a place: the model plans it, the builder draws it. */
export interface MapInput { model: string; messages: ChatMessage[]; maxTokens?: number; locationId: string; mapKind: MapKind; theme: ThemeKey; title: string; children: BuildChild[]; seed: number; keepPins?: MapPin[] }
/** `saved`: the place had no map yet, so this one went straight onto it. */
export interface MapOutput { doc: MapDoc; saved: boolean }

export interface QuestionInput { model: string; messages: ChatMessage[]; date: string; maxTokens?: number }
export interface QuestionOutput { question: string; why: string; about: string }

export interface JobIO {
  forge: [ForgeInput, ForgeOutput];
  reforge: [ReforgeInput, ReforgeOutput];
  bible: [BibleInput, BibleOutput];
  workshop: [WorkshopInput, WorkshopOutput];
  question: [QuestionInput, QuestionOutput];
  inspire: [InspireInput, ForgeOutput];
  voice: [VoiceInput, VoiceBuild];
  hear: [HearInput, HearOutput];
  map: [MapInput, MapOutput];
}

export interface Job<K extends JobKind = JobKind> {
  id: Id;
  universeId: Id | null;
  kind: K;
  title: string;
  status: JobStatus;
  input: JobIO[K][0];
  output: JobIO[K][1] | null;
  /** What the person decided on each proposal: accepted, edited then accepted, or dismissed. Keyed by draft id; 'all' for single-result jobs. */
  decisions: Record<string, 'accepted' | 'dismissed'>;
  error: string | null;
  attempts: number;
  /** Characters received so far while running. */
  progress: number;
  createdAt: number;
  updatedAt: number;
}

/** The proposals a job holds: drafts, a field value, a bible. Workshop replies keep their drafts in the thread too. */
export function proposalCount(j: Job): number {
  if (j.status !== 'done' || !j.output) return 0;
  const left = (ids: string[]) => ids.filter((id) => !j.decisions[id]).length;
  switch (j.kind) {
    case 'forge':
    case 'inspire': return left((j.output as ForgeOutput).drafts.map((d) => d.id));
    case 'workshop': return left((j.output as WorkshopOutput).drafts.map((d) => d.id));
    case 'reforge':
    case 'bible':
    case 'voice': return j.decisions.all ? 0 : 1;
    case 'map': return j.decisions.all || (j.output as MapOutput).saved ? 0 : 1;
    default: return 0;
  }
}

/** Waiting on the person: finished with something undecided. */
export const awaiting = (j: Job) => proposalCount(j) > 0;

const peekOf = (text: string) => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return { peek: flat.slice(0, 160), tail: flat.length > 320 ? ` It ended: “…${flat.slice(-120)}”` : '' };
};

/** A forge reply as proposals: parsed, tied to the anchor, nothing the world already has. Throws with a readable reason. */
export function finishForge(input: ForgeInput, text: string, finish?: string): ForgeOutput {
  let r = parseForgeDrafts(input.kind, text, { inspiredBy: input.inspiredBy });
  if (!r) {
    const { peek, tail } = peekOf(text);
    if (finish === 'length') throw new Error(`The reply was still unfinished after it was continued three times, and nothing in it was complete. Ask for fewer at a time, or try another model. It began: “${peek}…”`);
    throw new Error(peek ? `The model did not answer with the expected JSON. It began: “${peek}…”${tail} Try again, a clearer wish, or another model.` : 'The model returned nothing. Try again or another model.');
  }
  r = ensureAnchor(r, input.anchor ?? null);
  if (input.canon) r = r.map((d, i) => (i === 0 ? { ...d, name: input.canon! } : d));
  const taken = new Set(input.taken);
  r = r.filter((d) => !taken.has(`${d.kind}:${normName(d.name)}`));
  if (!r.length) throw new Error('Everything the model offered already exists in this world. Try again or a different wish.');
  return { drafts: r, truncated: finish === 'length' };
}

export function finishReforge(input: ReforgeInput, text: string): ReforgeOutput {
  const v = parseFieldValue(input.def, text, input.options);
  if (v === null) throw new Error(`The answer did not fit the field: “${text.trim().slice(0, 140)}”. Try again or say more in the instruction.`);
  return { value: v };
}

export function finishBible(input: BibleInput, text: string): BibleOutput {
  const b = parseBible(text, input.only);
  if (!b) throw new Error(`The helper did not write a usable style bible: “${text.trim().slice(0, 140)}”. Try again.`);
  return { bible: b };
}

/** An inspiration reply as one proposed change to the character: only the fields it rewrote. */
export function finishInspire(input: InspireInput, text: string): ForgeOutput {
  const f = parseInspired(text, input.aspects);
  if (!f) throw new Error(`The model did not write the character from ${input.who}: “${text.trim().slice(0, 140)}”. Try again.`);
  const d: Draft = { ...input.draft, existing: true, fields: { ...input.draft.fields, ...f, _changed: Object.keys(f) } };
  return { drafts: [d], truncated: false };
}

export function finishVoice(text: string): VoiceBuild {
  const v = parseVoiceBuild(text);
  if (!v) throw new Error(`The model did not write a usable voice: “${text.trim().slice(0, 140)}”. Try again, or another model.`);
  return v;
}

export function finishHear(text: string): HearOutput {
  if (!text.trim()) throw new Error('The writer wrote nothing. Try again.');
  return { text: text.trim() };
}

/** A map plan reply drawn into a map. Throws with a readable reason. */
export function finishMap(input: MapInput, universeId: string, text: string, now: number): MapDoc {
  const plan = parseMapPlan(text);
  if (!plan) throw new Error(`The model did not sketch a usable map: “${text.trim().slice(0, 140)}”. Try again, or another model.`);
  return buildMap(plan, { locationId: input.locationId, universeId, kind: input.mapKind, theme: input.theme, title: input.title, children: input.children, seed: input.seed, now, keepPins: input.keepPins });
}

/** A short title for the inbox: what was asked for, in a few words. */
export function jobTitle(kind: JobKind, what: string): string {
  const w = what.trim().replace(/\s+/g, ' ');
  return w.length > 70 ? `${w.slice(0, 68)}…` : w || kind;
}
