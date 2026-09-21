import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ModelInfo, ModelSlots } from '@/core/types';
import { kvGet, kvSet } from '@/db/repo/library';
import { loadApiKey, saveApiKey } from './secrets';

export interface Defaults {
  models: ModelSlots;
  zdr: boolean;
  fontSize: number;
  presetId: string | null;
  styleId: string | null;
}

const DEFAULTS: Defaults = {
  models: { writer: 'anthropic/claude-sonnet-4', summarizer: 'google/gemini-2.5-flash', helper: 'google/gemini-2.5-flash' },
  zdr: false,
  fontSize: 17,
  presetId: null,
  styleId: null,
};

interface SettingsState {
  ready: boolean;
  apiKey: string;
  defaults: Defaults;
  models: ModelInfo[];
  modelsFetchedAt: number | null;
  zdrIds: string[];
  load(db: SQLiteDatabase): Promise<void>;
  setApiKey(db: SQLiteDatabase, key: string): Promise<void>;
  setDefaults(db: SQLiteDatabase, patch: Partial<Defaults>): Promise<void>;
  setModels(db: SQLiteDatabase, models: ModelInfo[], zdrIds: string[]): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  apiKey: '',
  defaults: DEFAULTS,
  models: [],
  modelsFetchedAt: null,
  zdrIds: [],
  async load(db) {
    const [apiKey, d, m, z, at] = await Promise.all([loadApiKey(), kvGet(db, 'defaults'), kvGet(db, 'models'), kvGet(db, 'zdrIds'), kvGet(db, 'modelsFetchedAt')]);
    let defaults = DEFAULTS;
    try {
      if (d) defaults = { ...DEFAULTS, ...(JSON.parse(d) as Partial<Defaults>), models: { ...DEFAULTS.models, ...((JSON.parse(d) as Partial<Defaults>).models ?? {}) } };
    } catch {}
    let models: ModelInfo[] = [];
    let zdrIds: string[] = [];
    try {
      if (m) models = JSON.parse(m) as ModelInfo[];
      if (z) zdrIds = JSON.parse(z) as string[];
    } catch {}
    set({ ready: true, apiKey, defaults, models, zdrIds, modelsFetchedAt: at ? Number(at) : null });
  },
  async setApiKey(db, key) {
    await saveApiKey(key.trim());
    set({ apiKey: key.trim() });
    void db;
  },
  async setDefaults(db, patch) {
    const defaults = { ...get().defaults, ...patch, models: { ...get().defaults.models, ...(patch.models ?? {}) } };
    await kvSet(db, 'defaults', JSON.stringify(defaults));
    set({ defaults });
  },
  async setModels(db, models, zdrIds) {
    const at = Date.now();
    await Promise.all([kvSet(db, 'models', JSON.stringify(models)), kvSet(db, 'zdrIds', JSON.stringify(zdrIds)), kvSet(db, 'modelsFetchedAt', String(at))]);
    set({ models, zdrIds, modelsFetchedAt: at });
  },
}));

export function modelPrivacy(id: string, zdrIds: string[]): ModelInfo['privacy'] {
  return zdrIds.includes(id) ? 'zdr' : 'no-collection';
}
