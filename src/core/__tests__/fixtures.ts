import type { Beat, Session, Preset, Style, Character, LoreEntry } from '../types';
import { DEFAULT_PARAMS, DEFAULT_STRATEGY } from '../types';

export function beat(p: Partial<Beat> & { id: string; parentId: string | null; text: string }): Beat {
  return { sessionId: 's1', role: 'prose', model: null, direction: null, reasoning: null, plan: null, promptTokens: null, completionTokens: null, costUsd: null, createdAt: Number(p.id.replace(/\D/g, '')) || 0, ...p };
}

export function session(p: Partial<Session> = {}): Session {
  return {
    id: 's1', title: 'T', universeId: null, styleId: null, presetId: null, characterIds: [],
    models: { writer: 'm/writer', summarizer: 'm/sum', helper: 'm/help' },
    params: DEFAULT_PARAMS, strategy: DEFAULT_STRATEGY, zdr: false, explicit: false, heat: 2,
    currentBeatId: null, summary: '', summaryUpToBeatId: null, variantOf: null, variantNote: '', isTemplate: false, brief: '', planFirst: true, createdAt: 0, updatedAt: 0, ...p,
  };
}

export function preset(p: Partial<Preset> = {}): Preset {
  return { id: 'p1', name: 'P', system: 'SYS', prefill: '', postHistory: '', modelOverrides: {}, refusalChain: [], systemAsUser: false, providerIgnore: [], providerOrder: [], createdAt: 0, updatedAt: 0, ...p };
}

export function style(p: Partial<Style> = {}): Style {
  return { id: 'st1', name: 'Terse', pointOfView: 'third close', tense: 'past', proseDensity: 'lean', dialogueRatio: 'high', register: 'blunt', vocabulary: '', influences: '', repetition: 'light', bannedPhrases: ['tapestry'], samples: [], createdAt: 0, updatedAt: 0, ...p };
}

export function character(p: Partial<Character> = {}): Character {
  return { id: 'c1', universeId: null, speciesId: null, name: 'Mara', lifeStage: '30s', adult: true, summary: 'A smuggler.', voice: 'clipped', tells: '', relationships: '', limits: '', preferences: '', createdAt: 0, updatedAt: 0, ...p };
}

export function lore(p: Partial<LoreEntry> & { id: string }): LoreEntry {
  return { universeId: 'u1', title: p.id, keys: [], text: 'lore ' + p.id, alwaysOn: false, priority: 0, ...p };
}
