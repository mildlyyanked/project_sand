/**
 * What every world element can carry. The editors and the context renderer
 * both read this, so adding a field here adds it everywhere.
 */
export type FieldType = 'text' | 'long' | 'select' | 'number' | 'ref' | 'effects' | 'lines' | 'bool' | 'keys' | 'ties';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: string[];
  /** For 'ref': which kind of element it points at. */
  ref?: 'location' | 'organization' | 'item' | 'character' | 'species';
  /** Sent to the writer when the element comes up. Off for bookkeeping fields. */
  inContext?: boolean;
  /** Only shown, and only sent, in POV play. */
  play?: boolean;
  /** What forge is asked for, when it differs from the hint. False: never forged. */
  forge?: string | false;
  /** The section it belongs to on the entry's page. */
  section?: Section;
}

/**
 * Entry pages group fields into a few sections, the same for every kind, so
 * a place, a faction and a person read alike: what it is, what it is like,
 * the life in it, its edge, what is hidden, and what play needs. References
 * are not a section: they are connections, shown with every other link.
 */
export type Section = 'basics' | 'look' | 'life' | 'edge' | 'hidden' | 'play';
export const SECTION_LABEL: Record<Section, string> = { basics: 'At a glance', look: 'Look and feel', life: 'Life', edge: 'Edge', hidden: 'Hidden', play: 'In play' };
export const SECTION_ORDER: Section[] = ['basics', 'look', 'life', 'edge', 'hidden', 'play'];

export const LOCATION_TYPES = ['realm', 'planet', 'continent', 'region', 'nation', 'province', 'city', 'town', 'village', 'district', 'street', 'building', 'room', 'wilderness', 'route', 'landmark', 'ruin', 'dungeon', 'station', 'ship', 'other'];
export const ORG_TYPES = ['government', 'empire', 'federation', 'kingdom', 'guild', 'company', 'religion', 'military', 'order', 'school', 'family', 'gang', 'cult', 'rebellion', 'tribe', 'other'];
export const ITEM_TYPES = ['weapon', 'armor', 'tool', 'food', 'drink', 'medicine', 'consumable', 'artifact', 'document', 'key', 'currency', 'resource', 'vehicle', 'clothing', 'other'];
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'unique'];
export const LORE_CATEGORIES = ['history', 'religion', 'magic', 'technology', 'culture', 'law', 'geography', 'economy', 'other'];

export const LOCATION_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'select', options: LOCATION_TYPES, inContext: true, section: 'basics' },
  { key: 'description', label: 'Description', type: 'long', hint: 'What it is and what being there is like: sights, sounds, smells, climate and terrain, landmarks, the ways in and out.', forge: '60 to 140 words: look, feel, climate, landmarks, ways in and out', inContext: true, section: 'look' },
  { key: 'life', label: 'Life and trade', type: 'long', hint: 'Who is found here and what it offers: people, work, markets, services, food, water, shelter, salvage.', forge: 'who is found here; trade and services; food, water and shelter to be had', inContext: true, section: 'life' },
  { key: 'dangers', label: 'Dangers', type: 'long', inContext: true, section: 'edge' },
  { key: 'danger', label: 'Danger level', type: 'number', hint: '0 safe to 5 lethal.', forge: '0-5', inContext: true, section: 'edge' },
  { key: 'controlledBy', label: 'Controlled by', type: 'ref', ref: 'organization', inContext: true },
  { key: 'secrets', label: 'Secrets', type: 'long', hint: 'Sent to the writer; revealed only when the story earns it.', inContext: true, section: 'hidden' },
];

export const ORGANIZATION_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'select', options: ORG_TYPES, inContext: true, section: 'basics' },
  { key: 'description', label: 'Description', type: 'long', forge: '60 to 100 words', inContext: true, section: 'look' },
  { key: 'image', label: 'Image', type: 'text', hint: 'Symbols, colours and dress, and how ordinary people see them.', inContext: true, section: 'look' },
  { key: 'aims', label: 'Aims and methods', type: 'long', hint: 'What they want, what they believe, how they get it.', inContext: true, section: 'life' },
  { key: 'structure', label: 'Strength and structure', type: 'long', hint: 'Size, ranks, money, soldiers, ships, influence.', inContext: true, section: 'life' },
  { key: 'leader', label: 'Leader', type: 'ref', ref: 'character', inContext: true },
  { key: 'headquarters', label: 'Headquarters', type: 'ref', ref: 'location', inContext: true },
  { key: 'secrets', label: 'Secrets', type: 'long', inContext: true, section: 'hidden' },
];

export const ITEM_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'select', options: ITEM_TYPES, inContext: true, section: 'basics' },
  { key: 'rarity', label: 'Rarity', type: 'select', options: RARITIES, inContext: true, section: 'basics' },
  { key: 'value', label: 'Value', type: 'number', hint: 'In the world’s currency.', inContext: true, section: 'basics' },
  { key: 'description', label: 'Description', type: 'long', hint: 'Shape, size, weight, materials, wear, markings.', forge: '40 to 80 words', inContext: true, section: 'look' },
  { key: 'powers', label: 'What it does', type: 'long', hint: 'Properties and powers, uses and costs.', inContext: true, section: 'life' },
  { key: 'history', label: 'History', type: 'long', hint: 'Who made it, who has held it, what it has done.', inContext: true, section: 'edge' },
  { key: 'owner', label: 'Held by', type: 'ref', ref: 'character', inContext: true },
  { key: 'location', label: 'Kept at', type: 'ref', ref: 'location', inContext: true },
  { key: 'effects', label: 'Effects when used', type: 'effects', hint: 'For play: "satiety +30, hydration +10", "health +25", "morale +5".', forge: 'for things that are used up, like "satiety +30, hydration +10" or "health +25"; "" otherwise', play: true, inContext: true, section: 'play' },
];

export const SPECIES_FIELDS: FieldDef[] = [
  { key: 'lifespan', label: 'Lifespan', type: 'text', inContext: true, section: 'basics' },
  { key: 'appearance', label: 'Appearance', type: 'long', inContext: true, section: 'look' },
  { key: 'nature', label: 'Nature', type: 'long', hint: 'Temperament, gifts and weaknesses, diet and sleep.', inContext: true, section: 'look' },
  { key: 'culture', label: 'Culture', type: 'long', hint: 'Society, customs, beliefs, how they live.', inContext: true, section: 'life' },
  { key: 'homeland', label: 'Homeland', type: 'ref', ref: 'location', inContext: true },
];

export const CHARACTER_FIELDS: FieldDef[] = [
  { key: 'occupation', label: 'Occupation', type: 'text', inContext: true, section: 'basics' },
  { key: 'lookalike', label: 'Looks like', type: 'text', hint: 'A real person or a fictional character whose look inspires this one. Forge writes the appearance from it in its own words; it is never sent to the writer or an image model.', forge: false, section: 'look' },
  { key: 'appearance', label: 'Appearance', type: 'long', inContext: true, section: 'look' },
  { key: 'personality', label: 'Personality', type: 'long', hint: 'Temperament, habits, gestures, tics.', inContext: true, section: 'look' },
  { key: 'backstory', label: 'Backstory', type: 'long', forge: '2 to 4 lines', inContext: true, section: 'life' },
  { key: 'skills', label: 'Skills', type: 'text', inContext: true, section: 'life' },
  { key: 'drives', label: 'Wants and fears', type: 'long', hint: 'What they want, what they would do for it, what they dread.', inContext: true, section: 'edge' },
  { key: 'secrets', label: 'Secrets', type: 'long', inContext: true, section: 'hidden' },
  { key: 'homeLocationId', label: 'Home', type: 'ref', ref: 'location', inContext: true },
  { key: 'inventory', label: 'Carries', type: 'lines', hint: 'One per line, "2 × waterskin". The starting inventory in play.', play: true, section: 'play' },
  { key: 'money', label: 'Money', type: 'number', play: true, section: 'play' },
];

export const WORLD_FIELDS: FieldDef[] = [
  { key: 'genre', label: 'Genre and tone', type: 'text', hint: 'What kind of story, and how it should feel.', inContext: true, section: 'basics' },
  { key: 'rules', label: 'How the world works', type: 'long', hint: 'Magic, physics, technology: what is possible and what it costs.', inContext: true, section: 'look' },
  { key: 'society', label: 'Society', type: 'long', hint: 'Who rules, what people fear, what is taboo.', inContext: true, section: 'life' },
  { key: 'themes', label: 'Themes', type: 'text', inContext: true, section: 'edge' },
  { key: 'currency', label: 'Currency', type: 'text', inContext: true, section: 'basics' },
];

/**
 * A world's style bible: one look every picture shares, and how each kind of
 * picture is framed within it. Never sent to the writer.
 */
export interface ArtBible {
  /** The shared look: medium, palette, light, texture, influences. */
  look: string;
  /** Character portraits: crop, pose, lens, light, background, how faces are drawn. */
  portraits: string;
  /** Views of places: shot, perspective, time and weather, scale. */
  places: string;
  /** Things: object studies. */
  things: string;
  /** Faction emblems: heraldry. Replaces the look, which suits paintings, not seals. */
  sigils: string;
}
export const EMPTY_BIBLE: ArtBible = { look: '', portraits: '', places: '', things: '', sigils: '' };
export const BIBLE_FIELDS: { key: keyof ArtBible; label: string; hint: string }[] = [
  { key: 'look', label: 'The look', hint: 'What every picture shares: medium, palette, light, texture, influences.' },
  { key: 'portraits', label: 'Portraits', hint: 'Crop, pose, angle, lens, light, background, how faces and skin are drawn.' },
  { key: 'places', label: 'Places', hint: 'The shot: perspective, scale, time of day and weather, what is in frame.' },
  { key: 'things', label: 'Things', hint: 'Object studies: angle, background, light.' },
  { key: 'sigils', label: 'Sigils', hint: 'How faction emblems are drawn, so they read as one heraldry.' },
];

/** The bible a picture uses: the world's own where it says something, then the app's, field by field. */
export function bibleOf(world: Partial<ArtBible> | undefined | null, fallback: Partial<ArtBible> | undefined | null = null): ArtBible {
  const out = { ...EMPTY_BIBLE };
  for (const f of BIBLE_FIELDS) out[f.key] = (world?.[f.key] ?? '').trim() || (fallback?.[f.key] ?? '').trim();
  return out;
}

export const FIELDS_BY_KIND = { location: LOCATION_FIELDS, organization: ORGANIZATION_FIELDS, item: ITEM_FIELDS, species: SPECIES_FIELDS, character: CHARACTER_FIELDS, world: WORLD_FIELDS } as const;

export const KIND_LABEL = { location: 'Place', organization: 'Faction', item: 'Thing', species: 'People', character: 'Character' } as const;
export const KIND_PLURAL = { location: 'Places', organization: 'Factions', item: 'Things', species: 'Peoples', character: 'Characters' } as const;
