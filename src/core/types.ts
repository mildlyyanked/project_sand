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
  | { kind: 'reframe'; text: string }
  | { kind: 'prefill'; text: string }
  | { kind: 'model'; model: string };

export interface Preset {
  id: Id;
  name: string;
  system: string;
  prefill: string;
  postHistory: string;
  /** Per-model overrides keyed by model id (or prefix ending in '*'). */
  modelOverrides: Record<string, Partial<Pick<Preset, 'system' | 'prefill' | 'postHistory'>>>;
  refusalChain: RefusalStep[];
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
  temperature: 0.9,
  topP: 0.95,
  maxTokens: 1200,
  reasoning: false,
};

export const HEAT_LABELS = ['Fade to black', 'Slow burn', 'Suggestive', 'Explicit', 'Unrestrained'] as const;
