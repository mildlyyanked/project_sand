import type { Character, ChatMessage } from './types';
import type { WorldEntity, WorldEvent } from './world/types';
import { lenientJson } from './json';
import { normName } from './world/drafts';
import { namedIn } from './world/portraits';
import { locationChain, childrenOf } from './world/scan';
import { brief } from './world/mentions';

/**
 * The story map, the Lens's view of the whole story rather than one passage:
 * where things are (places nested inside each other, who is in each), and how
 * the people stand with each other. A base map comes straight from the library
 * and the player's sheet, with no model call; on demand the helper reads the
 * story and redraws it as things stand now. In play it shows only what the
 * player's character knows.
 */
export type Presence = 'here' | 'near' | 'away' | 'unknown' | 'gone';
export type TieKind = 'family' | 'romance' | 'friend' | 'ally' | 'work' | 'rival' | 'enemy' | 'debt' | 'other';
const PRESENCE: Presence[] = ['here', 'near', 'away', 'unknown', 'gone'];
const TIE_KINDS: TieKind[] = ['family', 'romance', 'friend', 'ally', 'work', 'rival', 'enemy', 'debt', 'other'];

export interface MapPlace { name: string; ref: string; within: string; note: string }
export interface MapPerson { name: string; ref: string; at: string; presence: Presence; doing: string }
export interface MapTie { a: string; b: string; kind: TieKind; label: string; tone: number }

export interface StoryMap {
  places: MapPlace[];
  people: MapPerson[];
  ties: MapTie[];
  /** Where the scene is. */
  here: string;
  /** The passage the map was read at; null for the base map. */
  beatId: string | null;
  at: number;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const same = (a: string, b: string) => !!a && !!b && normName(a) === normName(b);
const clampTone = (n: unknown) => Math.max(-3, Math.min(3, Math.round(Number(n) || 0)));

export interface MapInputs {
  entities: WorldEntity[];
  /** The cast and the world's people, the player included or not. */
  characters: Character[];
  player: Character | null;
  locationId: string | null;
  locationName: string;
  /** Play: how named people feel about the player. */
  relations?: Record<string, { attitude: number; note: string }>;
  /** Recent passages, newest last: who is named in the last one is here. */
  recent: string[];
  /** The story's own cast, always on the map. */
  castIds: string[];
}

/** The map as the library and the sheet have it: nobody's whereabouts but home, and the ties written down. */
export function baseMap(o: MapInputs): StoryMap {
  const byId = new Map(o.entities.map((e) => [e.id, e]));
  const last = o.recent[o.recent.length - 1] ?? '';
  const earlier = o.recent.slice(0, -1).join('\n');
  const named = (c: Character) => namedIn(last, c.name) || namedIn(earlier, c.name);
  const others = o.characters.filter((c) => c.id !== o.player?.id);
  const rel = o.relations ?? {};
  const cast = others.filter((c) => o.castIds.includes(c.id) || named(c) || Object.keys(rel).some((k) => same(k, c.name)));

  const here = o.locationId ? byId.get(o.locationId)?.name ?? o.locationName : o.locationName;
  const people: MapPerson[] = [];
  if (o.player) people.push({ name: o.player.name, ref: o.player.name, at: here, presence: 'here', doing: '' });
  for (const c of cast) {
    const inScene = namedIn(last, c.name);
    const home = c.data.homeLocationId ? byId.get(c.data.homeLocationId)?.name ?? '' : '';
    people.push({ name: c.name, ref: c.name, at: inScene ? here : home, presence: inScene ? 'here' : home ? 'away' : 'unknown', doing: '' });
  }

  // Places: the scene's chain, its neighbours and rooms, and everyone's home with its chain.
  const keep = new Map<string, WorldEntity>();
  const add = (e: WorldEntity | undefined) => { if (e && e.kind === 'location') keep.set(e.id, e); };
  const chain = locationChain(o.locationId, o.entities);
  chain.forEach(add);
  if (o.locationId) {
    const cur = byId.get(o.locationId);
    childrenOf(cur?.parentId ?? null, o.entities).filter((e) => e.kind === 'location').slice(0, 6).forEach(add);
    childrenOf(o.locationId, o.entities).filter((e) => e.kind === 'location').slice(0, 6).forEach(add);
  }
  for (const c of cast) locationChain(c.data.homeLocationId, o.entities).forEach(add);
  const places: MapPlace[] = [...keep.values()].map((e) => ({ name: e.name, ref: e.name, within: e.parentId && keep.has(e.parentId) ? byId.get(e.parentId)!.name : '', note: '' }));
  if (here && !places.some((p) => same(p.name, here))) places.push({ name: here, ref: '', within: '', note: '' });

  // Ties: how people feel about the player, who leads whom, and relationships written on the cards.
  const ties: MapTie[] = [];
  const tie = (t: MapTie) => { if (!ties.some((x) => (same(x.a, t.a) && same(x.b, t.b)) || (same(x.a, t.b) && same(x.b, t.a)))) ties.push(t); };
  if (o.player) for (const [name, r] of Object.entries(rel)) {
    const c = cast.find((x) => same(x.name, name));
    if (c) tie({ a: c.name, b: o.player.name, kind: r.attitude >= 2 ? 'friend' : r.attitude <= -2 ? 'enemy' : 'other', label: r.note, tone: clampTone(r.attitude) });
  }
  const everyone = o.player ? [...cast, o.player] : cast;
  for (const c of everyone) {
    for (const d of everyone) {
      if (c.id === d.id) continue;
      const line = sentenceNaming(c.relationships ?? '', d.name);
      if (line) tie({ a: c.name, b: d.name, kind: guessKind(line), label: brief(line, 90), tone: guessTone(line) });
    }
  }
  for (const org of o.entities.filter((e) => e.kind === 'organization')) {
    const leader = everyone.find((c) => c.id === org.data.leader);
    if (!leader) continue;
    for (const c of everyone) if (c.id !== leader.id && c.data.memberships?.some((m) => m.orgId === org.id)) tie({ a: leader.name, b: c.name, kind: 'work', label: `leads them in ${org.name}`, tone: 1 });
  }
  return { places, people, ties, here, beatId: null, at: 0 };
}

function sentenceNaming(text: string, name: string): string {
  return text.split(/(?<=[.!?;\n])\s*/).find((s) => namedIn(s, name))?.trim() ?? '';
}

function guessKind(s: string): TieKind {
  const l = s.toLowerCase();
  if (/\b(sister|brother|mother|father|son|daughter|cousin|aunt|uncle|wife|husband|twin|parent|child)\b/.test(l)) return 'family';
  if (/\b(lover|love|beloved|betrothed|engaged|affair|sweetheart)\b/.test(l)) return 'romance';
  if (/\b(owes|debt|lent|loan)\b/.test(l)) return 'debt';
  if (/\b(hate|enemy|enemies|killed|murder|betray)/.test(l)) return 'enemy';
  if (/\b(rival|resent|distrust|compete)/.test(l)) return 'rival';
  if (/\b(friend|trust|confidant)/.test(l)) return 'friend';
  if (/\b(ally|allies|sworn|loyal)/.test(l)) return 'ally';
  if (/\b(employ|works? for|master|apprentice|captain|boss|serves?)\b/.test(l)) return 'work';
  return 'other';
}

function guessTone(s: string): number {
  const k = guessKind(s);
  return k === 'enemy' ? -2 : k === 'rival' || k === 'debt' ? -1 : k === 'other' || k === 'work' ? 0 : k === 'family' ? 1 : 2;
}

const PERCEIVE = (name: string) => `This is interactive; the player is ${name}. Show only what ${name} knows or could reasonably know: whereabouts they have seen or been told (otherwise "unknown", with where they were last seen in "doing"), and ties between other people only when ${name} has seen or heard of them. ${name}'s own place is where the scene is.`;

export function mapPrompt(o: { base: StoryMap; library: string; recent: string; events: string; pov?: { name: string } | null }): ChatMessage[] {
  return [
    { role: 'system', content: [
      'You keep the map of a story as it stands at its latest passage: the places that matter and which is inside which, where each person is now, and how the people stand with each other. Start from the map the library gives (below) and update it from what the story has shown: people move, meet, fall out, die; new places and people appear. Keep places and people that still matter; drop the irrelevant. Use library names exactly where they apply.',
      o.pov ? PERCEIVE(o.pov.name) : 'You see everything the story and the library say.',
      'Output only JSON: {"here": string (where the scene is), "places": [{"name": string, "within": string (the place it is inside, or ""), "note": string (one short line: what is going on there now, or "")}], "people": [{"name": string, "at": string (a place name, or ""), "presence": "here" (in the scene) | "near" (close by) | "away" | "unknown" | "gone" (dead or out of the story), "doing": string (one short line)}], "ties": [{"a": string, "b": string, "kind": "family" | "romance" | "friend" | "ally" | "work" | "rival" | "enemy" | "debt" | "other", "label": string (a few words: how a stands with b, as of now), "tone": number (-3 hostile to 3 devoted)}]}. At most 40 places, 24 people, 40 ties.',
    ].join('\n\n') },
    { role: 'user', content: [
      o.library ? `# The library\n${o.library}` : '',
      `# The map so far\n${JSON.stringify({ here: o.base.here, places: o.base.places.map(({ name, within, note }) => ({ name, within, note })), people: o.base.people.map(({ name, at, presence, doing }) => ({ name, at, presence, doing })), ties: o.base.ties.map(({ a, b, kind, label, tone }) => ({ a, b, kind, label, tone })) })}`,
      o.events ? `# What has happened\n${o.events}` : '',
      `# The story, latest passages last\n${o.recent}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

export function parseMap(text: string, o: { player?: string; known: string[] }): StoryMap | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  const you = (n: string) => (o.player && /^(you|the player|player)$/i.test(n) ? o.player : n);
  const ref = (n: string) => o.known.find((k) => same(k, n)) ?? '';
  const places: MapPlace[] = [];
  for (const p of list(j.places)) {
    const name = str(p.name);
    if (name && !places.some((x) => same(x.name, name))) places.push({ name, ref: ref(name), within: str(p.within), note: str(p.note) });
  }
  const people: MapPerson[] = [];
  for (const p of list(j.people)) {
    const name = you(str(p.name));
    if (!name || people.some((x) => same(x.name, name))) continue;
    const pr = str(p.presence).toLowerCase() as Presence;
    people.push({ name, ref: ref(name), at: str(p.at), presence: PRESENCE.includes(pr) ? pr : 'unknown', doing: str(p.doing) });
  }
  const ties: MapTie[] = [];
  for (const t of list(j.ties)) {
    const a = you(str(t.a));
    const b = you(str(t.b));
    if (!a || !b || same(a, b)) continue;
    const kind = str(t.kind).toLowerCase() as TieKind;
    ties.push({ a, b, kind: TIE_KINDS.includes(kind) ? kind : 'other', label: str(t.label), tone: clampTone(t.tone) });
  }
  if (!places.length && !people.length) return null;
  const here = str(j.here);
  if (here && !places.some((p) => same(p.name, here))) places.push({ name: here, ref: ref(here), within: '', note: '' });
  if (o.player) {
    const me = people.find((p) => same(p.name, o.player!));
    if (me) Object.assign(me, { at: here || me.at, presence: 'here' as Presence });
    else people.unshift({ name: o.player, ref: o.player, at: here, presence: 'here', doing: '' });
  }
  return { places: places.slice(0, 40), people: people.slice(0, 24), ties: ties.slice(0, 40), here, beatId: null, at: 0 };
}

export interface PlaceNode { place: MapPlace; children: PlaceNode[]; people: MapPerson[]; depth: number }

/** Places nested by "within", with the people in each; anyone whose place is not on the map is left for the caller. */
export function placeTree(map: StoryMap): PlaceNode[] {
  const nodes = new Map<string, PlaceNode>();
  for (const p of map.places) nodes.set(normName(p.name), { place: p, children: [], people: [], depth: 0 });
  const roots: PlaceNode[] = [];
  for (const n of nodes.values()) {
    let parent = n.place.within ? nodes.get(normName(n.place.within)) : undefined;
    // Never nest a place inside itself through a loop.
    for (let p = parent; p; p = p.place.within ? nodes.get(normName(p.place.within)) : undefined) if (p === n) { parent = undefined; break; }
    (parent ? parent.children : roots).push(n);
  }
  for (const person of map.people) {
    if (person.presence === 'gone') continue;
    const n = person.at ? nodes.get(normName(person.at)) : undefined;
    if (n && person.presence !== 'unknown') n.people.push(person);
  }
  const depth = (n: PlaceNode, d: number) => { n.depth = d; n.children.forEach((c) => depth(c, d + 1)); };
  roots.forEach((r) => depth(r, 0));
  // Prune: keep the branches with the scene or someone in them, and the scene's neighbours.
  const hereKey = normName(map.here);
  const busy = (n: PlaceNode): boolean => normName(n.place.name) === hereKey || n.people.length > 0 || !!n.place.note || n.children.some(busy);
  const hereNode = nodes.get(hereKey);
  const near = new Set<PlaceNode>(hereNode ? [hereNode, ...hereNode.children] : []);
  const prune = (list: PlaceNode[]): PlaceNode[] => list.filter((n) => busy(n) || near.has(n) || list.some((s) => normName(s.place.name) === hereKey)).map((n) => ({ ...n, children: prune(n.children) }));
  return prune(roots);
}

/** People on the map whose whereabouts are not a place on it. */
export function unplaced(map: StoryMap): MapPerson[] {
  return map.people.filter((p) => p.presence === 'unknown' || p.presence === 'gone' || !p.at || !map.places.some((x) => same(x.name, p.at)));
}

/** The ties of one person, with who is on the other end and how they stand. */
export function tiesOf(map: StoryMap, name: string): { other: string; tie: MapTie; out: boolean }[] {
  return map.ties.filter((t) => same(t.a, name) || same(t.b, name)).map((t) => ({ other: same(t.a, name) ? t.b : t.a, tie: t, out: same(t.a, name) }));
}

/** Who sits around the person in the middle of the web: their ties first (warmest to coldest), then whoever else is about. */
export function webOrder(map: StoryMap, focus: string, max = 10): string[] {
  const tied = tiesOf(map, focus).sort((a, b) => b.tie.tone - a.tie.tone).map((x) => x.other);
  const rest = map.people.filter((p) => p.presence !== 'gone' && !same(p.name, focus)).sort((a, b) => PRESENCE.indexOf(a.presence) - PRESENCE.indexOf(b.presence)).map((p) => p.name);
  const out: string[] = [];
  for (const n of [...tied, ...rest]) if (!same(n, focus) && !out.some((x) => same(x, n))) out.push(n);
  return out.slice(0, max);
}

/** Points on a ring, starting at the top, clockwise. */
export function ring(n: number, cx: number, cy: number, r: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** A straight line between two points as a rotated box: where to put it and how to turn it. */
export function line(x1: number, y1: number, x2: number, y2: number, thickness = 2): { left: number; top: number; width: number; angle: number } {
  const width = Math.hypot(x2 - x1, y2 - y1);
  return { left: (x1 + x2) / 2 - width / 2, top: (y1 + y2) / 2 - thickness / 2, width, angle: Math.atan2(y2 - y1, x2 - x1) };
}

/** The library and the recent story, compact, for the map reading. */
export function mapLibrary(o: { entities: WorldEntity[]; characters: Character[]; base: StoryMap }): string {
  const byId = new Map(o.entities.map((e) => [e.id, e]));
  const onMap = (n: string) => o.base.places.some((p) => same(p.name, n)) || o.base.people.some((p) => same(p.name, n));
  const places = o.entities.filter((e) => e.kind === 'location').sort((a, b) => Number(onMap(b.name)) - Number(onMap(a.name))).slice(0, 80)
    .map((e) => `- ${e.name}${e.data.type ? ` (${String(e.data.type)})` : ''}${e.parentId && byId.get(e.parentId) ? `, in ${byId.get(e.parentId)!.name}` : ''}`);
  const people = [...o.characters].sort((a, b) => Number(onMap(b.name)) - Number(onMap(a.name))).slice(0, 30).map((c) => {
    const home = c.data.homeLocationId ? byId.get(c.data.homeLocationId)?.name : '';
    const m = c.data.memberships?.[0];
    const org = m ? byId.get(m.orgId)?.name : '';
    return `- ${c.name}: ${[c.summary, home ? `home ${home}` : '', org ? `${org}${m!.role ? ` (${m!.role})` : ''}` : '', c.relationships ? `ties: ${brief(c.relationships, 200)}` : ''].filter(Boolean).join('; ')}`;
  });
  return [places.length ? `Places:\n${places.join('\n')}` : '', people.length ? `People:\n${people.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

export function mapEvents(events: WorldEvent[]): string {
  return events.filter((e) => e.kind === 'travel' || e.kind === 'relation' || e.kind === 'death' || e.importance >= 2).slice(-24).map((e) => `- ${e.title}${e.text && e.text !== e.title ? `. ${brief(e.text, 160)}` : ''}`).join('\n');
}
