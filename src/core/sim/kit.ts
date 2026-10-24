import type { ChatMessage } from '../types';
import { lenientJson } from '../json';
import type { Good, Kit, Venue } from './types';

/**
 * What kind of place something is, and what each kind holds: how crowded it
 * is by day and night, who you meet there, what it sells, what work it pays
 * for. The defaults suit any world; a per-world kit, written once by the
 * helper, gives them the world's own names, trades and prices.
 */

const SETTLEMENT_TYPES = new Set(['city', 'town', 'village', 'station']);
const REGION_TYPES = new Set(['realm', 'planet', 'continent', 'region', 'nation', 'province']);

const KEYWORDS: [Venue, RegExp][] = [
  ['inn', /\b(inn|hostel|hotel|lodge|lodging|boarding ?house|motel|capsule)/],
  ['tavern', /\b(tavern|bar|pub|cantina|saloon|alehouse|taproom|lounge|club|canteen|diner|caf[eé]|tea ?house|beer ?hall)/],
  ['market', /\b(market|bazaar|souk|fair|mall|arcade|exchange floor)/],
  ['clinic', /\b(clinic|hospital|infirmary|med ?bay|surgery|healer|sanatorium)/],
  ['shop', /\b(shop|store|emporium|smithy|blacksmith|apothecary|pharmacy|outfitter|tailor|clothier|vendor|kiosk|dealer|pawn|chandler|armou?ry|bakery|butcher|grocer)/],
  ['workshop', /\b(workshop|forge|foundry|mill|factory|yard|lab|laboratory|plant|refinery|mine|works)\b/],
  ['temple', /\b(temple|church|shrine|chapel|cathedral|monastery|abbey|sanctum|mosque|synagogue)/],
  ['dock', /\b(dock|port|harbou?r|pier|wharf|quay|hangar|landing|berth|airlock|spaceport)/],
  ['garrison', /\b(garrison|barracks|fort|guardhouse|precinct|watch ?house|checkpoint|gatehouse|gate)\b/],
  ['palace', /\b(palace|castle|manor|estate|villa|mansion|citadel)/],
  ['office', /\b(office|bank|archive|library|registry|guild ?hall|bureau|ministry|counting ?house|consulate)/],
  ['square', /\b(square|plaza|forum|commons|courtyard|promenade|atrium|concourse)/],
  ['home', /\b(house|home|cottage|apartment|flat|quarters|hut|tenement|bunk|dorm|hovel|shack|cabin)/],
  ['hall', /\b(hall|corridor|passage|tunnel|spur|deck|level|tier|ring|stair)/],
  ['street', /\b(street|road|lane|alley|avenue|way|row|boulevard|walk|bridge)\b/],
];

const BY_TYPE: Record<string, Venue> = { district: 'district', street: 'street', building: 'building', room: 'room', wilderness: 'wild', route: 'road', ruin: 'ruin', dungeon: 'ruin', ship: 'vehicle', landmark: 'square' };

export function venueOf(name: string, type: string, text = ''): Venue {
  const t = type.toLowerCase();
  if (SETTLEMENT_TYPES.has(t)) return 'settlement';
  if (REGION_TYPES.has(t)) return 'region';
  const words = `${name} ${text.slice(0, 160)}`.toLowerCase();
  const byName = KEYWORDS.find(([, re]) => re.test(name.toLowerCase()));
  if (byName) return byName[0];
  if (BY_TYPE[t] && t !== 'building' && t !== 'room' && t !== 'landmark') return BY_TYPE[t]!;
  const byText = KEYWORDS.find(([, re]) => re.test(words));
  if (byText && (t === 'building' || t === 'room' || t === 'landmark' || t === 'other' || !t)) return byText[0];
  return BY_TYPE[t] ?? 'other';
}

/** Minutes from a place to the place that contains it. */
export const LEG: Record<Venue, number> = {
  room: 1, hall: 2, building: 2, home: 2, shop: 2, tavern: 2, inn: 2, workshop: 2, temple: 3, clinic: 2, office: 2, garrison: 3, palace: 5,
  street: 4, square: 4, market: 5, dock: 6, district: 12, settlement: 45, ruin: 30, wild: 90, road: 60, vehicle: 5, region: 240, other: 5,
};

/** People about at midday and at night, before the hour and chance shift them. */
export const CROWD: Record<Venue, [number, number]> = {
  tavern: [10, 34], inn: [8, 14], market: [140, 6], shop: [5, 0], workshop: [9, 1], temple: [18, 3], dock: [55, 12], garrison: [22, 16],
  square: [90, 14], street: [45, 9], home: [2, 3], hall: [16, 5], office: [14, 1], palace: [45, 22], clinic: [12, 6],
  wild: [0, 0], road: [5, 1], ruin: [0, 1], settlement: [400, 70], district: [220, 40], building: [10, 3], room: [2, 1], region: [0, 0], vehicle: [10, 6], other: [6, 2],
};

/** Who you meet in each kind of place. The first is the one who works there, where someone does. */
export const ROLES: Record<Venue, string[]> = {
  tavern: ['keeper', 'server', 'regular', 'gambler', 'traveller', 'off-duty guard', 'musician', 'labourer'],
  inn: ['innkeeper', 'porter', 'traveller', 'merchant', 'courier'],
  market: ['stallholder', 'hawker', 'shopper', 'porter', 'beggar', 'guard', 'courier', 'pickpocket'],
  shop: ['shopkeeper', 'customer', 'apprentice'],
  workshop: ['master', 'apprentice', 'labourer', 'customer'],
  temple: ['priest', 'worshipper', 'pilgrim', 'beggar', 'acolyte'],
  clinic: ['healer', 'patient', 'orderly', 'visitor'],
  dock: ['harbourmaster', 'dockhand', 'sailor', 'fisher', 'smuggler', 'porter'],
  garrison: ['sergeant', 'guard', 'officer', 'clerk', 'prisoner'],
  palace: ['steward', 'courtier', 'servant', 'guard', 'official'],
  office: ['clerk', 'official', 'petitioner', 'messenger'],
  square: ['passer-by', 'street seller', 'preacher', 'courier', 'guard', 'performer', 'beggar'],
  street: ['passer-by', 'courier', 'worker', 'beggar', 'guard', 'vendor'],
  hall: ['passer-by', 'worker', 'guard', 'clerk', 'courier'],
  home: ['resident', 'visitor'],
  settlement: ['passer-by', 'worker', 'vendor', 'guard', 'traveller'],
  district: ['passer-by', 'worker', 'vendor', 'guard', 'resident'],
  road: ['traveller', 'carter', 'patrol', 'pilgrim'],
  wild: ['hunter', 'wanderer'],
  ruin: ['scavenger'],
  building: ['occupant', 'worker', 'visitor'],
  room: ['occupant'],
  vehicle: ['crew', 'passenger'],
  region: ['traveller'],
  other: ['local', 'stranger'],
};

/** Venues where someone is always on duty (the first role). */
export const STAFFED = new Set<Venue>(['tavern', 'inn', 'market', 'shop', 'workshop', 'temple', 'clinic', 'dock', 'garrison', 'palace', 'office']);

export const SHOP_CATEGORIES: Partial<Record<Venue, string[]>> = {
  tavern: ['food', 'drink'], inn: ['food', 'drink'], market: ['food', 'supplies', 'clothing', 'tool'], workshop: ['tool'], temple: ['medicine'], clinic: ['medicine'], dock: ['supplies', 'food'],
};

export function shopCategories(venue: Venue, name: string): string[] | null {
  if (venue !== 'shop') return SHOP_CATEGORIES[venue] ?? null;
  const n = name.toLowerCase();
  if (/smith|armou?r|weapon|blade|gun/.test(n)) return ['weapon', 'armor', 'tool'];
  if (/apothecar|pharm|heal|med|herb/.test(n)) return ['medicine'];
  if (/tailor|cloth|outfit|boot/.test(n)) return ['clothing'];
  if (/bak|butcher|grocer|food/.test(n)) return ['food', 'drink'];
  return ['supplies', 'tool', 'luxury'];
}

/** Paid work by venue: the job, its hours, and how it pays against an ordinary day's wage. */
export const WORK: Partial<Record<Venue, { role: string; hours: number; rate: number }>> = {
  tavern: { role: 'serving tables', hours: 4, rate: 0.9 }, inn: { role: 'cleaning rooms', hours: 4, rate: 0.8 }, market: { role: 'hauling crates', hours: 4, rate: 1 },
  dock: { role: 'loading cargo', hours: 6, rate: 1.2 }, workshop: { role: 'labouring', hours: 6, rate: 1.1 }, shop: { role: 'minding the counter', hours: 4, rate: 0.9 },
  office: { role: 'copying records', hours: 4, rate: 1.1 }, clinic: { role: 'orderly work', hours: 6, rate: 1 }, temple: { role: 'menial service', hours: 4, rate: 0.5 },
};

export const AMBIENT: Partial<Record<Venue, string[]>> = {
  tavern: ['a dice game erupts in curses', 'someone starts a song and half the room joins in', 'the keeper hauls a drunk to the door', 'a stranger asks after someone by name', 'a mug shatters and the room cheers'],
  inn: ['a door bangs upstairs', 'a weary traveller argues over the price of a room', 'someone pays in odd coin'],
  market: ['a hawker bellows a price', 'a thief is chased between the stalls', 'two stallholders squabble over a spot', 'a cart jams the way and tempers rise'],
  street: ['a patrol passes, eyes everywhere', 'a cart loses a wheel', 'a child darts past with something stolen', 'someone empties a bucket from a window'],
  square: ['a crier reads out a notice', 'a preacher works the crowd', 'a busker plays for coins', 'a crowd gathers around a fight'],
  dock: ['a load swings overhead on a creaking line', 'sailors brawl over a debt', 'a bell rings an arrival'],
  temple: ['a bell tolls', 'a prayer rises and falls', 'someone leaves an offering and hurries out'],
  garrison: ['boots drill in step somewhere', 'an officer barks orders'],
  hall: ['footsteps echo and fade', 'a door slams far off', 'two people hush as you pass'],
  wild: ['the birds go silent all at once', 'the wind turns', 'fresh tracks cross your path'],
  road: ['a wagon rattles past', 'dust rises far ahead'],
  district: ['a patrol passes', 'a shout goes up a few streets over', 'bells ring the hour'],
  settlement: ['bells ring the hour', 'a procession blocks a street', 'smoke rises from somewhere'],
};

const DEFAULT_GOODS: Good[] = [
  { name: 'hot meal', category: 'food', price: 5 }, { name: 'bread and cheese', category: 'food', price: 2 }, { name: 'dried rations', category: 'food', price: 3 },
  { name: 'mug of ale', category: 'drink', price: 2 }, { name: 'bottle of wine', category: 'drink', price: 8 }, { name: 'flask of water', category: 'drink', price: 1 },
  { name: 'coil of rope', category: 'tool', price: 4 }, { name: 'lantern', category: 'tool', price: 6 }, { name: 'lockpicks', category: 'tool', price: 20 },
  { name: 'knife', category: 'weapon', price: 10 }, { name: 'short sword', category: 'weapon', price: 40 }, { name: 'leather jacket', category: 'armor', price: 30 },
  { name: 'warm cloak', category: 'clothing', price: 12 }, { name: 'sturdy boots', category: 'clothing', price: 15 },
  { name: 'bandages', category: 'medicine', price: 4 }, { name: 'healing salve', category: 'medicine', price: 12 },
  { name: 'travel pack', category: 'supplies', price: 8 }, { name: 'oil flask', category: 'supplies', price: 3 }, { name: 'firestarter', category: 'supplies', price: 2 },
  { name: 'map of the area', category: 'document', price: 10 }, { name: 'trinket', category: 'luxury', price: 15 }, { name: 'fine gloves', category: 'luxury', price: 25 },
];

export const DEFAULT_KIT: Kit = {
  given: ['Ada', 'Bren', 'Cass', 'Dara', 'Eli', 'Fen', 'Gus', 'Hal', 'Ivo', 'Jun', 'Kit', 'Lio', 'Mara', 'Nell', 'Oren', 'Pia', 'Quin', 'Rhea', 'Sol', 'Tam', 'Una', 'Vik', 'Wren', 'Yara', 'Zed', 'Ansel', 'Bea', 'Corin', 'Della', 'Emrys', 'Fia', 'Gideon', 'Hana', 'Ilse', 'Jory', 'Kesh', 'Lena', 'Milo', 'Nadia', 'Osric'],
  family: ['Ash', 'Bell', 'Crane', 'Dunn', 'Eld', 'Frost', 'Gale', 'Hart', 'Iles', 'Jory', 'Kell', 'Lark', 'Moss', 'Nash', 'Orr', 'Pike', 'Rook', 'Sable', 'Thorn', 'Vane', 'Wick', 'Yew', 'Brant', 'Cole', 'Drake', 'Fell', 'Grey', 'Holt', 'Marsh', 'Quill'],
  roles: {},
  goods: DEFAULT_GOODS,
  ambient: {},
  wage: 16,
  bed: 6,
  house: 600,
};

export const LOOKS = ['lean', 'broad-shouldered', 'grey-haired', 'scarred', 'young', 'weathered', 'tired-eyed', 'sharply dressed', 'ragged', 'tattooed', 'quiet', 'loud', 'heavyset', 'wiry', 'freckled', 'stooped', 'tall', 'short', 'nervous', 'watchful', 'cheerful', 'sour-faced'];

export function rolesFor(kit: Kit, venue: Venue): string[] {
  const own = kit.roles[venue];
  return own?.length ? own : ROLES[venue];
}

export function ambientFor(kit: Kit, venue: Venue): string[] {
  const own = kit.ambient[venue];
  return own?.length ? own : AMBIENT[venue] ?? [];
}

const VENUES: Venue[] = ['tavern', 'inn', 'market', 'shop', 'workshop', 'temple', 'clinic', 'dock', 'garrison', 'palace', 'office', 'square', 'street', 'hall', 'home', 'district', 'settlement', 'road', 'wild'];

/** One helper call, once per play world: names, people, goods and prices, and the small life of places, in the world's own terms. */
export function kitPrompt(o: { world: string; currency: string }): ChatMessage[] {
  return [
    { role: 'system', content: [
      'You prepare the reference tables a game uses to fill a fictional world with ordinary life: names for the people met in crowds, the kinds of people found in each kind of place, goods and their prices, and small passing events. Everything must fit the world exactly: its genre, technology, culture and tone. Plain, concrete words; no named characters from the world itself.',
      `Output only JSON: {"given": string[] (40 given names), "family": string[] (30 family names or bynames), "roles": {${VENUES.map((v) => `"${v}": string[]`).join(', ')}} (3 to 7 kinds of people for each kind of place, the one who works or runs it first), "goods": [{"name": string, "category": "food" | "drink" | "supplies" | "tool" | "weapon" | "armor" | "clothing" | "medicine" | "luxury" | "document", "price": number}] (24 everyday goods with prices in ${o.currency || 'the world\'s money'}), "ambient": {${VENUES.map((v) => `"${v}": string[]`).join(', ')}} (3 short passing events for each, lower case, no names), "wage": number (a day's pay for ordinary work), "bed": number (a night's bed at an inn), "house": number (the price of a small house)}.`,
    ].join('\n\n') },
    { role: 'user', content: o.world },
  ];
}

export function parseKit(text: string): Kit | null {
  const j = lenientJson<Record<string, unknown>>(text);
  if (!j) return null;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()).slice(0, n) : []);
  const byVenue = (v: unknown, n: number) => {
    const out: Partial<Record<Venue, string[]>> = {};
    if (v && typeof v === 'object') for (const k of VENUES) { const list = strs((v as Record<string, unknown>)[k], n); if (list.length) out[k] = list; }
    return out;
  };
  const goods = (Array.isArray(j.goods) ? j.goods : [])
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g) => ({ name: String(g.name ?? '').trim(), category: String(g.category ?? 'supplies').trim().toLowerCase(), price: Math.max(0, Math.round(Number(g.price) || 0)) }))
    .filter((g) => g.name && g.price > 0)
    .slice(0, 40);
  const given = strs(j.given, 60);
  const family = strs(j.family, 60);
  if (given.length < 8 || goods.length < 6) return null;
  const num = (v: unknown, d: number) => (Number(v) > 0 ? Math.round(Number(v)) : d);
  return { given, family, roles: byVenue(j.roles, 8), goods, ambient: byVenue(j.ambient, 5), wage: num(j.wage, DEFAULT_KIT.wage), bed: num(j.bed, DEFAULT_KIT.bed), house: num(j.house, DEFAULT_KIT.house) };
}

/** A good's going price, by name, for things the player carries; 0 when nobody knows what it is worth. */
export function goodValue(kit: Kit, name: string): Good | null {
  const n = name.toLowerCase().trim();
  return kit.goods.find((g) => g.name.toLowerCase() === n) ?? kit.goods.find((g) => n.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(n)) ?? null;
}
