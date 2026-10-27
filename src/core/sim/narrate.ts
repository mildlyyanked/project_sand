import type { CheckResult, PovState, WorldCalendar } from '../world/types';
import { formatDuration, timeOfDay } from '../world/calendar';
import { renderCheck } from '../world/dice';
import { normName } from '../world/drafts';
import { sceneAt } from './crowd';
import { services } from './actions';
import { nearbyPlaces } from './ops';
import { whereLine } from './grid';
import type { Kit, Place, Resolution, SimState } from './types';

/**
 * What the narrator gets in play: a contract (structure, clarity, length,
 * and the rule that the world state is the truth), the scene as it stands,
 * and this turn as already decided.
 */
export type SimLength = 'brisk' | 'standard' | 'rich';
export const SIM_WORDS: Record<SimLength, string> = { brisk: '40 to 80 words', standard: '60 to 120 words', rich: '100 to 170 words' };

export function simContract(o: { name: string; length?: SimLength }): string {
  const n = o.name;
  return [
    '# Playing the world',
    `You narrate an interactive story. The player is ${n}; the game has already decided what happens this turn ("This turn", at the end). Your job is to make the player see and feel it, exactly as decided, and to leave them ready to act.`,
    'Every turn, in this order:',
    `1. The action lands. The first sentence says plainly what ${n} did and how it went.`,
    `2. The world answers. People react in their own voices: quoted lines, the speaker named ("Mara says", "the keeper says"), short and in character, giving ${n} something to answer. Things move; the place shifts.`,
    `3. Hand back. End on what is in front of ${n} now: who is here, what is within reach, what just changed. No list of options, no question to the player, no summary.`,
    'Clarity first. Plain, concrete verbs. A reader always knows who did what, who said what, and where things are. At most one figure of speech in a turn. No inner monologue, no decisions, words or feelings supplied for the player.',
    `The world below is the truth. Do not invent lasting changes: nobody gains or loses money or things, arrives, leaves, is hurt or dies, and no new place appears, beyond what This turn says. The people named under "Where you are" are the only named people present; anyone else is a face in the crowd, described, not named, unless This turn names them.`,
    `Second person, present tense. Length: ${SIM_WORDS[o.length ?? 'standard']}; shorter for talk and small actions.`,
    'The voice above sets diction and texture only. This contract sets structure, clarity, perspective and length, and overrides any length, perspective or structure guidance above. No headings, no lists, no numbers from the sheet, no game terms.',
  ].join('\n');
}

const ATT = ['hostile', 'unfriendly', 'wary', 'neutral', 'warm', 'friendly', 'devoted'];
export const attitudeWord = (n: number) => ATT[Math.max(-3, Math.min(3, Math.round(n))) + 3]!;

/** The scene for the narrator: what the player can see from where they stand. */
export function sceneForNarrator(sim: SimState, kit: Kit, pov: PovState, o: { calendar?: WorldCalendar; currency: string }): string {
  const s = sceneAt(sim, kit, o.calendar);
  if (!s) return '';
  const chain = placeChain(sim, s.place).map((p) => p.name).join(' › ');
  const sv = services(sim, o.calendar);
  const rel = (name: string) => Object.entries(pov.relations).find(([k]) => normName(k) === normName(name))?.[1];
  const lines = [
    `# Where you are: ${chain}`,
    s.place.note ? s.place.note : '',
    `It is ${timeOfDay(o.calendar, sim.clock)}. About ${s.crowd} ${s.crowd === 1 ? 'person' : 'people'} here.`,
    whereLine(sim),
    s.people.length ? `People here: ${s.people.map((a) => { const r = rel(a.name); return `${a.name} (${[a.role, a.look, a.status !== 'ok' ? a.status : '', r ? `${attitudeWord(r.attitude)} toward you` : ''].filter(Boolean).join(', ')})`; }).join('; ')}.` : 'No one here you know by name.',
    s.faces.length ? `Faces in the crowd (unnamed unless they give a name): ${s.faces.map((f) => `a ${f.look} ${f.role}`).join('; ')}.` : '',
    exitsLine(sim, s.place),
    sv?.stock.length ? `For sale here${sv.open ? '' : ' (shut now)'}: ${sv.stock.map((t) => `${t.name} ${t.price} ${o.currency}`).join(', ')}.` : '',
    sv?.lying.length ? `Lying here: ${sv.lying.map((t) => t.name).join(', ')}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function placeChain(sim: SimState, p: Place): Place[] {
  const out: Place[] = [];
  const seen = new Set<string>();
  for (let cur: Place | undefined = p; cur && !seen.has(cur.id); cur = cur.parent ? sim.places[cur.parent] : undefined) { out.unshift(cur); seen.add(cur.id); }
  return out;
}

export function exitsLine(sim: SimState, p: Place): string {
  const ex = nearbyPlaces(sim, p.id);
  return ex.length ? `Close by: ${ex.map((x) => `${x.place.name} (${formatDuration(x.minutes)})`).join(', ')}.` : '';
}

/** This turn, as decided: the narrator's brief. */
export function renderTurn(o: { name: string; res: Resolution; check?: CheckResult | null; facts: string[]; opening?: boolean }): string {
  if (o.opening) {
    return [`This turn: the game begins.`, `Open on ${o.name} where they are. Through what they sense, establish the place, who is here, and one thing that wants their attention now. ${o.res.outcome}`, 'Write it now.'].join('\n');
  }
  return [
    `This turn. The player: ${o.res.action}`,
    `What happens: ${o.res.outcome}`,
    o.check ? renderCheck(o.check) : '',
    o.facts.length ? `What changed (true now; show it, do not list it): ${o.facts.join(' ')}` : '',
    'Write it now, by the rules of the game.',
  ].filter(Boolean).join('\n');
}
