import { estimateTokens } from '../tokens';
import { formatShort, formatTime } from './calendar';
import { mentions } from './scan';
import type { Minutes, WorldCalendar, WorldEvent } from './types';

export interface Focus {
  ids: Set<string>;
  names: string[];
}

export function involves(e: WorldEvent, f: Focus): boolean {
  if (e.entities.some((r) => (r.id && f.ids.has(r.id)) || f.names.some((n) => n.toLowerCase() === r.name.toLowerCase()))) return true;
  return f.names.some((n) => mentions(`${e.title} ${e.text}`, n));
}

export interface Continuity {
  past: WorldEvent[];
  future: WorldEvent[];
  /** Per focus element, its recorded changes up to now, newest last. */
  states: { name: string; events: WorldEvent[]; dead: WorldEvent | null }[];
}

/**
 * What a story should know of its instance's timeline at `now`. Major events
 * always; anything touching the people and places in the scene; the most recent
 * few. Later events that touch the scene are constraints: already established,
 * so this story must leave them possible.
 */
export function selectContinuity(events: WorldEvent[], now: Minutes, focus: Focus, budgetTokens: number): Continuity {
  const pastAll = events.filter((e) => e.at <= now).sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
  const recentIds = new Set(pastAll.slice(-6).map((e) => e.id));
  const scored = pastAll
    .map((e, i) => {
      const inv = involves(e, focus);
      const keep = e.importance === 3 || inv || recentIds.has(e.id);
      return { e, keep, score: e.importance * 10 + (inv ? 15 : 0) + (recentIds.has(e.id) ? 8 : 0) + i / Math.max(1, pastAll.length) };
    })
    .filter((x) => x.keep);
  // Trim lowest-scoring first until the lines fit.
  let kept = scored.slice();
  const cost = (xs: typeof scored) => xs.reduce((n, x) => n + estimateTokens(`${x.e.title} ${x.e.text}`) + 8, 0);
  while (kept.length && cost(kept) > budgetTokens * 0.7) {
    const worst = kept.reduce((a, b) => (b.score < a.score ? b : a));
    kept = kept.filter((x) => x !== worst);
  }
  const past = kept.map((x) => x.e).sort((a, b) => a.at - b.at);
  const future = events
    .filter((e) => e.at > now && (involves(e, focus) || e.importance === 3))
    .sort((a, b) => a.at - b.at)
    .slice(0, 6);
  const states = focus.names.map((name) => {
    const f: Focus = { ids: new Set([...focus.ids].filter((id) => events.some((e) => e.entities.some((r) => r.id === id && r.name.toLowerCase() === name.toLowerCase())))), names: [name] };
    const evs = pastAll.filter((e) => e.kind !== 'event' && e.kind !== 'discovery' && involves(e, f));
    const dead = [...evs].reverse().find((e) => e.kind === 'death' && e.entities.some((r) => r.name.toLowerCase() === name.toLowerCase())) ?? null;
    return { name, events: evs.slice(-3), dead };
  }).filter((s) => s.events.length || s.dead);
  return { past, future, states };
}

export function renderContinuity(c: Continuity, o: { now: Minutes; calendar?: WorldCalendar; instanceName?: string; timeOfDay?: string }): string {
  const t = (at: number) => formatShort(o.calendar, at);
  const lines = [`# Continuity${o.instanceName ? ` · ${o.instanceName}` : ''}`, `Now: ${formatTime(o.calendar, o.now)}${o.timeOfDay ? ` (${o.timeOfDay})` : ''}.`];
  if (c.states.length) {
    lines.push('', 'Where things stand:');
    for (const s of c.states) {
      if (s.dead) lines.push(`- ${s.name} died (${t(s.dead.at)}): ${s.dead.text || s.dead.title}. They cannot appear alive except in memory, dream or haunting.`);
      for (const e of s.events.filter((x) => x !== s.dead)) lines.push(`- ${s.name}: ${e.text || e.title} (${t(e.at)})`);
    }
  }
  if (c.past.length) {
    lines.push('', 'Already happened in this world (treat as fact; characters remember what they would know):');
    for (const e of c.past) lines.push(`- ${t(e.at)} · ${e.title}${e.text && e.text !== e.title ? `: ${e.text}` : ''}`);
  }
  if (c.future.length) {
    lines.push('', 'Established for later in this world (do not contradict; leave these possible):');
    for (const e of c.future) lines.push(`- ${t(e.at)} · ${e.title}${e.text && e.text !== e.title ? `: ${e.text}` : ''}`);
  }
  return lines.join('\n');
}

export interface SiblingStory {
  title: string;
  mode: 'writer' | 'pov';
  clockStart: Minutes;
  clock: Minutes;
  summary: string;
  excerpt: string;
}

/** Other stories in the same instance, newest in-world first, within budget. */
export function renderSiblings(sibs: SiblingStory[], budgetTokens: number, calendar?: WorldCalendar, now?: Minutes): string {
  const ordered = [...sibs].sort((a, b) => b.clock - a.clock);
  const lines = ['# Other stories in this world', 'These happened in the same version of the world. Their events are real here; people may have heard of them. Do not retell them.'];
  let used = estimateTokens(lines.join('\n'));
  for (const s of ordered) {
    const when = `${formatShort(calendar, s.clockStart)} – ${formatShort(calendar, s.clock)}`;
    const rel = now == null ? '' : s.clock < now ? ' (before now)' : s.clockStart > now ? ' (after now: do not contradict)' : ' (overlapping now)';
    const body = (s.summary.trim() || s.excerpt.trim()).slice(0, 900);
    const block = `## ${s.title}${s.mode === 'pov' ? ' (played)' : ''}, ${when}${rel}\n${body}`;
    const t = estimateTokens(block);
    if (used + t > budgetTokens) break;
    used += t;
    lines.push(block);
  }
  return lines.length > 2 ? lines.join('\n\n') : '';
}
