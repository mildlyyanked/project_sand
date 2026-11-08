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

- **Universe** (world template): name, description, `isDefault` (the real world), data {genre (genre and tone), rules (how the world works, technology included), society, themes, currency, art (the style bible), calendar}. The style bible is never in the writer's context. Empty default world contributes nothing to the prompt.
- **World entity**: universe, kind (location / organization / item), parent (locations nest), name, summary, keys[], data per kind (see `src/core/world/schema.ts`). Places: type, description, life (who is found there, trade, what can be had), dangers, controlled by, secrets, and in play a threat level (safe, rough, dangerous, deadly: how often a walk is interrupted and by what, whether resting in the open is safe; the referee reads it too). Factions: type, description, image (symbols and how they are seen), aims (goals and methods), structure (size, ranks, resources), leader, headquarters, secrets. Things: type, rarity, value, description, powers, history, held by, kept at, effects.
- **Species**: name, adulthood description (free text), data {lifespan, appearance, nature (temperament, gifts, weaknesses, needs), culture, homeland}.
- **Character**: universe?, name, species?, age or life stage (free text), `adult` flag, voice, relationships (other ties: people not in the library), limits, preferences, summary for prompt, data {occupation, inspiredBy and inspire (who they are an original take on, and whether it shapes look, personality and wants, voice; the name is never sent to the writer or a painter), appearance, personality (tells included), backstory, skills, drives (wants and fears), secrets, home, memberships, attributes, inventory, money, image}.
- **Entry picture**: `data.image` {uri, prompt, model, at} on characters, places, factions, things and peoples.
- **Lore entry**: universe, category, keys[], text, always-on flag, priority.
- **Link** (migration 12): universe, from, to, type (family, partner, friend, mentor, serves, ally, rival, enemy, knows, tied), note. Typed ties between any two entries, read both ways (`src/core/world/links.ts`). Ties that already live in fields (inside, controls, seat, leads, member, holds, kept at, home, homeland, people) are derived, never stored, so each has one source of truth. `edges` builds the whole graph; entry pages, search, tooltips, the story map and the writer's context read it.
- **Style bible**: `WorldData.art` {look, portraits, places, things, sigils}. Every picture starts from the look; portraits, places and things are framed by their line (or the default framing); sigils follow their own. The World tab shows it as a mood board: the look as a quote over a collage of the world's pictures, then portraits, places, things and sigils, each under its line. Settings holds the app's bible, used line by line where a world's is empty.
- **Instance**: universe, name, notes (how it differs), isPrime, forkedFrom?, forkAt?.
- **World event**: instance, session?, beat?, at (minutes from the calendar start), title, text, kind, importance 1-3, refs to entities/characters. Canon = manual events + events on each story's current branch.
- **Style** (voice): point of view, tense, prose density, dialogue ratio, register (clinical / euphemistic / blunt), vocabulary rules, banned phrases, sample passages; plus system, prefill, postHistory, modelOverrides{}, refusalChain[], systemAsUser, providerIgnore[], providerOrder[].
- **Session**: title, universe, instance, mode (writer / pov), world {continuity, chronicle, newcomers[], dismissed[]}, clockStart, pov {characterId, difficulty, checks, startLocation}?, style?, characters[], writer/summarizer/helper models, draftModels[], context strategy config (incl. world and continuity budgets), zdr flag, explicit flag (on by default), heat (0-4), current node id, summary cache, brief, planFirst.
- **Illustration**: session, beat?, prompt, file uri, model.
- **Beat** (tree node): session, parent?, role, text, model?, usage, cost, reasoning?, direction? (regen direction), created, at? (in-world minutes), state? {location, pov sheet}.

## Drafts and Forge

Every library kind converts to a **draft**: a flat record of fields with references held as names (`src/core/world/drafts.ts`). Forge parses replies into drafts, the draft editor edits them, existing entries convert to drafts so the model can read them (`knowledge`: world card, roster, relevant cards within a budget), and `planDrafts` turns drafts into rows: names resolve against the world and the batch, own references first, then links on the other side (seat of → headquarters, leader role → leader, owner → inventory), then older entries whose text names a new one (headquarters, leader, home, controlled by). Field reforge edits one draft field and goes through the same plan. Prompts live in `src/core/world/forge.ts`. Drafts carry their typed ties by name ({to, type, note}); the plan resolves them to any kind of entry and adds the links (never deletes them); a tie to someone not in the library stays as words on a person. An edit that leaves a field out keeps it. Forge's JSON shapes are built from the same field definitions the editors show (`entryShape`), so the two never drift.

## Library upgrade (0.17)

Fields were consolidated: a place's atmosphere, climate, features and travel fold into its description; population, services and resources into life; a faction's goals and methods into aims, size, ranks and resources into structure, symbols and reputation into image; a thing's properties into powers, origin into history; a people's traits, abilities, weaknesses and needs into nature, notes into culture; a character's goals and fears into drives, tells into personality; a world's tone into genre, technology into rules, and art direction, sigil style and portrait direction into the style bible. `src/core/world/upgrade.ts` does it once on start (`src/db/upgrade.ts`, flagged in `meta`), word for word, labelled where a label carries meaning, and reads free-text ties (allies, enemies, relationships, relations) into typed links; what names no one in the library stays as text. Forge replies in the old shape are folded the same way.

## Entry pages

Every entry (place, faction, thing, character, people, lore, and the world itself) reads as a page: kind and type, the name, a lede, short facts, then the same sections for every kind (at a glance, look and feel, life, edge, hidden, in play), secrets folded until asked for, and connections grouped by how they tie, each a tap away. Edit opens a buffer: Save writes it with its ties, Discard drops it, and leaving with unsaved changes asks. Reforge in edit mode fills the buffer. The world hub has six tabs: World (today's question, then the world), Map (its atlas), Style (the style bible as a mood board, edited in place), Workshop (inbox, the agent), Entries (search over every field, filter by kind, sort by name, recent or most tied, narrow to what is tied to one entry, places and factions as trees) and Instances.

## Background jobs and the inbox

Forge, reforge, style bible writing, the agent's replies and its question of the day run as jobs (`src/core/jobs.ts`, runner `src/state/jobs.ts`, table `jobs`). A job is saved before it runs and after every change; two run at a time, each kept alive by the foreground service on Android; on start, jobs cut off by the app closing go back in the queue. Results wait undecided in the inbox (`src/app/inbox.tsx`, every world, waiting first; the envelope on the Stories, Library, world and workshop headers): each proposal can be opened, edited, added on its own or with the rest, or dismissed (`src/state/proposals.ts`). Entries accepted earlier from the same job have their links read again with each later accept. A change to an existing entry is laid on the entry as it is now, field by field.

## World agent

Each world has an agent (`src/core/world/agent.ts`, `src/state/agent.ts`; tables `agent`, `workshop`): a curious co-author that owns its forging. It keeps a brief of what the writer wants (vision, what they love, what to avoid, decisions, open questions), reads the world's knowledge and coverage (counts, what is missing, thin entries, entries tied to no one, loose threads) so it never repeats what exists, and talks in a persistent thread. A reply is prose, then optionally a JSON block with an updated brief, proposals (new entries in forge's shape) and changes (one field of an existing entry). Opened from an entry ("Grow it" on any page), the conversation is about that entry, with what the writer wants from it. Today's question: one question a day per world, aimed at what is thin or full of tension, never one already asked; it sits at the top of the world's World tab; answering sends it to the agent, which folds it into the world. Content rules are never injected: the agent sees the world as the writer made it.

## Menus (0.20)

The premise workshop is retired (`/new` removed). The Library is Worlds and Voices; characters live in their world's Entries, and characters of no world in the real world's (`loadLibrary` includes them when the world is the default). The inbox is its own screen, reachable from every top header.

## Maps (0.20)

One map per place (table `maps`, `src/db/repo/atlas.ts`; model in `src/core/map/types.ts`). The kind follows the place type (`mapKindOf`: globe, region, city, site, floor); the style follows the world (`themeFor` over genre, rules, themes, description, art look) or the map of the place above. Drawing is a `map` job: the model writes a plan in numbers on a 100 × 70 grid (`src/core/map/plan.ts`: features as boxes or point lists, places, labels, sea side, how far it reaches), told that the entries are the truth; `buildMap` (`src/core/map/build.ts`) gives it shape deterministically from a seed and fills whatever the plan leaves out, so a map can be drawn without a model (quick sketch). Every place inside gets a pin, matched by name; unmatched children go to free spots where they can stand (in a district, a room, on land). A first map is saved on the place; a redraw is a proposal. The model also judges the kind of map and its size from the description (a school the size of a city is a city plan kilometres across), unless the person fixed the kind. Editing is pure (`src/core/map/edit.ts`: hit test, vertices, moves, undo history); rendering is SVG (`src/ui/map/MapCanvas.tsx`, many small shapes merged into one path). The viewer (`MapView.tsx`) draws only the part of the map on screen (plus a margin) at screen resolution, and draws it again when a gesture ends, so it is sharp at any zoom; during a gesture the last drawing is moved and scaled. Line widths grow with the square root of the zoom. Words are placed per zoom in screen pixels (`src/core/map/labels.ts`): names belong to what they name (an area's name in the area, a river's along it, a pin's beside it, trying four sides), stay on screen, and give way by priority when they collide (selected, cities, large areas, towns, free labels, small areas, lines); stored labels that only repeat a name are dropped on load. The scale bar and north arrow are fixed on screen. Model calls stop after 150 seconds with no word from the model, and a job shows its thinking as it goes. The screen and editor are in `MapScreen.tsx`. Distances: straight across on flat maps, great-circle on globes (`src/core/map/geo.ts`); `whereLines` gives the writer, in the place layer, how far and which way the nearest pins are from the scene's place on the maps of its two nearest parents, with time on foot. Deleting a place deletes its map and unlinks its pins elsewhere.

## Inspired by (0.18)

A character can be an original take on someone from other media, or a real person. The inspiration is written into the character, not referenced: forge, reforge and **Write ... from them** (an `inspire` job) carry over the look, the temperament, wants and fears, and the voice, translated into the world and never naming the source, quoting its lines or bringing in its story. Scenes get the character as written; the name stays on the card. A name in the writer's context invites imitation of the source (its catchphrases, plot and world) and cannot be reviewed or edited; the written bio can. 0.18 turned each lookalike into an inspiration that shapes only the look.

## Reworking existing entries (0.18)

The world agent can revise an entry (what is now true, and a new name if it needs one) or remove it, once it has worked out with the writer what they want. Each runs through Retcon: a rename rewrites every mention by rule, and the writer model rewrites whatever else the change makes untrue (or, for a removal, every entry that mentions or points at it). Every touched entry becomes one change proposal; a removal is a proposal of its own and deletes the entry, with its ties, when accepted; an accepted rename also renames it in the timelines.

## Voices that hold (0.19)

A voice (`Style.voice`, migration 13) is built from the writers it sounds like: authors, a strength (echo, close, pastiche) and a tone. A `voice` job has the editor model write it as rules the writer can follow (sentences, diction, narration, dialogue, structure, humor, never), a one-line anchor, the form, phrases to avoid and two original sample passages on fixed neutral situations (`src/core/voice.ts`). The style card leads with who and how far, then the rules, and says the voice wins over the model's own habits; the anchor is said again at the end of the prompt, right before the passage. A `hear` job writes the same fixed scene in any voice, exactly as the writer gets it, so voices can be compared. Older voices' influences line is read as the authors. The app ships a gallery of thirteen built voices (`src/core/voiceGallery.ts`), each with one original sample on the same scene; adding one saves it under a stable id (`gallery-<key>`), so it is added once.

Characters keep their voices the same way: a voice in rules, "Sounds like" lines, and, when they are inspired by someone, a performance note ("plays like ... their manner, rhythm, energy and way of talking; never their lines, catchphrases, name or story"), on unless switched off. Before every passage the writer is reminded of every voice in the scene: those named in the last passage first, then the recent ones and those present, the cast when nothing names anyone. People of the world who are not in the cast but are named in the scene get their character card too ("Also in the scene"), so a side character who walks in keeps their voice. The story's Voices sheet (the voice pill under the composer) shows the prose voice and everyone in the scene, and gives anyone a voice on the spot.

## Newcomers in long scenes (0.19)

The chronicle asks for newcomers first, so a reply cut short in a long scene loses the scene's other lists before its new names; if the reply still never got to them, a separate newcomers pass runs. Helper JSON calls get 8000 tokens, and once more 16000 when a thinking model spent all of it thinking.

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

## Chapters and instance memory

`src/core/world/memory.ts` (RN-free): `Recap`, `PersonMemory` (key: library id or `n:` name; now, knows, relations, changes, seen), `InstanceEntry`; `keeperPrompt`/`parseKeeper` (recap, people, newcomers), `mergePeople` (now replaces, knows and changes accumulate deduplicated, a relation replaces the one with the same person), `freshEntries`, `chapterOrder` (clockStart, then createdAt), `renderPreviously`/`renderPeople`/`renderEntries` within budgets, `chapterText`. Storage: `memory` table (migration 11; kinds recap, person, entry), `src/db/repo/memory.ts`. `src/state/memory.ts`: `memoryApplies` (non-default world, an instance, not a template), `keepChapter`, `staleChapters`, `memoryContext` (only chapters before this one), `newChapter`, `canonizeEvent` (to a history lore entry), `dropEntry`. `buildWorldContext` adds `memory`; the assembler pushes `previously`, `remembered` and `instance` layers after continuity; siblings with recaps are left out. The real world never gets any of it. UI: Stories tab folders, `src/app/stories/[world].tsx`, chapters and memory on the instance screen, End chapter / Next chapter in the story menu. Portrait direction: `WorldData.portraitStyle`, `ArtDirection.portrait` (portraits use it in place of the art direction's framing), `portraitDirectionPrompt`, `src/ui/components/PortraitDirection.tsx`.

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

Phase 4 (library): consolidated fields, typed links, a style bible per world, entry pages with view and edit, background jobs with an inbox, a world agent with a workshop and today's question.

Phase 5 (world builder): a map for every place, drawn by model and procedure, fully editable, feeding distances and directions to the writer.

Later: continuity checker, character interview, perspective flip, reader mode + EPUB export.

## Verification notes

OpenRouter and Expo docs were unreachable from the build sandbox. Parameter names for privacy routing (`provider.data_collection`, `provider.zdr`), usage accounting (`usage.include`), and reasoning (`reasoning`) are from prior knowledge and must be confirmed on first real run. The client isolates them in `src/core/openrouter/request.ts`.
