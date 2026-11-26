import { describe, expect, it } from 'vitest';
import { finishCreate, type CreateInput } from '../jobs';
import { approvedIn, concluded, creationKnowledge, creationStatus, decided, entryPrompt, landed, lineOf, lorePrompt, movedOn, newCreation, overviewPrompt, parseCreateReply, reopened, revisePrompt, turnedDown, undone } from '../world/creation';
import type { Draft } from '../world/drafts';

const world: Draft = { id: 'w', kind: 'world', name: 'Low Water', fields: { description: 'A drowned city-state run by salvage guilds.', genre: 'Salt noir', rules: 'The tide keeps accounts.', society: 'Guild law.', art: { look: 'Ink and verdigris' }, calendar: { kind: 'custom', yearLabel: 'AF', startYear: 212, daysPerYear: 360, monthNames: [], start: '2026-01-01T08:00', hoursPerDay: 24 } } };
const lore = (id: string, name: string, text: string): Draft => ({ id, kind: 'lore', name, fields: { category: 'law', keys: [name.toLowerCase()], text, alwaysOn: false } });
const place = (id: string, name: string, fields: Record<string, unknown> = {}): Draft => ({ id, kind: 'location', name, fields: { summary: `${name}, a place`, type: 'city', ...fields } });

const overviewReply = JSON.stringify({ name: 'Low Water', description: 'A drowned city.', genre: 'Salt noir', rules: 'Tide law.', society: 'Guilds.', themes: 'Debt', currency: 'Tally shells', art: { look: 'Ink and verdigris', portraits: 'p', places: 'pl', things: 't', sigils: 's' }, calendar: { kind: 'custom', yearLabel: 'AF', startYear: 212, daysPerYear: 360, monthNames: ['Ebb', 'Flood'] } });
const loreReply = (title: string, extra: Record<string, unknown> = {}) => JSON.stringify({ why: 'Everything else rests on it.', then: ['Salvage rights', 'The drowned dead'], done: false, lore: [{ title, category: 'law', keys: ['tide law'], text: 'What the water takes, the water owns, until a guild buys it back.', alwaysOn: true }], ...extra });
const entryReply = JSON.stringify({ why: 'The city itself comes first.', then: ['The Salt Guild'], places: [{ name: 'Vell', type: 'city', summary: 'The drowned capital', description: 'Roofs like stepping stones.', within: '' }] });

describe('creating a world in stages', () => {
  it('opens with an overview that carries the premise, not the inventory', () => {
    const p = overviewPrompt({ wish: 'a drowned city of salvage guilds' });
    expect(p[0]!.content).toContain('overview');
    expect(p[0]!.content).toContain('"rules"');
    expect(p[0]!.content).toContain('"calendar"');
    expect(p[0]!.content).not.toContain('"factions"');
    expect(p[1]!.content).toContain('drowned city');
    expect(overviewPrompt({ wish: '  ' })[1]!.content).toContain('surprise me');
    const r = parseCreateReply('overview', 'world', overviewReply)!;
    expect(r.draft?.kind).toBe('world');
    expect(r.draft?.name).toBe('Low Water');
    expect((r.draft?.fields.calendar as { startYear: number }).startYear).toBe(212);
  });

  it('writes lore one page at a time from the overview and every page before', () => {
    const pool = [world, lore('l2', 'Salvage rights', 'Second page.'), lore('l1', 'Tide law', 'First page.'), place('p1', 'Vell')];
    const know = creationKnowledge(pool, { order: ['l1', 'l2'] });
    expect(know.indexOf('Tide law')).toBeLessThan(know.indexOf('Salvage rights'));
    expect(know).toContain('First page.');
    expect(know).toContain('A drowned city-state');
    const p = lorePrompt({ knowledge: know, log: [], steer: 'how debts are inherited' });
    expect(p[0]!.content).toContain('one page');
    expect(p[0]!.content).toContain('"done"');
    expect(p[0]!.content).not.toContain('"places"');
    expect(p[1]!.content).toContain('What I want next: how debts are inherited');
    const r = parseCreateReply('lore', 'lore', loreReply('Tide law'))!;
    expect(r.draft?.kind).toBe('lore');
    expect(r.then).toEqual(['Salvage rights', 'The drowned dead']);
    expect(r.done).toBe(false);
  });

  it('hears when the foundations are covered', () => {
    const r = parseCreateReply('lore', 'lore', JSON.stringify({ why: 'A writer has what they need.', then: [], done: true, lore: [] }))!;
    expect(r.draft).toBeNull();
    expect(r.done).toBe(true);
    // A page written anyway wins over the word that it is done.
    expect(parseCreateReply('lore', 'lore', loreReply('Tide law', { done: true }))!.done).toBe(false);
  });

  it('fills the world from the large to the small, one entry of any kind', () => {
    const pool = [world, lore('l1', 'Tide law', 'First page.'), place('p1', 'Vell')];
    const p = entryPrompt({ knowledge: creationKnowledge(pool), pool, log: [{ id: 'x', kind: 'organization', name: 'The Pearl Court', line: 'A court of pearls', decision: 'dropped', stage: 'entries', at: 1 }] });
    expect(p[0]!.content).toContain('from the large to the small');
    expect(p[0]!.content).toContain('"places"');
    expect(p[0]!.content).toContain('"characters"');
    expect(p[1]!.content).toContain('Turned down');
    expect(p[1]!.content).toContain('The Pearl Court');
    expect(p[1]!.content).toContain('Where the world stands');
    const asked = entryPrompt({ knowledge: '', pool, log: [], kind: 'character' });
    expect(asked[0]!.content).toContain('asked for a character');
    expect(asked[0]!.content).not.toContain('"places"');
    const r = parseCreateReply('entry', 'mixed', entryReply)!;
    expect(r.draft?.kind).toBe('location');
    expect(r.draft?.name).toBe('Vell');
    expect(r.why).toContain('city itself');
  });

  it('reworks the entry on the table and keeps who it is', () => {
    const base = { ...world, fields: { ...world.fields } };
    const p = revisePrompt({ draft: base, instruction: 'less medieval', knowledge: '' });
    expect(p[1]!.content).toContain('What should change: less medieval');
    expect(p[1]!.content).toContain('Style bible');
    const reply = JSON.stringify({ name: 'Low Water', description: 'A drowned port run by shipping houses.', genre: 'Salt noir', rules: 'Tide law.', society: 'Houses.' });
    const r = parseCreateReply('revise', 'world', reply, base)!;
    expect(r.draft?.id).toBe('w');
    expect(r.draft?.fields.description).toContain('shipping houses');
    // The calendar was not sent back: it is kept.
    expect((r.draft?.fields.calendar as { startYear: number }).startYear).toBe(212);
    expect(parseCreateReply('revise', 'lore', reply, base)).toBeNull();
  });

  it('walks the session: overview, lore, entries, done', () => {
    let c = newCreation({ id: 'c', model: 'm', now: 0, wish: 'a drowned city' });
    expect(creationStatus(c, { status: 'running' })).toContain('writing the overview');
    c = landed(c, 'overview', parseCreateReply('overview', 'world', overviewReply)!, 1);
    expect(c.pending?.name).toBe('Low Water');
    expect(c.name).toBe('Low Water');
    expect(creationStatus(c)).toContain('Low Water waits');
    // A rework keeps the old version, and can be undone.
    const first = c.pending!;
    c = landed(c, 'revise', { draft: { ...first, fields: { ...first.fields, description: 'Changed.' } }, why: '', then: [], done: false }, 2);
    expect(c.pending?.fields.description).toBe('Changed.');
    expect(c.versions).toHaveLength(1);
    c = undone(c, 3);
    expect(c.pending?.fields.description).toBe('A drowned city.');
    // Approving the overview makes the world and opens the lore.
    c = decided(c, c.pending!, 'approved', 4);
    expect(c.stage).toBe('lore');
    expect(c.universeId).toBe(first.id);
    expect(c.pending).toBeNull();
    c = landed(c, 'lore', parseCreateReply('lore', 'lore', loreReply('Tide law'))!, 5);
    expect(c.then).toHaveLength(2);
    c = decided(c, c.pending!, 'approved', 6);
    c = landed(c, 'lore', parseCreateReply('lore', 'lore', loreReply('The drowned dead'))!, 7);
    c = decided(c, c.pending!, 'dropped', 8);
    expect(approvedIn(c, 'lore')).toHaveLength(1);
    expect(turnedDown(c.log, 'lore')).toContain('The drowned dead');
    c = landed(c, 'lore', { draft: null, why: 'Covered.', then: [], done: true }, 9);
    expect(c.enough).toBe(true);
    expect(creationStatus(c)).toContain('foundations look covered');
    c = movedOn(c, 10);
    expect(c.stage).toBe('entries');
    expect(c.enough).toBe(false);
    c = landed(c, 'entry', parseCreateReply('entry', 'mixed', entryReply)!, 11);
    c = decided(c, c.pending!, 'approved', 12);
    expect(approvedIn(c, 'entries').map((x) => x.name)).toEqual(['Vell']);
    c = concluded(c, 13);
    expect(c.stage).toBe('done');
    expect(creationStatus(c)).toContain('Concluded');
    expect(reopened(c, 14).stage).toBe('entries');
  });

  it('turns a reply into what goes on the table, or says why not', () => {
    const input: CreateInput = { model: 'm', messages: [], maxTokens: 1000, creationId: 'c', mode: 'entry', kind: 'mixed', taken: ['location:vell'] };
    expect(() => finishCreate(input, entryReply)).toThrow(/already has/);
    expect(finishCreate({ ...input, taken: [] }, entryReply).draft?.name).toBe('Vell');
    expect(() => finishCreate(input, 'I would rather chat.')).toThrow(/expected JSON/);
    expect(() => finishCreate(input, JSON.stringify({ why: 'x', done: true }))).toThrow();
    expect(finishCreate({ ...input, mode: 'lore', kind: 'lore' }, JSON.stringify({ why: 'x', done: true, lore: [] })).done).toBe(true);
  });

  it('summarises an entry in a line', () => {
    expect(lineOf(place('p', 'Vell'))).toBe('Vell, a place');
    expect(lineOf(lore('l', 'Tide law', 'x '.repeat(200))).length).toBeLessThanOrEqual(140);
  });
});
