import type { Attribute, CheckResult, PovState } from '../world/types';
import { rollCheck } from '../world/dice';
import { applyThreadUpdates, type Thread, type ThreadUpdate } from '../world/gm';
import { applyOps, type Applied, type SimContext } from './ops';
import { tick } from './tick';
import type { RefereeReply } from './referee';
import type { Resolution, SimOp, SimState, TurnRecord } from './types';

/**
 * One turn of the world: settle the dice if there are any, apply the ops,
 * let the world move on, move the hidden threads. Returns the new world and
 * sheet, what the passage keeps (so undo and branches can rebuild the world),
 * and the brief for the narrator.
 */
export interface TurnResult {
  sim: SimState;
  pov: PovState;
  record: TurnRecord;
  res: Resolution;
  check: CheckResult | null;
  notes: string[];
  events: Applied['events'];
  closed: Thread[];
}

/** A referee's reply as a resolution, with the dice rolled. */
export function settle(r: RefereeReply, action: string, o: { pov: PovState; scores: Partial<Record<Attribute, number>>; rng?: () => number }): { res: Resolution; check: CheckResult | null } {
  let ops = r.ops;
  let outcome = r.outcome;
  let check: CheckResult | null = null;
  if (r.check) {
    check = rollCheck({ attribute: r.check.attribute, difficulty: r.check.difficulty, score: o.scores[r.check.attribute], state: o.pov, why: r.check.why, onSuccess: r.check.success.outcome, onFailure: r.check.failure.outcome, rng: o.rng });
    const won = check.outcome === 'success' || check.outcome === 'crit-success' || check.outcome === 'partial';
    const b = won ? r.check.success : r.check.failure;
    ops = [...ops, ...b.ops];
    outcome = [outcome, b.outcome].filter(Boolean).join(' ');
  }
  if (r.minutes && !ops.some((x) => x.op === 'time' || x.op === 'go')) ops = [...ops, { op: 'time', minutes: r.minutes }];
  return { res: { action, outcome, ops, speaker: r.speaker, threads: r.threads, newThread: r.newThread }, check };
}

export function runTurn(sim: SimState, pov: PovState, res: Resolution, ctx: SimContext, check: CheckResult | null = null): TurnResult {
  const before = { clock: sim.clock, here: sim.here };
  const a = applyOps(sim, pov, res.ops, ctx);
  const t = tick(a.sim, { kit: ctx.kit, calendar: ctx.calendar, currency: ctx.currency, before });
  let nextPov = t.money ? { ...a.pov, money: a.pov.money + t.money } : a.pov;
  let closed: Thread[] = [];
  const updates = (res.threads as ThreadUpdate[] | undefined) ?? [];
  if (updates.length || res.newThread) {
    const moved = applyThreadUpdates(nextPov.threads ?? [], updates, (res.newThread as Thread | null) ?? null);
    nextPov = { ...nextPov, threads: moved.threads };
    closed = moved.closed;
  }
  nextPov = { ...nextPov, lastCheck: check };
  return {
    sim: a.sim,
    pov: nextPov,
    record: { ops: a.applied, chips: [...a.chips, ...t.chips], facts: [...a.facts, ...t.facts] },
    res,
    check,
    notes: a.notes,
    events: a.events,
    closed,
  };
}

/** Rebuild the world after a passage from what it kept: the same ops on the same world give the same world. */
export function replay(sim: SimState, povBefore: PovState, ops: SimOp[], ctx: SimContext): SimState {
  const before = { clock: sim.clock, here: sim.here };
  const a = applyOps(sim, povBefore, ops, ctx);
  tick(a.sim, { kit: ctx.kit, calendar: ctx.calendar, currency: ctx.currency, before });
  return a.sim;
}
