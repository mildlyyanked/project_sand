import type {
  AssembledContext,
  Beat,
  Character,
  ChatMessage,
  ContextLayer,
  ContextStrategy,
  LoreEntry,
  Session,
  Species,
  Style,
  Universe,
} from '../types';
import { estimateTokens, trimToTokens } from '../tokens';
import { alwaysOnLore, triggeredLore } from './lorebook';
import { renderCharacter, renderHeat, renderStyle } from './cards';
import { DEFAULT_TEMPLATES, type PromptTemplates } from '../prompts';
import type { CheckResult, SceneState, WorldEntity, WorldEvent, WorldInstance } from '../world/types';
import { locationChain, scanEntities, childrenOf } from '../world/scan';
import { renderCharacterWorld, renderEntity, renderSpecies, renderWorldTemplate, worldTemplateEmpty } from '../world/render';
import { renderContinuity, renderSiblings, selectContinuity, type SiblingStory } from '../world/continuity';
import { timeOfDay } from '../world/calendar';
import { renderPov } from '../world/survival';
import { renderCheck } from '../world/dice';

/** Everything the world adds to a request. Absent: the story is on its own (vanilla). */
export interface WorldContext {
  entities: WorldEntity[];
  instance: WorldInstance | null;
  /** Timeline events this story may know of: the whole instance with continuity on, only its own otherwise. */
  events: WorldEvent[];
  siblings: SiblingStory[];
  /** In-world time at the point the next passage starts. */
  now: number;
  scene: SceneState;
  /** POV mode: the character the player plays. */
  player: Character | null;
  /** POV mode: the referee's ruling on this turn's action. */
  check?: CheckResult | null;
  /** POV mode: thresholds crossed since the last passage ("Water is low: thirsty."). */
  survivalNotes?: string[];
}

export interface AssembleInput {
  session: Session;
  /** Root-to-current path. */
  path: Beat[];
  style: Style | null;
  characters: Character[];
  species: Species[];
  universe: Universe | null;
  lore: LoreEntry[];
  /** The model the request will go to; selects preset overrides. */
  model: string;
  /** Extra one-shot direction (regenerate with direction). */
  direction?: string;
  /** Pinned or dropped layer keys chosen in the inspector. */
  dropped?: Set<string>;
  /** A plan for this passage from the helper, sent as guidance. */
  plan?: string;
  templates?: PromptTemplates;
  world?: WorldContext;
}

export function resolvePreset(preset: Pick<Style, 'system' | 'prefill' | 'postHistory' | 'modelOverrides'> | null, model: string): Pick<Style, 'system' | 'prefill' | 'postHistory'> {
  if (!preset) return { system: '', prefill: '', postHistory: '' };
  let out = { system: preset.system, prefill: preset.prefill, postHistory: preset.postHistory };
  for (const [pattern, ov] of Object.entries(preset.modelOverrides ?? {})) {
    const hit = pattern.endsWith('*') ? model.startsWith(pattern.slice(0, -1)) : model === pattern;
    if (hit) out = { ...out, ...ov };
  }
  return out;
}

export const CRAFT_SYSTEM = DEFAULT_TEMPLATES.craft;
export const OPENING_DIRECTIVE = DEFAULT_TEMPLATES.opening;

/**
 * Split the path into: beats already covered by the summary, older beats not yet
 * summarized, and the verbatim recent window that fits the budget.
 */
export function splitPath(path: Beat[], session: Session, strategy: ContextStrategy) {
  const prose = path.filter((b) => b.role !== 'note');
  let start = 0;
  if (session.summaryUpToBeatId) {
    const i = prose.findIndex((b) => b.id === session.summaryUpToBeatId);
    if (i >= 0) start = i + 1;
  }
  const unsummarized = prose.slice(start);
  // Take from the end until the recent budget is spent.
  let used = 0;
  let cut = unsummarized.length;
  for (let i = unsummarized.length - 1; i >= 0; i--) {
    const t = estimateTokens(unsummarized[i]!.text);
    if (used + t > strategy.recentBudget && cut < unsummarized.length) break;
    used += t;
    cut = i;
    if (used > strategy.recentBudget) break;
  }
  const recent = unsummarized.slice(cut);
  const overflow = unsummarized.slice(0, cut);
  return { summarized: prose.slice(0, start), overflow, recent, recentTokens: used };
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const { session, path, style, characters, species, universe, lore, model } = input;
  const preset = style;
  const strategy = session.strategy;
  const dropped = input.dropped ?? new Set<string>();
  const log: string[] = [];
  const layers: ContextLayer[] = [];
  const p = resolvePreset(preset, model);
  const tpl = input.templates ?? DEFAULT_TEMPLATES;

  const push = (l: Omit<ContextLayer, 'tokens'>) => {
    const layer: ContextLayer = { ...l, tokens: estimateTokens(l.text), dropped: l.dropped || dropped.has(l.key) };
    layers.push(layer);
    return layer;
  };

  const world = input.world;
  const pov = session.mode === 'pov' && world?.player ? world.player : null;
  const entities = world?.entities ?? [];
  const names = new Map<string, string>();
  for (const e of entities) names.set(e.id, e.name);
  for (const c of characters) names.set(c.id, c.name);
  const refName = (id: string) => names.get(id);

  push({ key: 'system', label: 'System', role: 'system', text: p.system.trim() || tpl.craft });
  const styleText = style ? renderStyle(style) : '';
  if (style && styleText) push({ key: 'style', label: `Voice · ${style.name}`, role: 'system', text: styleText });
  if (characters.length) {
    const text = ['# Characters', ...characters.map((c) => renderCharacter(c, species.find((s) => s.id === c.speciesId), world ? renderCharacterWorld(c, refName) : [], pov?.id === c.id ? " (the player's character)" : ''))].join('\n\n');
    push({ key: 'characters', label: `Characters · ${characters.length}`, role: 'system', text });
  }
  if (session.brief.trim()) push({ key: 'brief', label: 'Brief', role: 'system', text: `# The story\n${session.brief.trim()}` });
  if (universe) {
    const always = alwaysOnLore(lore);
    // The seeded real world says nothing unless the writer gave it something to say.
    if (!(universe.isDefault && worldTemplateEmpty(universe) && !always.length)) {
      const text = universe.data ? renderWorldTemplate(universe, always) : [`# World: ${universe.name}`, universe.description.trim(), ...always.map((e) => `## ${e.title}\n${e.text}`)].filter(Boolean).join('\n\n');
      push({ key: 'universe', label: `World · ${universe.name}`, role: 'system', text, detail: always.length ? `${always.length} always-on entries` : undefined });
    }
  }

  const { summarized, overflow, recent, recentTokens } = splitPath(path, session, strategy);

  // The scene: where we are, and what of the world the recent passages bring up.
  const scanText = [...recent.slice(-strategy.loreScanBeats).map((b) => b.text), input.direction ?? '', world?.scene.locationName ?? ''].join('\n');
  const chain = world ? locationChain(world.scene.locationId, entities) : [];
  const here = chain[chain.length - 1];
  const focusIds = new Set<string>([...characters.map((c) => c.id), ...chain.map((c) => c.id)]);
  const focusNames = [...characters.map((c) => c.name), ...(here ? [here.name] : [])];
  if (world && (here || world.scene.locationName.trim())) {
    const lines: string[] = [];
    if (here) {
      lines.push(`# Where the scene is: ${chain.map((c) => c.name).join(' › ')}`, renderEntity(here, entities, refName, { play: !!pov }));
      const exits = [...childrenOf(here.id, entities), ...(here.parentId ? childrenOf(here.parentId, entities).filter((x) => x.id !== here.id) : [])].filter((x) => x.kind === 'location').slice(0, 12);
      if (exits.length) lines.push(`Nearby: ${exits.map((x) => x.name).join(', ')}.`);
    } else lines.push(`# Where the scene is: ${world.scene.locationName.trim()}`);
    push({ key: 'place', label: `Place · ${here?.name ?? world.scene.locationName}`, role: 'system', text: lines.join('\n\n') });
  }
  if (world && (entities.length || species.length)) {
    const chainIds = new Set(chain.map((c) => c.id));
    const scanned = scanEntities(entities.filter((e) => !chainIds.has(e.id)), scanText);
    const linked: WorldEntity[] = [];
    const link = (id: unknown) => { const e = typeof id === 'string' ? entities.find((x) => x.id === id) : undefined; if (e && !chainIds.has(e.id) && !scanned.includes(e) && !linked.includes(e)) linked.push(e); };
    if (here) link(here.data.controlledBy);
    for (const c of characters) { link(c.data.homeLocationId); for (const m of c.data.memberships ?? []) link(m.orgId); }
    const peoples = scanEntities(species.map((s) => ({ ...s, keys: [] as string[] })), scanText);
    const blocks: { text: string; name: string }[] = [];
    for (const e of [...scanned, ...linked]) blocks.push({ name: e.name, text: renderEntity(e, entities, refName, { play: !!pov }) });
    for (const s of peoples) blocks.push({ name: s.name, text: renderSpecies(s as Species, refName) });
    let budget = strategy.worldBudget ?? 1400;
    const kept = blocks.filter((b) => { const t = estimateTokens(b.text); if (t > budget) return false; budget -= t; return true; });
    for (const e of scanned) focusIds.add(e.id);
    focusNames.push(...scanned.map((e) => e.name));
    if (kept.length) {
      log.push(`world: ${blocks.length} elements in scene, ${kept.length} kept`);
      push({ key: 'elements', label: `World · ${kept.length} in scene`, role: 'system', text: `# In this scene\n\n${kept.map((b) => b.text).join('\n\n')}`, detail: kept.map((b) => b.name).join(', ') });
    }
  }
  log.push(`recent window: ${recent.length} beats, ~${recentTokens} tokens (budget ${strategy.recentBudget})`);

  if (lore.length) {
    const scan = recent.slice(-strategy.loreScanBeats).map((b) => b.text).join('\n');
    const hits = triggeredLore(lore, scan);
    if (hits.length) {
      let budget = strategy.loreBudget;
      const kept: LoreEntry[] = [];
      for (const h of hits) {
        const t = estimateTokens(h.text);
        if (t > budget) continue;
        budget -= t;
        kept.push(h);
      }
      log.push(`lore: ${hits.length} triggered, ${kept.length} kept (${hits.map((h) => h.title).join(', ')})`);
      if (kept.length) push({ key: 'lore', label: `Lore · ${kept.length} triggered`, role: 'system', text: kept.map((e) => `## ${e.title}\n${e.text}`).join('\n\n'), detail: kept.map((k) => k.title).join(', ') });
    } else log.push('lore: no keyword hits');
  }

  if (world && (session.world?.continuity || session.world?.chronicle)) {
    const c = selectContinuity(world.events, world.now, { ids: focusIds, names: focusNames }, strategy.continuityBudget ?? 1600);
    const cal = universe?.data?.calendar;
    const text = renderContinuity(c, { now: world.now, calendar: cal, instanceName: world.instance && !world.instance.isPrime ? world.instance.name : undefined, timeOfDay: timeOfDay(cal, world.now) });
    push({ key: 'continuity', label: `Continuity · ${c.past.length} past${c.future.length ? `, ${c.future.length} later` : ''}`, role: 'system', text, detail: c.states.length ? c.states.map((s) => s.name).join(', ') : undefined });
    if (session.world?.continuity && world.siblings.length) {
      const sibText = renderSiblings(world.siblings, Math.round((strategy.continuityBudget ?? 1600) * 0.6), cal, world.now);
      if (sibText) push({ key: 'stories', label: `Other stories · ${world.siblings.length}`, role: 'system', text: sibText });
    }
  }
  if (session.summary.trim()) {
    push({ key: 'summary', label: `Summary · ${summarized.length} beats`, role: 'system', text: `# Story so far\n${trimToTokens(session.summary, strategy.summaryBudget)}` });
  }
  if (pov && world?.scene.pov) {
    push({ key: 'pov', label: `Player · ${pov.name}`, role: 'system', text: renderPov(world.scene.pov, { name: pov.name, currency: universe?.data?.currency ?? '', difficulty: session.pov?.difficulty ?? 'survival' }) });
  }
  if (overflow.length) {
    const t = overflow.reduce((n, b) => n + estimateTokens(b.text), 0);
    log.push(`${overflow.length} beats (~${t} tokens) exceed the recent budget and are not yet summarized`);
    push({ key: 'overflow', label: `Unsummarized · ${overflow.length} beats`, role: 'system', text: overflow.map((b) => b.text).join('\n\n'), dropped: true, detail: 'dropped: over budget, needs summarizing' });
  }

  // Recent beats: prose becomes assistant turns, instructions become user turns.
  const recentLayers: ContextLayer[] = [];
  for (const b of recent) {
    recentLayers.push(push({ key: `beat:${b.id}`, label: b.role === 'prose' ? 'Prose' : 'Instruction', role: b.role === 'prose' ? 'assistant' : 'user', text: b.text }));
  }

  const tail: string[] = [];
  const opening = !recent.some((b) => b.role === 'prose') && !session.summary.trim();
  if (opening) tail.push(pov ? `Open the game: set ${pov.name} in the opening scene with something to want, something to fear and a way in. Describe only the world; end where ${pov.name} can act.` : tpl.opening);
  if (pov) tail.push(`This is interactive. The player plays ${pov.name}. Never decide, speak, think or act for ${pov.name}; narrate the world's response to their action, the people around them and its consequences, then stop at a moment where ${pov.name} can act again. When money or goods change hands for ${pov.name}, say what and how much ("forty crowns", "two ration bars"), so their sheet can be kept.`);
  if (world?.check) tail.push(renderCheck(world.check));
  if (world?.survivalNotes?.length) tail.push(`Since the last passage: ${world.survivalNotes.join(' ')}`);
  if (input.plan?.trim()) tail.push(`${tpl.planLead}\n${input.plan.trim()}`);
  if (p.postHistory.trim()) tail.push(p.postHistory.trim());
  if (session.explicit) tail.push(renderHeat(session.heat));
  if (input.direction?.trim()) tail.push(`Direction for this passage: ${input.direction.trim()}`);
  if (tail.length) push({ key: 'post', label: opening ? 'Opening directive' : 'Post-history', role: 'user', text: tail.join('\n\n') });
  if (p.prefill.trim()) push({ key: 'prefill', label: 'Prefill', role: 'assistant', text: p.prefill });

  // Fold into messages: consecutive system layers merge; conversation stays ordered.
  const messages: ChatMessage[] = [];
  for (const l of layers) {
    if (l.dropped) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === l.role && (l.role === 'system' || l.key.startsWith('beat:') && last.role === 'assistant')) {
      last.content += '\n\n' + l.text;
    } else messages.push({ role: l.role, content: l.text });
  }
  // A conversation must contain at least one user turn for most providers.
  if (!messages.some((m) => m.role === 'user')) {
    messages.push({ role: 'user', content: recent.length ? tpl.continueAsk : tpl.opening });
  } else if (messages[messages.length - 1]?.role === 'assistant' && !p.prefill.trim()) {
    messages.push({ role: 'user', content: tpl.continueAsk });
  }
  // Prefill must be the final assistant message.
  if (p.prefill.trim() && messages[messages.length - 1]?.role !== 'assistant') {
    messages.push({ role: 'assistant', content: p.prefill });
  }

  // Some providers drop or dilute the system role. Optionally deliver it as the opening exchange instead.
  if (preset?.systemAsUser && messages[0]?.role === 'system') {
    const sys = messages.shift()!;
    messages.unshift({ role: 'user', content: sys.content }, { role: 'assistant', content: 'Understood. I will continue the manuscript in that voice.' });
    log.push('system prompt delivered as the first user turn');
  }

  const totalTokens = layers.filter((l) => !l.dropped).reduce((n, l) => n + l.tokens, 0);
  log.push(`total ~${totalTokens} tokens in ${messages.length} messages`);
  return { layers, messages, totalTokens, log };
}

export function summaryPrompt(existing: string, beats: Beat[], templates: PromptTemplates = DEFAULT_TEMPLATES): ChatMessage[] {
  const text = beats.filter((b) => b.role === 'prose').map((b) => b.text).join('\n\n');
  return [
    { role: 'system', content: templates.summary },
    { role: 'user', content: `${existing.trim() ? `Current summary:\n${existing.trim()}\n\n` : ''}New passages to fold in:\n${text}\n\nWrite the updated summary.` },
  ];
}
