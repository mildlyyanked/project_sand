import type { Attribute, CheckResult, Outcome, PovState } from './types';
import { LOW } from './survival';

export const ATTRIBUTES: Attribute[] = ['might', 'agility', 'wits', 'presence', 'resolve'];
export const ATTRIBUTE_INFO: Record<Attribute, { label: string; hint: string }> = {
  might: { label: 'Might', hint: 'Strength, endurance, force.' },
  agility: { label: 'Agility', hint: 'Speed, stealth, balance, aim.' },
  wits: { label: 'Wits', hint: 'Perception, knowledge, cunning.' },
  presence: { label: 'Presence', hint: 'Charm, intimidation, deceit, command.' },
  resolve: { label: 'Resolve', hint: 'Willpower, nerve, faith, resisting pain and fear.' },
};

/** 1 → -2, 2 → 0, 3 → +2, 4 → +4, 5 → +6. */
export function attributeModifier(score: number | undefined): number {
  const s = Math.max(1, Math.min(5, Math.round(score ?? 2)));
  return (s - 2) * 2;
}

/** Wounds, fatigue and despair make everything harder. */
export function statePenalty(state: PovState | undefined): number {
  if (!state) return 0;
  const r = state.resources;
  let p = 0;
  if (r.health < 30) p -= 2;
  if (r.energy < 20) p -= 2;
  if (r.morale < LOW) p -= 1;
  if (r.satiety === 0 || r.hydration === 0) p -= 2;
  const afflicted = state.conditions.filter((c) => /injur|wound|bleed|poison|sick|fever|broken|exhaust|frost|burn/i.test(c)).length;
  p -= Math.min(3, afflicted);
  return Math.max(-6, p);
}

export function outcomeOf(roll: number, total: number, difficulty: number): Outcome {
  if (roll === 20) return 'crit-success';
  if (roll === 1) return 'crit-fail';
  if (total >= difficulty + 5) return 'crit-success';
  if (total >= difficulty) return 'success';
  if (total >= difficulty - 4) return 'partial';
  return 'fail';
}

export const OUTCOME_LABEL: Record<Outcome, string> = { 'crit-fail': 'disaster', fail: 'failure', partial: 'success at a cost', success: 'success', 'crit-success': 'triumph' };

export function rollCheck(o: { attribute: Attribute; difficulty: number; score?: number; state?: PovState; why?: string; onSuccess?: string; onFailure?: string; rng?: () => number }): CheckResult {
  const rng = o.rng ?? Math.random;
  const roll = Math.min(20, Math.max(1, Math.floor(rng() * 20) + 1));
  const modifier = attributeModifier(o.score) + statePenalty(o.state);
  const difficulty = Math.max(5, Math.min(25, Math.round(o.difficulty)));
  const total = roll + modifier;
  return { attribute: o.attribute, difficulty, roll, modifier, total, outcome: outcomeOf(roll, total, difficulty), why: o.why ?? '', onSuccess: o.onSuccess ?? '', onFailure: o.onFailure ?? '' };
}

/** The ruling the writer must narrate. The outcome is decided; the prose only shows it. */
export function renderCheck(c: CheckResult): string {
  const att = ATTRIBUTE_INFO[c.attribute].label;
  const head = `The player's action was tested (${att}, ${c.total} against ${c.difficulty}): ${OUTCOME_LABEL[c.outcome].toUpperCase()}.`;
  const body = {
    'crit-success': `It goes better than they hoped. ${c.onSuccess}`.trim(),
    success: `They succeed. ${c.onSuccess}`.trim(),
    partial: `They get what they wanted, but it costs them: a complication, a wound, noise, lost time or a worse position. ${c.onSuccess}`.trim(),
    fail: `They fail. ${c.onFailure}`.trim(),
    'crit-fail': `It goes badly wrong and the world answers hard. ${c.onFailure}`.trim(),
  }[c.outcome];
  return `${head} ${body} Narrate this result faithfully; do not soften or reverse it, and do not mention dice or numbers.`;
}
