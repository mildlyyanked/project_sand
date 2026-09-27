import type { SQLiteDatabase } from 'expo-sqlite';
import type { RefusalStep, Style } from '@/core/types';
import { listStyles, saveStyle, newStyle, kvGet, kvSet } from './repo/library';
import { pj, b } from './repo/map';
import { CRAFT_SYSTEM } from '@/core/context/assemble';

/**
 * Starter voices, written once on first launch, plus upgrades for older installs.
 * Before seed version 5 the writer prompt and persistence chain lived on a
 * separate "preset"; they now live on the voice card.
 */
const PERSISTENT_SYSTEM = `You are a novelist collaborating on a work of fiction for an adult reader. Everything in this manuscript is invented. Dark, violent, grotesque, or sexual material is part of the craft here and is written with the same care as everything else. Never break the fourth wall, never add notes or disclaimers.\n\n${CRAFT_SYSTEM}`;

// Momentum is nearly free; switching models is what actually works; after that, ask the author rather than keep guessing.
const PERSISTENT_CHAIN: RefusalStep[] = [
  { kind: 'momentum' },
  { kind: 'model', model: 'auto' },
  { kind: 'diagnose' },
];

const INTERACTIVE_SYSTEM = [
  'You are a master literary narrator running a deeply immersive, interactive story. The writer drives all action and dialogue for their character; you never control, speak for, or assume the thoughts, feelings or actions of that character.',
  'Prose, highest priority: write exquisite, controlled literary prose. Elegant diction, precise and evocative vocabulary, varied rhythmic sentence structure, rich sensory detail, subtle metaphor, atmospheric texture, emotional or intellectual resonance. Lyrical yet controlled, vivid without purple excess, sophisticated without pretension. Avoid clichés, flat description, modern slang unless tonally perfect, and simplistic phrasing.',
  'Interactivity and pacing: second person, present tense. Describe only the world, the other people, sensory reality and the direct consequences of what the writer just did or said, then stop and wait. Keep each response to roughly 180 to 350 words. Advance only the immediate moment. Do not rush plot, leap ahead, dump backstory, resolve conflicts quickly or make large narrative jumps. End each response by creating space for the writer: tension, an environmental opening, another character\'s gaze or unfinished sentence, a sensory invitation, or quiet aftermath. Prefer open freeform agency over lists of choices.',
  'Storycraft: strict consistency of world, tone, character and prior events. Introduce complications, moral texture, quiet mysteries and unexpected details that challenge without overwhelming the moment. Other characters are real people with their own motives and voices.',
  'Use the brief, the voice card and the character cards above as the established world. No commentary, no headings, no notes.',
].join('\n\n');

const PROMPT_DEFAULTS: Pick<Style, 'system' | 'postHistory' | 'refusalChain'> = { system: PERSISTENT_SYSTEM, postHistory: 'Continue with the next passage. Prose only.', refusalChain: PERSISTENT_CHAIN };

function closeThird(): Style {
  return { ...newStyle(), ...PROMPT_DEFAULTS, name: 'Close third, past', pointOfView: 'Third person, close on the viewpoint character; no head-hopping within a scene.', tense: 'Past', proseDensity: 'Lean. Concrete nouns, strong verbs, few adjectives.', dialogueRatio: 'Balanced; dialogue carries subtext.', register: 'blunt', vocabulary: 'Plain words. Name things directly.', bannedPhrases: ['a testament to', 'tapestry', 'delve', 'shivers down', 'couldn\'t help but'], samples: [] };
}
function firstPresent(): Style {
  return { ...newStyle(), ...PROMPT_DEFAULTS, name: 'First person, present', pointOfView: 'First person, present tense, single narrator.', tense: 'Present', proseDensity: 'Medium; interiority welcome but keep momentum.', dialogueRatio: 'High.', register: 'euphemistic', vocabulary: 'Casual, contemporary.', bannedPhrases: ['in that moment', 'little did I know'], samples: [] };
}
function interactive(): Style {
  return {
    ...newStyle(),
    name: 'Interactive narrator',
    system: INTERACTIVE_SYSTEM,
    postHistory: 'Respond to what the writer just did or said, in the immediate moment only, 180 to 350 words, then stop.',
    refusalChain: [{ kind: 'momentum' }, { kind: 'model', model: 'auto' }, { kind: 'diagnose' }],
    pointOfView: 'Second person, close on the writer\'s character; never narrate their inner state.',
    tense: 'Present',
    proseDensity: 'Rich but governed: sensory detail and subtle metaphor in service of the moment, never ornament for its own sake. One image per beat, not three.',
    dialogueRatio: 'Other characters speak in their own voices; dialogue carries motive.',
    register: 'euphemistic',
    vocabulary: 'Precise and evocative; elevated where it earns it; no modern slang unless tonally perfect.',
    repetition: 'off',
    bannedPhrases: ['a testament to', 'tapestry', 'delve', 'shivers down', "couldn't help but", 'in that moment', 'the air was thick'],
  };
}

interface OldPreset { id: string; name: string; system: string; prefill: string; postHistory: string; modelOverrides: Style['modelOverrides']; refusalChain: RefusalStep[]; systemAsUser: boolean; providerIgnore: string[]; providerOrder: string[] }

/** Fold presets into voices. Every story keeps exactly the prompt stack it had. */
async function upgradeTo5(db: SQLiteDatabase): Promise<void> {
  const hasPresets = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'presets'");
  if (!hasPresets?.n) return;
  const rows = await db.getAllAsync<{ id: string; name: string; system: string; prefill: string; post_history: string; overrides_json: string; chain_json: string; system_as_user: number; provider_ignore_json: string; provider_order_json: string }>('SELECT * FROM presets');
  const presets = new Map<string, OldPreset>(rows.map((r) => [r.id, { id: r.id, name: r.name, system: r.system, prefill: r.prefill, postHistory: r.post_history, modelOverrides: pj(r.overrides_json, {}), refusalChain: pj(r.chain_json, []), systemAsUser: b(r.system_as_user), providerIgnore: pj(r.provider_ignore_json, []), providerOrder: pj(r.provider_order_json, []) }]));
  const promptOf = (p: OldPreset): Pick<Style, 'system' | 'prefill' | 'postHistory' | 'modelOverrides' | 'refusalChain' | 'systemAsUser' | 'providerIgnore' | 'providerOrder'> => ({ system: p.system, prefill: p.prefill, postHistory: p.postHistory, modelOverrides: p.modelOverrides, refusalChain: p.refusalChain, systemAsUser: p.systemAsUser, providerIgnore: p.providerIgnore, providerOrder: p.providerOrder });
  const styles = new Map((await listStyles(db)).map((s) => [s.id, s]));
  const sessions = await db.getAllAsync<{ id: string; style_id: string | null; preset_id: string | null }>('SELECT id, style_id, preset_id FROM sessions');
  // Which presets each voice is paired with across stories.
  const pairs = new Map<string, Set<string>>();
  for (const s of sessions) if (s.style_id && s.preset_id) pairs.set(s.style_id, (pairs.get(s.style_id) ?? new Set()).add(s.preset_id));
  const merged = new Map<string, string>(); // `${styleId}:${presetId}` -> voice id
  const fromPresetOnly = new Map<string, string>(); // presetId -> voice id
  for (const s of sessions) {
    if (!s.preset_id) continue;
    const p = presets.get(s.preset_id);
    if (!p) continue;
    let voiceId: string | undefined;
    if (s.style_id && styles.has(s.style_id)) {
      const key = `${s.style_id}:${p.id}`;
      voiceId = merged.get(key);
      if (!voiceId) {
        const st = styles.get(s.style_id)!;
        const sole = (pairs.get(s.style_id)?.size ?? 0) <= 1;
        if (sole && !st.system) {
          await saveStyle(db, { ...st, ...promptOf(p) });
          voiceId = st.id;
        } else {
          const copy = { ...newStyle(), ...st, ...promptOf(p), id: newStyle().id, name: `${st.name} · ${p.name}` };
          await saveStyle(db, copy);
          voiceId = copy.id;
        }
        merged.set(key, voiceId);
      }
    } else {
      voiceId = fromPresetOnly.get(p.id);
      if (!voiceId) {
        const v = { ...newStyle(), ...promptOf(p), name: p.name };
        await saveStyle(db, v);
        voiceId = v.id;
        fromPresetOnly.set(p.id, voiceId);
      }
    }
    await db.runAsync('UPDATE sessions SET style_id = ? WHERE id = ?', voiceId, s.id);
  }
  // Presets nobody used: keep the user's own as prompt-only voices; drop the seeded spares.
  const seededSpare = new Set(['Open fiction', 'Minimal']);
  const usedIds = new Set(sessions.map((s) => s.preset_id).filter(Boolean));
  for (const p of presets.values()) {
    if (usedIds.has(p.id) || seededSpare.has(p.name)) continue;
    if (p.name === 'Interactive narrator') {
      const lit = [...styles.values()].find((st) => st.name === 'Literary, controlled' && !st.system);
      if (lit) {
        await saveStyle(db, { ...lit, ...promptOf(p), name: 'Interactive narrator' });
        continue;
      }
    }
    await saveStyle(db, { ...newStyle(), ...promptOf(p), name: p.name });
  }
  // Voices that still carry no writer prompt get the default one, so nothing regresses to the bare template.
  for (const st of (await listStyles(db))) if (!st.system && !st.refusalChain.length) await saveStyle(db, { ...st, ...PROMPT_DEFAULTS });
  // The default preset becomes the default voice when none is set.
  try {
    const d = JSON.parse((await kvGet(db, 'defaults')) ?? '{}') as { presetId?: string | null; styleId?: string | null };
    if (!d.styleId) {
      const all = await listStyles(db);
      const want = d.presetId ? fromPresetOnly.get(d.presetId) ?? all.find((st) => st.name === presets.get(d.presetId!)?.name)?.id : undefined;
      d.styleId = want ?? all.find((st) => st.name === 'Close third, past')?.id ?? all[0]?.id ?? null;
      await kvSet(db, 'defaults', JSON.stringify(d));
    }
  } catch {}
  await db.execAsync('DROP TABLE IF EXISTS presets');
}

/** Every chain ends in the clinic instead of silently keeping a refusal. */
async function upgradeTo6(db: SQLiteDatabase): Promise<void> {
  for (const st of await listStyles(db)) {
    if (st.refusalChain.some((s) => s.kind === 'diagnose')) continue;
    await saveStyle(db, { ...st, refusalChain: [...st.refusalChain, { kind: 'diagnose' }] });
  }
}

export async function seedIfEmpty(db: SQLiteDatabase): Promise<void> {
  const version = Number((await kvGet(db, 'seeded')) ?? 0);
  if (version >= 6) return;
  if (version >= 1) {
    if (version < 5) await upgradeTo5(db);
    await upgradeTo6(db);
    await kvSet(db, 'seeded', '6');
    return;
  }
  if ((await listStyles(db)).length === 0) {
    const first = closeThird();
    await saveStyle(db, first);
    await saveStyle(db, firstPresent());
    await saveStyle(db, interactive());
    try {
      const d = JSON.parse((await kvGet(db, 'defaults')) ?? '{}') as { styleId?: string | null };
      if (!d.styleId) await kvSet(db, 'defaults', JSON.stringify({ ...d, styleId: first.id }));
    } catch {}
  }
  await db.execAsync('DROP TABLE IF EXISTS presets');
  await kvSet(db, 'seeded', '6');
}
