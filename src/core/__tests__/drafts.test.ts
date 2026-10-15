import { describe, expect, it } from 'vitest';
import type { WorldEntity } from '../world/types';
import { characterDraft, draftCard, entityDraft, hooks, knowledge, libraryDrafts, planDrafts, related, type Library } from '../world/drafts';
import { anchorLink, entryImagePrompt, excerptsFor, fieldForgePrompt, forgePrompt, parseFieldValue, parseForgeDrafts, parseNewcomers } from '../world/forge';
import { DRAFT_FIELDS } from '../world/drafts';
import { character, lore, universe } from './fixtures';

const ent = (p: Partial<WorldEntity> & { id: string; kind: WorldEntity['kind']; name: string }): WorldEntity => ({ universeId: 'u1', parentId: null, summary: '', keys: [], data: {}, createdAt: 0, updatedAt: 0, ...p });

function lib(): Library {
  return {
    universe: universe({ name: 'Bakerland', description: 'Flour and iron.' }),
    entities: [
      ent({ id: 'k', kind: 'organization', name: 'Baker Kingdom', summary: 'A realm of mills.', data: { type: 'kingdom', description: 'Ruled from its capital, Baker City, by the Flour Queen.' } }),
      ent({ id: 'r', kind: 'location', name: 'The Rye Coast', data: { type: 'region' } }),
      ent({ id: 'g', kind: 'organization', name: 'Millers Guild', data: { type: 'guild', description: 'Led by Hester Crane, who keeps the stones turning.' } }),
    ],
    characters: [character({ id: 'c1', universeId: 'u1', name: 'Tom Sedge', summary: 'A carter.', data: { backstory: 'Tom lives in Baker City above a tannery.' } })],
    species: [],
    lore: [lore({ id: 'l1', title: 'The Grinding', keys: ['grinding'], text: 'Every spring the stones are dressed.' })],
  };
}

describe('drafts from the library', () => {
  it('turns ids into names and cards read as text', () => {
    const l = lib();
    l.entities.push(ent({ id: 'mill', kind: 'location', name: 'Old Mill', parentId: 'r', data: { controlledBy: 'g' } }));
    const d = entityDraft(l.entities[3]!, l);
    expect(d.fields).toMatchObject({ within: 'The Rye Coast', controlledBy: 'Millers Guild' });
    expect(draftCard(d)).toContain('Controlled by: Millers Guild');
    const c = characterDraft({ ...l.characters[0]!, data: { ...l.characters[0]!.data, memberships: [{ orgId: 'g', role: 'apprentice' }] } }, l);
    expect(c.fields).toMatchObject({ faction: 'Millers Guild', factionRole: 'apprentice' });
  });
  it('ranks what bears on the focus first and keeps the rest in a roster', () => {
    const pool = libraryDrafts(lib());
    const r = related({ name: 'Hester Crane', kind: 'character', fields: { faction: 'Millers Guild' } }, pool);
    expect(r[0]!.name).toBe('Millers Guild');
    const k = knowledge(pool, { name: 'Hester Crane', kind: 'character', fields: { faction: 'Millers Guild' } });
    expect(k).toContain('# World: Bakerland');
    expect(k).toContain('- Tom Sedge — A carter.');
    expect(k).toContain('# Entries that bear on this\n## Faction: Millers Guild');
  });
  it('finds loose threads to grow from', () => {
    expect(hooks(libraryDrafts(lib()))).toContain('Baker Kingdom has no leader yet.');
  });
});

describe('planning drafts into the library', () => {
  it('links a new capital to its kingdom, and older entries that already named it', () => {
    const drafts = parseForgeDrafts('location', JSON.stringify({ places: [{ name: 'Baker City', type: 'city', seatOf: 'Baker Kingdom', within: 'Rye Coast', summary: 'The capital.' }] }))!;
    const plan = planDrafts(drafts, lib(), 'u1');
    const city = plan.entities.find((e) => e.name === 'Baker City')!;
    expect(city.parentId).toBe('r');
    expect(city.data.controlledBy).toBe('k');
    expect(plan.entities.find((e) => e.id === 'k')!.data.headquarters).toBe(city.id);
    expect(plan.characters.find((c) => c.id === 'c1')!.data.homeLocationId).toBe(city.id);
    expect(plan.notes).toEqual(expect.arrayContaining(['Baker Kingdom: headquarters set to Baker City', 'Tom Sedge: home set to Baker City']));
  });
  it('makes a leader lead, gives a thing to its owner, and fills a leader an older faction named', () => {
    const drafts = parseForgeDrafts('mixed', JSON.stringify({
      characters: [{ name: 'Hester Crane', faction: 'Millers Guild', factionRole: 'Guildmaster', summary: 'Stern.' }, { name: 'Ada Flint', faction: 'Baker Kingdom', factionRole: 'Queen' }],
      things: [{ name: 'Stone Key', owner: 'Tom Sedge', type: 'key' }],
    }))!;
    const plan = planDrafts(drafts, lib(), 'u1');
    const hester = plan.characters.find((c) => c.name === 'Hester Crane')!;
    expect(hester.data.memberships).toEqual([{ orgId: 'g', role: 'Guildmaster' }]);
    expect(plan.entities.find((e) => e.id === 'g')!.data.leader).toBe(hester.id);
    expect(plan.entities.find((e) => e.id === 'k')!.data.leader).toBe(plan.characters.find((c) => c.name === 'Ada Flint')!.id);
    expect(plan.characters.find((c) => c.id === 'c1')!.data.inventory).toBe('Stone Key');
  });
  it('does not let a faction forged in the same batch lose the seat a place gave it', () => {
    const drafts = parseForgeDrafts('mixed', JSON.stringify({ places: [{ name: 'Tallow Keep', seatOf: 'Wax Order' }], factions: [{ name: 'Wax Order', headquarters: '' }] }))!;
    const plan = planDrafts(drafts, lib(), 'u1');
    expect(plan.entities.find((e) => e.name === 'Wax Order')!.data.headquarters).toBe(plan.entities.find((e) => e.name === 'Tallow Keep')!.id);
  });
  it('creates a new world with its contents', () => {
    const drafts = parseForgeDrafts('world', '{"name":"Vell","description":"A drowned city.","calendar":{"kind":"custom","yearLabel":"AT","startYear":40,"daysPerYear":300},"species":[{"name":"Moulters","adulthood":"after the third moult"}],"lore":[{"title":"Tide law","keys":["Tide","COURT"],"text":"Rules.","alwaysOn":true}],"places":[{"name":"Low Ward"}]}')!;
    expect(drafts.map((d) => d.kind)).toEqual(['world', 'location', 'species', 'lore']);
    const plan = planDrafts(drafts, { universe: null, entities: [], characters: [], species: [], lore: [] }, null);
    expect(plan.universe?.name).toBe('Vell');
    expect(plan.universe?.data.calendar).toMatchObject({ kind: 'custom', yearLabel: 'AT', daysPerYear: 300 });
    expect(plan.entities[0]!.universeId).toBe(plan.universe!.id);
    expect(plan.lore[0]).toMatchObject({ keys: ['tide', 'court'], alwaysOn: true, priority: 1 });
  });
});

describe('forge prompts', () => {
  it('carries the knowledge, the anchor and how to tie to it', () => {
    const pool = libraryDrafts(lib());
    const anchor = pool.find((d) => d.name === 'Millers Guild')!;
    const m = forgePrompt('character', { wish: '', count: 2, knowledge: knowledge(pool, anchor), anchor });
    expect(m[1]!.content).toContain('# Forge under this entry\n## Faction: Millers Guild');
    expect(m[1]!.content).toContain('set "faction" to "Millers Guild"');
    expect(m[0]!.content).toContain('Exactly 2 characters.');
    expect(anchorLink({ kind: 'location', name: 'Baker City' }, 'location')).toContain('"within" to "Baker City"');
  });
  it('writes a look from a lookalike without naming them, and never shows them to the painter', () => {
    const m = forgePrompt('character', { wish: 'a smuggler', count: 1, knowledge: '', lookalike: 'Buster Keaton' });
    expect(m[0]!.content).toContain('inspired by Buster Keaton');
    const d = parseForgeDrafts('character', '{"name":"Ora","appearance":"Flat hat, stone face."}', { lookalike: 'Buster Keaton' })!;
    expect(d[0]!.fields.lookalike).toBe('Buster Keaton');
    expect(entryImagePrompt({ draft: d[0]!, world: 'Vell' })[1]!.content).not.toContain('Keaton');
  });
  it('surprise grows from hooks; canon keeps what the story said', () => {
    const s = forgePrompt('mixed', { wish: '', count: 4, knowledge: 'K', surprise: { hooks: ['Baker Kingdom has no leader yet.'] } });
    expect(s[1]!.content).toContain('- Baker Kingdom has no leader yet.');
    expect(s[1]!.content).not.toContain('What I want');
    const c = forgePrompt('character', { wish: '', count: 1, knowledge: 'K', canon: { name: 'Ivo', excerpts: ['Ivo spat on the dock.'] } });
    expect(c[1]!.content).toContain('> Ivo spat on the dock.');
    expect(c[0]!.content).toContain('is fact');
  });
});

describe('field reforge', () => {
  it('asks for one value and reads it back by type', () => {
    const d = libraryDrafts(lib()).find((x) => x.name === 'Millers Guild')!;
    const m = fieldForgePrompt({ draft: d, key: 'headquarters', instruction: '', knowledge: '', options: ['The Rye Coast', 'Old Mill'] });
    expect(m[0]!.content).toContain('Exactly one name from this list');
    const def = (k: string) => DRAFT_FIELDS.organization.find((f) => f.key === k)!;
    expect(parseFieldValue(def('headquarters'), 'Headquarters: the old mill', ['The Rye Coast', 'Old Mill'])).toBe('Old Mill');
    expect(parseFieldValue(def('type'), 'Guild.')).toBe('guild');
    expect(parseFieldValue(def('description'), '"A dusty brotherhood."')).toBe('A dusty brotherhood.');
    expect(parseFieldValue(DRAFT_FIELDS.lore.find((f) => f.key === 'keys')!, 'Mill, Stones ,grinding')).toEqual(['mill', 'stones', 'grinding']);
  });
});

describe('newcomers', () => {
  it('drops what is known and finds what the story said about a name', () => {
    expect(parseNewcomers('{"newcomers":[{"name":"Ivo","kind":"character","note":"a dockhand"},{"name":"the Millers Guild","kind":"faction"},{"name":"Salt Gate","kind":"place"}]}', ['Millers Guild'])).toEqual([{ name: 'Ivo', kind: 'character', note: 'a dockhand' }, { name: 'Salt Gate', kind: 'location', note: '' }]);
    expect(excerptsFor('Ivo', ['Rain fell. Ivo spat on the dock. Nobody looked.'])).toEqual(['Rain fell. Ivo spat on the dock. Nobody looked.']);
  });
});

describe('anchors', () => {
  it('fills the tie to the anchor the model left out, but keeps nesting among new places', async () => {
    const { ensureAnchor } = await import('../world/forge');
    const ds = parseForgeDrafts('location', JSON.stringify({ places: [{ name: 'Mill Quarter' }, { name: 'Wheel House', within: 'Mill Quarter' }, { name: 'Far Field', within: 'Elsewhere' }] }))!;
    const out = ensureAnchor(ds, { kind: 'location', name: 'Baker City' });
    expect(out.map((d) => d.fields.within)).toEqual(['Baker City', 'Mill Quarter', 'Baker City']);
  });
});

describe('who a passage names', () => {
  it('matches full names and distinctive first names, not fragments', async () => {
    const { namedIn } = await import('../world/portraits');
    expect(namedIn('Mara Voss lit the lamp.', 'Mara Voss')).toBe(true);
    expect(namedIn('Mara lit the lamp.', 'Mara Voss')).toBe(true);
    expect(namedIn('The maraschino jar.', 'Mara Voss')).toBe(false);
    expect(namedIn('Al waited.', 'Al Brook')).toBe(false);
  });
});

describe('retcon', () => {
  it('renames an entry everywhere it stands, and re-links by the new name', async () => {
    const { renameEdits, applyEdits } = await import('../world/retcon');
    const l = lib();
    l.characters.push(character({ id: 'c2', universeId: 'u1', name: 'Hester Crane', data: { memberships: [{ orgId: 'g', role: 'Guildmaster' }] } }));
    const pool = libraryDrafts(l);
    const guild = pool.find((d) => d.name === 'Millers Guild')!;
    const edits = renameEdits(pool, guild, 'Grinders Guild');
    expect(edits.map((e) => `${e.name}.${e.key}`)).toEqual(expect.arrayContaining(['Millers Guild.name', 'Hester Crane.faction']));
    const plan = planDrafts(applyEdits(pool, edits), l, 'u1');
    expect(plan.entities.find((e) => e.id === 'g')!.name).toBe('Grinders Guild');
    expect(plan.characters.find((c) => c.id === 'c2')!.data.memberships).toEqual([{ orgId: 'g', role: 'Guildmaster' }]);
  });
  it('rewrites mentions in text by whole word only', async () => {
    const { renameEdits } = await import('../world/retcon');
    const pool = libraryDrafts(lib());
    const city = { id: 'x', kind: 'location' as const, name: 'Baker City', fields: {} };
    const e = renameEdits([...pool, city], city, 'Flourhaven').find((x) => x.name === 'Baker Kingdom')!;
    expect(e.after).toBe('Ruled from its capital, Flourhaven, by the Flour Queen.');
  });
  it('keeps only model edits that fit the world', async () => {
    const { parseRetcon } = await import('../world/retcon');
    const pool = libraryDrafts(lib());
    const edits = parseRetcon('{"edits":[{"entry":"Tom Sedge","kind":"character","field":"summary","value":"A carter turned informer."},{"entry":"Nobody","field":"summary","value":"x"},{"entry":"Tom Sedge","field":"wings","value":"x"},{"entry":"Tom Sedge","field":"summary","value":"A carter."}]}', pool);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ name: 'Tom Sedge', key: 'summary', before: 'A carter.', after: 'A carter turned informer.' });
  });
});

describe('picture prompts', () => {
  it('put the art direction and framing in front of the subject, the same way every time', async () => {
    const { composePicture } = await import('../world/forge');
    expect(composePicture('character', 'A grey-eyed woman in oilskins.', { art: 'Ink and wash.' })).toBe('Ink and wash. Portrait, head and shoulders, three-quarter view, eye level, softly blurred background. A grey-eyed woman in oilskins. No text or lettering.');
    expect(composePicture('organization', 'a millstone under a crown', { sigil: 'Woodcut seal' })).toMatch(/^Woodcut seal\. The device: a millstone under a crown\. No text/);
  });
});
