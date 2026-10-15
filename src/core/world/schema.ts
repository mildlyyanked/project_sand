/**
 * What every world element can carry. The editors and the context renderer
 * both read this, so adding a field here adds it everywhere.
 */
export type FieldType = 'text' | 'long' | 'select' | 'number' | 'ref' | 'effects' | 'lines' | 'bool' | 'keys';

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
}

export const LOCATION_TYPES = ['realm', 'planet', 'continent', 'region', 'nation', 'province', 'city', 'town', 'village', 'district', 'street', 'building', 'room', 'wilderness', 'route', 'landmark', 'ruin', 'dungeon', 'station', 'ship', 'other'];
export const ORG_TYPES = ['government', 'empire', 'federation', 'kingdom', 'guild', 'company', 'religion', 'military', 'order', 'school', 'family', 'gang', 'cult', 'rebellion', 'tribe', 'other'];
export const ITEM_TYPES = ['weapon', 'armor', 'tool', 'food', 'drink', 'medicine', 'consumable', 'artifact', 'document', 'key', 'currency', 'resource', 'vehicle', 'clothing', 'other'];
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'unique'];
export const LORE_CATEGORIES = ['history', 'religion', 'magic', 'technology', 'culture', 'law', 'geography', 'economy', 'other'];

export const LOCATION_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'select', options: LOCATION_TYPES, inContext: true },
  { key: 'description', label: 'Description', type: 'long', hint: 'What it looks, sounds and smells like; what it is for.', inContext: true },
  { key: 'atmosphere', label: 'Atmosphere', type: 'text', hint: 'The feeling of being there.', inContext: true },
  { key: 'climate', label: 'Climate and terrain', type: 'text', inContext: true },
  { key: 'population', label: 'Who is found here', type: 'text', inContext: true },
  { key: 'controlledBy', label: 'Controlled by', type: 'ref', ref: 'organization', inContext: true },
  { key: 'features', label: 'Notable features', type: 'long', hint: 'Landmarks, rooms, exits, what a visitor notices first.', inContext: true },
  { key: 'services', label: 'Services and trade', type: 'text', hint: 'Inns, markets, healers, what can be bought.', inContext: true },
  { key: 'resources', label: 'What can be found', type: 'text', hint: 'Food, water, shelter, salvage. Matters in survival play.', inContext: true },
  { key: 'dangers', label: 'Dangers', type: 'long', inContext: true },
  { key: 'danger', label: 'Danger level', type: 'number', hint: '0 safe to 5 lethal.', inContext: true },
  { key: 'travel', label: 'Getting there and away', type: 'text', hint: 'Routes and how long they take.', inContext: true },
  { key: 'secrets', label: 'Secrets', type: 'long', hint: 'Sent to the writer; revealed only when the story earns it.', inContext: true },
];

export const ORGANIZATION_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'select', options: ORG_TYPES, inContext: true },
  { key: 'description', label: 'Description', type: 'long', inContext: true },
  { key: 'goals', label: 'Goals and ideology', type: 'long', inContext: true },
  { key: 'methods', label: 'Methods', type: 'text', hint: 'How they get what they want.', inContext: true },
  { key: 'leader', label: 'Leader', type: 'ref', ref: 'character', inContext: true },
  { key: 'headquarters', label: 'Headquarters', type: 'ref', ref: 'location', inContext: true },
  { key: 'size', label: 'Size and strength', type: 'text', inContext: true },
  { key: 'resources', label: 'Resources', type: 'text', hint: 'Money, soldiers, ships, influence.', inContext: true },
  { key: 'ranks', label: 'Ranks and structure', type: 'text', inContext: true },
  { key: 'symbols', label: 'Symbols and dress', type: 'text', inContext: true },
  { key: 'allies', label: 'Allies', type: 'text', inContext: true },
  { key: 'enemies', label: 'Enemies and rivals', type: 'text', inContext: true },
  { key: 'reputation', label: 'Reputation', type: 'text', hint: 'How ordinary people see them.', inContext: true },
  { key: 'secrets', label: 'Secrets', type: 'long', inContext: true },
];

export const ITEM_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'select', options: ITEM_TYPES, inContext: true },
  { key: 'description', label: 'Description', type: 'long', inContext: true },
  { key: 'rarity', label: 'Rarity', type: 'select', options: RARITIES, inContext: true },
  { key: 'properties', label: 'Properties and powers', type: 'long', inContext: true },
  { key: 'origin', label: 'Origin and history', type: 'long', inContext: true },
  { key: 'owner', label: 'Held by', type: 'ref', ref: 'character', inContext: true },
  { key: 'location', label: 'Kept at', type: 'ref', ref: 'location', inContext: true },
  { key: 'value', label: 'Value', type: 'number', hint: 'In the world’s currency.', inContext: true },
  { key: 'weight', label: 'Weight or bulk', type: 'text' },
  { key: 'effects', label: 'Effects when used', type: 'effects', hint: 'For play: "satiety +30, hydration +10", "health +25", "morale +5".', play: true, inContext: true },
];

export const SPECIES_FIELDS: FieldDef[] = [
  { key: 'appearance', label: 'Appearance', type: 'long', inContext: true },
  { key: 'lifespan', label: 'Lifespan', type: 'text', inContext: true },
  { key: 'traits', label: 'Traits and temperament', type: 'long', inContext: true },
  { key: 'abilities', label: 'Abilities', type: 'long', inContext: true },
  { key: 'weaknesses', label: 'Weaknesses', type: 'text', inContext: true },
  { key: 'needs', label: 'Diet and needs', type: 'text', hint: 'What they eat, how they sleep. Matters in survival play.', inContext: true },
  { key: 'culture', label: 'Culture and society', type: 'long', inContext: true },
  { key: 'homeland', label: 'Homeland', type: 'ref', ref: 'location', inContext: true },
  { key: 'relations', label: 'Relations with other peoples', type: 'text', inContext: true },
];

export const CHARACTER_FIELDS: FieldDef[] = [
  { key: 'occupation', label: 'Occupation', type: 'text', inContext: true },
  { key: 'lookalike', label: 'Looks like', type: 'text', hint: 'A real person or a fictional character whose look inspires this one. Forge writes the appearance from it in its own words; it is never sent to the writer or an image model.' },
  { key: 'appearance', label: 'Appearance', type: 'long', inContext: true },
  { key: 'personality', label: 'Personality', type: 'long', inContext: true },
  { key: 'backstory', label: 'Backstory', type: 'long', inContext: true },
  { key: 'goals', label: 'Goals', type: 'text', inContext: true },
  { key: 'fears', label: 'Fears', type: 'text', inContext: true },
  { key: 'secrets', label: 'Secrets', type: 'long', inContext: true },
  { key: 'skills', label: 'Skills', type: 'text', inContext: true },
  { key: 'homeLocationId', label: 'Home', type: 'ref', ref: 'location', inContext: true },
  { key: 'inventory', label: 'Carries', type: 'lines', hint: 'One per line, "2 × waterskin". The starting inventory in play.', play: true },
  { key: 'money', label: 'Money', type: 'number', play: true },
];

export const WORLD_FIELDS: FieldDef[] = [
  { key: 'genre', label: 'Genre', type: 'text', inContext: true },
  { key: 'tone', label: 'Tone', type: 'text', inContext: true },
  { key: 'rules', label: 'How the world works', type: 'long', hint: 'Magic, physics, what is possible and what it costs.', inContext: true },
  { key: 'technology', label: 'Technology', type: 'text', inContext: true },
  { key: 'society', label: 'Society', type: 'long', hint: 'Who rules, what people fear, what is taboo.', inContext: true },
  { key: 'themes', label: 'Themes', type: 'text', inContext: true },
  { key: 'currency', label: 'Currency', type: 'text', inContext: true },
  { key: 'artStyle', label: 'Art direction', type: 'long', hint: 'One look for every picture of this world: medium, palette, light, influences. Portraits, views, objects and illustrations all start from it. Never sent to the writer.' },
  { key: 'sigilStyle', label: 'Sigil style', type: 'text', hint: 'How faction emblems are drawn, so they read as one heraldry. Never sent to the writer.' },
];

export const FIELDS_BY_KIND = { location: LOCATION_FIELDS, organization: ORGANIZATION_FIELDS, item: ITEM_FIELDS, species: SPECIES_FIELDS, character: CHARACTER_FIELDS, world: WORLD_FIELDS } as const;

export const KIND_LABEL = { location: 'Place', organization: 'Faction', item: 'Thing', species: 'People', character: 'Character' } as const;
export const KIND_PLURAL = { location: 'Places', organization: 'Factions', item: 'Things', species: 'Peoples', character: 'Characters' } as const;
