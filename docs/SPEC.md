# Sand — spec (confirmed 2026-09-21)

Mobile-first story writing app on top of OpenRouter. Single user, everything on device.

## Decisions

| Area | Decision |
|---|---|
| Platform | Expo (React Native), Android first. Web build kept working for desktop use. |
| Storage | SQLite on device (`expo-sqlite`). OpenRouter key in the OS secure store. No server. |
| Writing surface | Manuscript with beats. A beat is `prose`, `instruction`, or `note`. Only prose is the story. Instructions steer the model and never enter the manuscript. |
| History | Every generation is a node in a tree. Regenerate makes a sibling, edit makes a child, undo/redo walk the tree. |
| Privacy | Every request sends `provider.data_collection: "deny"`. A per-session ZDR toggle adds `provider.zdr: true`. Model picker shows a privacy badge. |
| Context | Layered by default: rolling summary of older beats, keyword-triggered lore, last N beats verbatim. Per-session override. Context Inspector shows every layer and its token estimate before sending. |
| Models | Three slots per session: writer, summarizer, helper. Swappable any time. Model used is recorded on every beat. |
| Voices | One card per voice: how the prose reads (point of view, tense, register, banned phrases, samples) and how the writer is driven (system prompt, assistant prefill, post-history instruction, per-model overrides, refusal chain, delivery). Shared across stories. |
| Refusals | The voice defines a chain: detect refusal → momentum prefill → fallback model → diagnose (open the refusal clinic, a conversation with the editor model that proposes edits to prompt, brief or instruction and retries). Soften, two-step, heat, reframe and prefill steps remain available. |
| Drafts | A story can name up to two extra models that write every passage alongside the writer; they land as siblings, compared by swiping in place. |
| Illustrations | One tap on a passage: the helper describes its strongest moment as an image prompt, an image model paints it, the file is stored on device under the passage. |
| Adulthood | Species define adulthood in their own terms. A character card carries an `adult` flag. An explicit-enabled session requires every attached card to be flagged adult. This is a structural check only; nothing about it is ever injected into the prompt. |
| UX bar | Reading-first manuscript, minimal chrome, one or two taps to anything. Dark theme default. |

## Entities

- **Universe** (world template): name, description, `isDefault` (the real world), data {genre, tone, rules, technology, society, themes, currency, artStyle, sigilStyle, calendar}. Art direction and sigil style are never in the writer's context. Empty default world contributes nothing to the prompt.
- **World entity**: universe, kind (location / organization / item), parent (locations nest), name, summary, keys[], data per kind (see `src/core/world/schema.ts`).
- **Species**: name, adulthood description (free text), notes, data (traits, lifespan, culture, homeland...).
- **Character**: universe?, name, species?, age or life stage (free text), `adult` flag, voice, tells, relationships, limits, preferences, summary for prompt, data {appearance, lookalike (never sent to the writer or a painter), personality, backstory, goals, fears, secrets, skills, occupation, home, memberships, attributes, inventory, money, image}.
- **Entry picture**: `data.image` {uri, prompt, model, at} on characters, places, factions, things and peoples.
- **Lore entry**: universe, category, keys[], text, always-on flag, priority.
- **Instance**: universe, name, notes (how it differs), isPrime, forkedFrom?, forkAt?.
- **World event**: instance, session?, beat?, at (minutes from the calendar start), title, text, kind, importance 1-3, refs to entities/characters. Canon = manual events + events on each story's current branch.
- **Style** (voice): point of view, tense, prose density, dialogue ratio, register (clinical / euphemistic / blunt), vocabulary rules, banned phrases, sample passages; plus system, prefill, postHistory, modelOverrides{}, refusalChain[], systemAsUser, providerIgnore[], providerOrder[].
- **Session**: title, universe, instance, mode (writer / pov), world {continuity, chronicle, newcomers[], dismissed[]}, clockStart, pov {characterId, difficulty, checks, startLocation}?, style?, characters[], writer/summarizer/helper models, draftModels[], context strategy config (incl. world and continuity budgets), zdr flag, explicit flag (on by default), heat (0-4), current node id, summary cache, brief, planFirst.
- **Illustration**: session, beat?, prompt, file uri, model.
- **Beat** (tree node): session, parent?, role, text, model?, usage, cost, reasoning?, direction? (regen direction), created, at? (in-world minutes), state? {location, pov sheet}.

## Drafts and Forge

Every library kind converts to a **draft**: a flat record of fields with references held as names (`src/core/world/drafts.ts`). Forge parses replies into drafts, the draft editor edits them, existing entries convert to drafts so the model can read them (`knowledge`: world card, roster, relevant cards within a budget), and `planDrafts` turns drafts into rows: names resolve against the world and the batch, own references first, then links on the other side (seat of → headquarters, leader role → leader, owner → inventory), then older entries whose text names a new one (headquarters, leader, home, controlled by). Field reforge edits one draft field and goes through the same plan. Prompts live in `src/core/world/forge.ts`.

## Spend ledger

`spend` (migration 8) books what is not a writer passage: kind `image` (illustrations, entry pictures; cost from OpenRouter's `usage.cost`, null from other hosts) and `library` (Forge, reforge, retcon, picture prompts). Usage adds it to the writer's beats.

## Retcon

`src/core/world/retcon.ts`: `renameEdits` rewrites a name in every text field (whole word), keyword list and reference by name; `retconPrompt`/`parseRetcon` have the writer model propose field edits on the entries a described change touches (validated against the world and the field schema); `mergeEdits` and `applyEdits` produce drafts that go through `planDrafts`. Event titles and text are renamed in the world's timelines.

## Play (POV) game master

`src/core/world/gm.ts`. Play only, never free writing: `gmContract` (system layer `gm`; replaces the default craft prompt, a voice's own prompt stays; the voice card is rendered for texture only), `gmReadPrompt`/`parseGmRead` (the per-turn read, folded with the referee: intent, feasibility, optional check, the world's reaction, what changes, a thread to touch), threads (`seedThreadsPrompt`, `applyThreadUpdates`; stored on `PovState.threads`, seeded once into the tip beat or `session.pov.threads`, advanced by the chronicle, closed threads become timeline events), `TurnLength` on `PovSettings`.

## World simulation (play)

`src/core/sim/`, RN-free. `types.ts` (Place, Actor, Thing, Lead, SimState, Kit, SimOp, SimAction, TurnRecord). `kit.ts` (venue from name and type; crowd sizes, roles, shop categories, work and ambient tables; the per-world kit prompt). `seed.ts` (`seedWorld` from the library: places joined to parents, staff for staffed venues, shop stock, homes for sale; `mergeLibrary` for entries added later). `crowd.ts` (`whereIs` from the clock: home, shift, haunt, overrides; `crowdAt`, `facesAt` seeded per place and two-hour block). `ops.ts` (`applyOps`: validates and applies ops, returns chips, facts for the narrator, timeline events and the resolved ops; `route`, `nearbyPlaces`). `actions.ts` (tapped actions settled by rules). `tick.ts` (day rollover: restock, income, beds; lead deadlines; comings and goings; ambient). `referee.ts` (scene with refs, one helper call for typed actions and talk, dice branches). `narrate.ts` (contract, scene for the narrator, the turn brief). `turn.ts` (`settle`, `runTurn`, `replay`). Passages keep `SceneState.sim` (ops, chips, facts, the brief); `sim_snap` (migration 10) keeps whole worlds at 'root', at the passage a classic story converted, and every 12 passages; `src/state/sim.ts` `simAt` rebuilds the world for any path from the nearest snapshot. The kit lives on `PovSettings.kit`, the engine on `PovSettings.engine`. Context: the `gm` layer carries the sim contract, a `scene` layer the scene, the tail the turn; threads stay with the referee. Play only; free writing is untouched.

### Map play

`src/core/sim/grid.ts`: scales (interior, site, quarter, city, region, realm, world, system; size and minutes a cell), terrain characters and pass costs per scale, `Level` (cells string, entry, features), layouts as base/areas/lines/spots/features from `layoutPrompt` (modes inside and around), `parseLayout`, `rasterize` (spots nudged apart and onto open ground, everything carved reachable from the entry), `fallbackLayout`, `findPath` (8-way), `positions` (seeded per person and two-hour block), `whereLine`. `src/core/sim/map.ts`: `MapAction` (walk, enter, leave, travel, look), `mapNeeds` (maps to lay out first), `resolveMap` (encounter roll on walks; narrate flag). Ops `level`, `parent`, `step`, `enter`, `leave`; `place` can land on the player's cell. `Place.x/y/level`, `SimState.pos`. `state/sim.ts` `planMapTurn` lays out what is needed (helper call or fallback), settles the move and runs the turn; `session.mapAct` logs plain moves as `note` beats (kept by replay, left out of the writer's context) and hands narrated ones to `generate({ planned })`. UI: `src/ui/components/Play.tsx` (map, cell card, here card, bar, interaction panel); the story screen shows it in play on the simulation, with the Journal (the manuscript) one tap away.

## Lens

`src/core/lens.ts` (prompts, parsing, inline segments, pins), `src/state/lens.ts` (store), `src/ui/components/Lens.tsx` (drawer). Points and cards are stored per passage in `lens` (migration 9). Pins (`session.world.pins`) are canon: a `pins` context layer in both modes. Clues (`session.world.clues`) carry their thread name hidden; a hit on the clue board sets `Thread.suspected`, which the game master's threads layer rewards.

### Story map

`src/core/storymap.ts`: `baseMap` (no model: the scene's location chain, neighbours and rooms, homes; presence from the latest passages; ties from POV relations, character `relationships` text and faction leaders), `mapPrompt`/`parseMap` (helper redraw, perception-limited in play; "you" resolves to the player), `placeTree`, `unplaced`, `tiesOf`, `webOrder`, and `ring`/`line` geometry for the web (lines are rotated views, no SVG). Who is in the scene: the chronicle returns `present` (everyone physically there at the end of the passage, carried from `SceneState.present` before it, never the remembered), stored on `SceneState.present`, shown to the writer as "Also in the scene" in the place layer and added to the lore scan; `src/core/world/presence.ts` `inScene` reads it, or without the chronicle counts those named since the scene last moved. The map reading and Lens cards get the rolling summary, timeline (with times) and presence, and are told to keep the present apart from memories. The helper's map is stored on `session.world.map` with the passage it was read at; nothing reaches the writer or the game master. UI: `src/ui/components/StoryMap.tsx`, the Lens drawer's Map tab.

## Entry tooltips

`src/core/world/mentions.ts`: `findMentions(text, drafts)` (first naming of each entry, case as written, whole words, a "The" name needs its article unless it is several words, ambiguous needles dropped, longer names win) and `entryTip(draft, {pov, currency})` (open fields only, never secrets; relation and inventory from the sheet). Shown only in play in a non-default world, setting `entryTips`; `segments` weaves the links around Lens points. `src/ui/components/EntryTip.tsx` draws the card. No context or prompt changes.

## Vanilla guarantee

A story in the default world, writer mode, Continuity and Chronicle off, with an empty real-world card, assembles exactly the messages it did before worlds existed and makes no extra calls (`assemble.test.ts` asserts this).

## Context assembly order

1. Voice system prompt (or the default template)
2. Voice card
3. Character cards (attached; in play the player's card is tagged)
4. World card + always-on lore (skipped for an empty default world)
5. Current place with parents and children
6. Triggered world elements (keyword hits in recent beats; world budget)
7. Triggered lore
8. Continuity: instance timeline up to now, sibling stories' progress (continuity budget)
9. Rolling summary (older beats)
10. Play: the player's sheet, survival notes, the check result and the narrator contract
11. Recent beats verbatim (budget-limited)
12. Pending instruction beats (as user messages)
13. Post-history instruction + heat directive
14. Assistant prefill (if any)

The app, not the model, keeps the books: dice, decay, clock and sheet are pure functions in `src/core/world/`; helper calls (referee, chronicle) only propose JSON that the app applies.

## Feature roadmap

Phase 1 (this build): sessions, manuscript, streaming generation, tree history, context inspector, model picker with privacy badges, settings, character/voice/universe editors, regenerate-with-direction (free text + optional chips), refusal chain.

Phase 2: guided start wizard, scene generator, duplicate / template / variant with diff note, voice drift indicator (quiet, non-blocking), rewind-and-reweave, multi-model draft race.

Phase 3 (worlds): world templates with places, factions, things, peoples, lore; instances with timelines; story clocks; continuity and chronicle; POV play with checks and survival.

Later: continuity checker, character interview, perspective flip, reader mode + EPUB export.

## Verification notes

OpenRouter and Expo docs were unreachable from the build sandbox. Parameter names for privacy routing (`provider.data_collection`, `provider.zdr`), usage accounting (`usage.include`), and reasoning (`reasoning`) are from prior knowledge and must be confirmed on first real run. The client isolates them in `src/core/openrouter/request.ts`.
