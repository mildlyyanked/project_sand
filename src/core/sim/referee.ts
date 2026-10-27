import type { ChatMessage } from '../types';
import type { Attribute, PovState, WorldCalendar } from '../world/types';
import { lenientJson } from '../json';
import { ATTRIBUTES, ATTRIBUTE_INFO } from '../world/dice';
import { formatDuration, formatShort, timeOfDay } from '../world/calendar';
import { normName } from '../world/drafts';
import { parseThreadUpdates, newThread as makeThread, type Thread, type ThreadUpdate } from '../world/gm';
import { sceneAt } from './crowd';
import { services } from './actions';
import { placeChain, attitudeWord } from './narrate';
import { whereLine } from './grid';
import { nearbyPlaces } from './ops';
import type { Kit, SimOp, SimState, Venue } from './types';

/**
 * The referee: one cheap call per free action (anything typed, and all
 * talk). It reads the world as it stands, with a ref for everyone and
 * everything, and answers with what the action really does: the ops that
 * change the world, a dice check if the outcome is in doubt (rolled here,
 * not by the model), and what happens in a line or two for the narrator.
 */
export interface RefereeReply {
  intent: string;
  minutes: number;
  outcome: string;
  ops: SimOp[];
  check: { attribute: Attribute; difficulty: number; why: string; success: { outcome: string; ops: SimOp[] }; failure: { outcome: string; ops: SimOp[] } } | null;
  speaker: string | null;
  threads: ThreadUpdate[];
  newThread: Thread | null;
}

const VENUES: Venue[] = ['tavern', 'inn', 'market', 'shop', 'workshop', 'temple', 'clinic', 'dock', 'garrison', 'palace', 'office', 'square', 'street', 'hall', 'home', 'room', 'building', 'district', 'road', 'wild', 'ruin', 'other'];

/** The world as the referee reads it: everyone and everything with a ref in brackets. */
export function sceneForReferee(sim: SimState, kit: Kit, pov: PovState, o: { calendar?: WorldCalendar; currency: string; playerName: string }): string {
  const s = sceneAt(sim, kit, o.calendar);
  if (!s) return '';
  const sv = services(sim, o.calendar);
  const rel = (name: string) => Object.entries(pov.relations).find(([k]) => normName(k) === normName(name))?.[1];
  const near = nearbyPlaces(sim, s.place.id, 14);
  const exits = near.map((x) => `${x.place.name} [${x.place.id}] ${formatDuration(x.minutes)}`);
  const farther = Object.values(sim.places).filter((p) => p.known && p.id !== s.place.id && !near.some((x) => x.place.id === p.id)).slice(0, 40).map((p) => `${p.name} [${p.id}]`);
  const lines = [
    `Place: ${placeChain(sim, s.place).map((p) => p.name).join(' › ')} [${s.place.id}] (${s.place.venue}${s.place.danger ? `, danger ${s.place.danger}/5` : ''}${s.place.owner ? `, owned by ${s.place.owner === 'player' ? 'the player' : s.place.owner}` : ''}). ${s.place.note}`,
    `Time: ${formatShort(o.calendar, sim.clock)} (${timeOfDay(o.calendar, sim.clock)}). About ${s.crowd} people here.`,
    whereLine(sim),
    s.people.length ? `People here:\n${s.people.map((a) => { const r = rel(a.name); return `- ${a.name} [${a.id}]: ${[a.role, a.look, a.traits, a.staff ? 'works here' : '', a.status !== 'ok' ? a.status : '', a.faction ? `of ${a.faction}` : '', r ? `${attitudeWord(r.attitude)} toward the player${r.note ? ` (${r.note})` : ''}` : 'has not dealt with the player', a.memory.length ? `remembers: ${a.memory.slice(-3).join('; ')}` : ''].filter(Boolean).join(', ')}`; }).join('\n')}` : 'People here: nobody known by name.',
    s.faces.length ? `Faces in the crowd (not yet met; to deal with one, use their ref):\n${s.faces.map((f) => `- [${f.key}] ${f.name}, ${f.role}, ${f.look}`).join('\n')}` : '',
    exits.length ? `Exits: ${exits.join('; ')}` : 'Exits: none known.',
    farther.length ? `Other known places: ${farther.join(', ')}` : '',
    sv?.stock.length ? `For sale${sv.open ? ` (${sv.keeper?.name} serving)` : ' (shut)'}: ${sv.stock.map((t) => `${t.name} ${t.price}`).join(', ')} ${o.currency}` : '',
    sv?.work ? `Work here: ${sv.work.role}, ${sv.work.hours} h for ${sv.work.pay} ${o.currency}` : '',
    sv?.lodging ? `Beds: ${sv.lodging} ${o.currency} a night` : '',
    sv?.forSale ? `This place is for sale: ${sv.forSale} ${o.currency}` : '',
    sv?.lying.length ? `Lying here: ${sv.lying.map((t) => `${t.name} [${t.id}]`).join(', ')}` : '',
    sv?.stash?.length ? `The player's stored things here: ${sv.stash.map((t) => `${t.qty} × ${t.name}`).join(', ')}` : '',
  ];
  const leads = sim.leads.filter((l) => l.status === 'open');
  if (leads.length) lines.push(`Open leads:\n${leads.map((l) => `- [${l.id}] ${l.title}: ${l.goal}${l.giver ? ` (from ${l.giver})` : ''}${l.where ? ` at ${l.where}` : ''}${l.reward ? `, reward ${l.reward}` : ''}${l.deadline ? `, due ${formatShort(o.calendar, l.deadline)}` : ''}`).join('\n')}`);
  const rep = Object.entries(sim.rep).filter(([, v]) => v);
  if (rep.length) lines.push(`Standing: ${rep.map(([f, v]) => `${f} ${v > 0 ? '+' : ''}${v}`).join(', ')}`);
  return lines.filter(Boolean).join('\n');
}

const OPS = [
  '{"op":"go","to": exit ref or known place ref} (the player travels there; never for moving within the scene)',
  '{"op":"money","amount": number (+ received, − paid),"note": what for}',
  '{"op":"gain","item": name,"qty": n,"from": ref of who or where it comes from, or null}',
  '{"op":"lose","item": name as on the sheet,"qty": n,"to": ref of who gets it, or null}',
  '{"op":"attitude","who": ref,"delta": -2..2,"note": what they will remember}',
  '{"op":"remember","who": ref,"note": string}',
  '{"op":"meet","who": face ref,"name": their name if they give one,"traits": one line of who they are} (whenever the player deals with a face in the crowd)',
  '{"op":"npc","who": ref,"goes": place ref, or null to leave the scene,"hours": how long they stay away,"status": "ok"|"hurt"|"dead"|"gone","follows": true|false (goes along with the player)}',
  `{"op":"place","name": string,"venue": ${VENUES.map((v) => `"${v}"`).join('|')},"within": place ref,"minutes": walk from there,"note": one line} (a place the player finds, or is told the way to, that is not on the map yet; add "here": true when they find it right where they stand)`,
  '{"op":"lead","title": string,"goal": string,"giver": ref,"where": place name,"reward": string,"money": number,"hours": time limit or 0,"thread": hidden thread name or ""} (someone offers work, asks a favour, or a rumour worth chasing; or a hidden thread surfaces into something the player can pursue)',
  '{"op":"lead","id": lead ref,"status": "done"|"failed"|"dropped","note": string}',
  '{"op":"rep","faction": name,"delta": -3..3}',
  '{"op":"vital","resource": "health"|"energy"|"satiety"|"hydration"|"morale","delta": number}',
  '{"op":"condition","add": "sprained ankle"} or {"op":"condition","remove": name}',
  '{"op":"own","place": ref} (only when the player truly acquires it)',
];

export function refereePrompt(o: { name: string; scene: string; sheet: string; attributes: Partial<Record<Attribute, number>>; checks: boolean; recent: string; action: string; threads?: Thread[] }): ChatMessage[] {
  const open = (o.threads ?? []).filter((t) => t.status === 'open');
  return [
    { role: 'system', content: [
      `You are the referee of an interactive story run on a living world. The player plays ${o.name}. Read what they do and decide what it really does in the world as it stands: who responds and how, what it costs, what changes. A fair, hard referee: honour clever play, make reckless play cost, never hand out what was not earned. People act on their own wants and remember how they are treated. Something always moves: if the player stalls, the world does.`,
      `Ops change the world. Use only these, with the refs in brackets:\n${OPS.join('\n')}`,
      'Rules: only what the action and the response truly change. Charge real prices; nobody pays more than they have. Eating or drinking something carried: lose it and raise satiety or hydration. Giving something: lose it to them. Talking to a face in the crowd: meet them. Asking the way to a kind of place that is not on the map: add a place. People leaving or arriving: npc. A lead is a promise of something to do with a reward; mark it done when its goal is met (and pay with a money op).',
      o.checks ? `Dice: set "check" only when the outcome is truly uncertain and failure would matter (fights, chases, climbs, lies, persuading the unwilling, stealing, enduring, noticing the hidden). Attributes: ${ATTRIBUTES.map((a) => `${a} (${ATTRIBUTE_INFO[a].hint})`).join('; ')}. Difficulty: 8 easy, 12 moderate, 16 hard, 20 very hard. Success and failure each carry their own outcome and ops; top-level ops happen either way.` : 'No dice: decide outcomes yourself.',
      open.length ? 'Hidden threads run behind the screen. Move one only when the action or the passing time touches it; let signs of one show in an outcome now and then; never explain one.' : '',
      `Output only JSON: {"intent": string (what they are really after, one line), "minutes": number (how long it takes: a line of talk 1, a conversation 5 to 15, a search 10 to 30), "outcome": string (what happens, concretely, from the world's side, with what people say in gist; 1 to 3 sentences; for a check, what is at stake), "ops": [op], "check": null${o.checks ? ' or {"attribute": string, "difficulty": number, "why": string, "success": {"outcome": string, "ops": [op]}, "failure": {"outcome": string, "ops": [op]}}' : ''}, "speaker": ref of who answers, or null${open.length ? ', "threads": [{"name": string, "advance": 0|1|2, "surfaced": boolean, "next": string, "status": "open"|"done"|"dropped", "outcome": string}] (only threads that moved), "newThread": null or {"name","kind","hook","signs","next","size": 4|6}' : ''}}.`,
    ].filter(Boolean).join('\n\n') },
    { role: 'user', content: [
      `# The world\n${o.scene}`,
      `# The player\n${o.sheet}${o.checks ? `\nAttributes: ${ATTRIBUTES.map((a) => `${a} ${o.attributes[a] ?? 2}`).join(', ')}` : ''}`,
      open.length ? `# Behind the screen (hidden)\n${open.map((t) => `- ${t.name} (${t.clock}/${t.size}): ${t.hook} Signs: ${t.signs} Next: ${t.next}`).join('\n')}` : '',
      o.recent ? `# Just before\n${o.recent.slice(-1500)}` : '',
      `# What the player does\n${o.action || '(nothing: they wait and watch)'}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function parseOps(v: unknown): SimOp[] {
  return (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof x.op === 'string').map((x) => x as unknown as SimOp).slice(0, 20);
}

export function parseReferee(text: string, checks: boolean): RefereeReply | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const outcome = str(j.outcome);
  if (!outcome) return null;
  const c = j.check && typeof j.check === 'object' ? (j.check as Record<string, unknown>) : null;
  const attribute = str(c?.attribute).toLowerCase() as Attribute;
  const branch = (v: unknown) => { const b = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}; return { outcome: str(b.outcome), ops: parseOps(b.ops) }; };
  return {
    intent: str(j.intent),
    minutes: Math.max(0, Math.min(24 * 60, Math.round(Number(j.minutes) || 0))),
    outcome,
    ops: parseOps(j.ops),
    check: checks && c && ATTRIBUTES.includes(attribute) ? { attribute, difficulty: Math.max(4, Math.min(28, Math.round(Number(c.difficulty) || 12))), why: str(c.why), success: branch(c.success), failure: branch(c.failure) } : null,
    speaker: str(j.speaker) || null,
    threads: parseThreadUpdates(j.threads),
    newThread: j.newThread && typeof j.newThread === 'object' ? makeThread(j.newThread as Record<string, unknown>) : null,
  };
}
