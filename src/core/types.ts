// Domain types. This file must stay free of React Native imports.

export type Id = string;

export type BeatRole = 'prose' | 'instruction' | 'note';

export interface Beat {
  id: Id;
  sessionId: Id;
  parentId: Id | null;
  role: BeatRole;
  text: string;
  /** Model that produced the text, null for user-written beats. */
  model: string | null;
  /** Free-text regenerate direction that produced this beat, if any. */
  direction: string | null;
  reasoning: string | null;
  /** The plan the passage was written from, when planning was on. */
  plan: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  createdAt: number;
}

export interface Species {
  id: Id;
  universeId: Id;
  name: string;
  /** How adulthood is defined for this species, in the world's own terms. */
  adulthood: string;
  notes: string;
}

export interface Universe {
  id: Id;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoreEntry {
  id: Id;
  universeId: Id;
  title: string;
  /** Trigger keywords, lower-cased. */
  keys: string[];
  text: string;
  alwaysOn: boolean;
  priority: number;
}

export interface CanonEvent {
  id: Id;
  universeId: Id;
  sessionId: Id | null;
  title: string;
  text: string;
  order: number;
  createdAt: number;
}

export interface Character {
  id: Id;
  universeId: Id | null;
  speciesId: Id | null;
  name: string;
  /** Free text: "34", "third instar", "ancient". */
  lifeStage: string;
  /** Structural gate for explicit sessions. Never injected into prompts. */
  adult: boolean;
  summary: string;
  voice: string;
  tells: string;
  relationships: string;
  limits: string;
  preferences: string;
  createdAt: number;
  updatedAt: number;
}

export type Register = 'clinical' | 'euphemistic' | 'blunt';
export type RepetitionLevel = 'off' | 'light' | 'medium' | 'strong';

export interface Style {
  id: Id;
  name: string;
  pointOfView: string;
  tense: string;
  proseDensity: string;
  dialogueRatio: string;
  register: Register;
  vocabulary: string;
  /** Writers whose voice this style draws on, free text. */
  influences: string;
  /** Sampler-level anti-repetition. Applied as penalties, never as prompt text. */
  repetition: RepetitionLevel;
  bannedPhrases: string[];
  samples: string[];
  createdAt: number;
  updatedAt: number;
}

export type RefusalStep =
  /** Prepend stronger framing to the system prompt. */
  | { kind: 'reframe'; text: string }
  /** Start the reply with this text. */
  | { kind: 'prefill'; text: string }
  /** Retry on another model. 'auto' picks the best-behaved model from the ledger. */
  | { kind: 'model'; model: string }
  /** Prefill with the tail of the manuscript so the model is mid-sentence, not deciding. */
  | { kind: 'momentum' }
  /** Have the helper rewrite the latest instruction as an in-world author's note. */
  | { kind: 'soften' }
  /** Write the lead-in first with a short budget, then continue from inside the scene. */
  | { kind: 'twostep' }
  /** Nudge temperature and top-p up; some refusals are a sampling rut. */
  | { kind: 'heat' };

export const STEP_INFO: Record<RefusalStep['kind'], { label: string; hint: string }> = {
  momentum: { label: 'Momentum', hint: 'Prefills the reply with the last sentence of the manuscript so the model continues mid-flow instead of judging a request.' },
  soften: { label: 'Soften', hint: 'The helper rewrites your latest instruction as a quiet author\'s note in the story\'s own register. Same content, no imperative.' },
  twostep: { label: 'Two-step', hint: 'Writes only the approach first with a small budget, then continues from inside the scene where refusing would break the passage.' },
  heat: { label: 'Heat', hint: 'Raises temperature and top-p for the retry. Cheap, and sometimes all it takes.' },
  reframe: { label: 'Reframe', hint: 'Prepends your text to the system prompt for the retry.' },
  prefill: { label: 'Prefill', hint: 'Forces the reply to begin with your text.' },
  model: { label: 'Model', hint: 'Retries on another model. Auto picks the model with the best record in the refusal ledger.' },
};

export interface Preset {
  id: Id;
  name: string;
  system: string;
  prefill: string;
  postHistory: string;
  /** Per-model overrides keyed by model id (or prefix ending in '*'). */
  modelOverrides: Record<string, Partial<Pick<Preset, 'system' | 'prefill' | 'postHistory'>>>;
  refusalChain: RefusalStep[];
  /** Send the system prompt as the first user turn; helps on providers that ignore system. */
  systemAsUser: boolean;
  /** OpenRouter provider slugs to never route to (e.g. ones that add their own moderation). */
  providerIgnore: string[];
  /** Preferred provider order. */
  providerOrder: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ContextStrategy {
  /** Token budget for verbatim recent beats. */
  recentBudget: number;
  /** Token budget for the rolling summary. */
  summaryBudget: number;
  /** How many recent beats to scan for lore keyword hits. */
  loreScanBeats: number;
  /** Token budget for triggered lore. */
  loreBudget: number;
  /** Re-summarize when un-summarized tokens exceed this. */
  summarizeThreshold: number;
}

export interface ModelSlots {
  writer: string;
  summarizer: string;
  helper: string;
}

export interface GenerationParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoning: boolean;
  /** Optional sampler penalties. When unset, the style card's repetition level decides. */
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
}

export interface Session {
  id: Id;
  title: string;
  universeId: Id | null;
  styleId: Id | null;
  presetId: Id | null;
  characterIds: Id[];
  models: ModelSlots;
  params: GenerationParams;
  strategy: ContextStrategy;
  zdr: boolean;
  explicit: boolean;
  /** 0 = fade to black, 4 = fully explicit. */
  heat: number;
  currentBeatId: Id | null;
  /** Rolling summary of beats up to summaryUpToBeatId, along the current path. */
  summary: string;
  summaryUpToBeatId: Id | null;
  /** Session this one was forked from, plus the note describing the variant. */
  variantOf: Id | null;
  variantNote: string;
  isTemplate: boolean;
  /** The premise, ideas, people and limits, sent to the writer every time. */
  brief: string;
  /** Ask the helper for a short plan before each passage. */
  planFirst: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ContextLayer {
  key: string;
  label: string;
  role: ChatMessage['role'];
  text: string;
  tokens: number;
  /** True when the layer was present but dropped by budget. */
  dropped?: boolean;
  detail?: string;
}

export interface AssembledContext {
  layers: ContextLayer[];
  messages: ChatMessage[];
  totalTokens: number;
  log: string[];
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

export interface ModelStat {
  model: string;
  attempts: number;
  refusals: number;
  lastAt: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  promptPricePerM: number;
  completionPricePerM: number;
  supportsReasoning: boolean;
  /** Derived from OpenRouter metadata when available. */
  privacy: 'zdr' | 'no-collection' | 'unknown';
}

export const DEFAULT_STRATEGY: ContextStrategy = {
  recentBudget: 6000,
  summaryBudget: 1500,
  loreScanBeats: 6,
  loreBudget: 1200,
  summarizeThreshold: 9000,
};

export const DEFAULT_PARAMS: GenerationParams = {
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 1400,
  reasoning: false,
};

export const HEAT_LABELS = ['Fade to black', 'Slow burn', 'Suggestive', 'Explicit', 'Unrestrained'] as const;
