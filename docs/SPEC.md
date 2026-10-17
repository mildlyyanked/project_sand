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
