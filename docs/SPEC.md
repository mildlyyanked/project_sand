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
| Presets | System prompt, assistant prefill, post-history instruction, per-model overrides, and a refusal chain. |
| Refusals | Preset defines a chain: detect refusal → retry with stronger framing → prefill → fallback model. Per-session override. |
| Adulthood | Species define adulthood in their own terms. A character card carries an `adult` flag. An explicit-enabled session requires every attached card to be flagged adult. This is a structural check only; nothing about it is ever injected into the prompt. |
| UX bar | Reading-first manuscript, minimal chrome, one or two taps to anything. Dark theme default. |

## Entities

- **Universe**: name, description, species[], lore entries[], canon events[].
- **Species**: name, adulthood description (free text), notes.
- **Character**: universe?, name, species?, age or life stage (free text), `adult` flag, voice, tells, relationships, limits, preferences, summary for prompt.
- **Style**: point of view, tense, prose density, dialogue ratio, register (clinical / euphemistic / blunt), vocabulary rules, banned phrases, sample passages.
- **Preset**: system, prefill, postHistory, modelOverrides{}, refusalChain[].
- **Session**: title, universe?, style?, preset?, characters[], writer/summarizer/helper models, context strategy config, zdr flag, explicit flag, heat (0-4), current node id, summary cache.
- **Beat** (tree node): session, parent?, role, text, model?, usage, cost, reasoning?, direction? (regen direction), created.
- **Lore entry**: universe, keys[], text, always-on flag, priority.

## Context assembly order

1. Preset system prompt
2. Style card
3. Character cards (attached)
4. Universe description + always-on lore
5. Triggered lore (keyword hits in recent beats)
6. Rolling summary (older beats)
7. Recent beats verbatim (budget-limited)
8. Pending instruction beats (as user messages)
9. Post-history instruction + heat directive
10. Assistant prefill (if any)

## Feature roadmap

Phase 1 (this build): sessions, manuscript, streaming generation, tree history, context inspector, model picker with privacy badges, settings, character/style/preset/universe editors, regenerate-with-direction (free text + optional chips), refusal chain.

Phase 2: guided start wizard, scene generator, duplicate / template / variant with diff note, voice drift indicator (quiet, non-blocking), rewind-and-reweave, multi-model draft race.

Later: continuity checker, character interview, perspective flip, reader mode + EPUB export, timeline view of canon.

## Verification notes

OpenRouter and Expo docs were unreachable from the build sandbox. Parameter names for privacy routing (`provider.data_collection`, `provider.zdr`), usage accounting (`usage.include`), and reasoning (`reasoning`) are from prior knowledge and must be confirmed on first real run. The client isolates them in `src/core/openrouter/request.ts`.
