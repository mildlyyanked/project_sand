# Sand

A mobile-first story writing app on top of OpenRouter. Single user, no server, everything stays on the device.

Read `docs/SPEC.md` for the design and the decisions behind it.

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** on Android. Every native module used here (SQLite, secure store, streaming fetch) ships inside Expo Go, so no custom build is needed to try it.

## Release APK

GitHub Actions builds a signed APK, no Expo account needed.

- **Tag a release:** `git tag v1.0.0 && git push --tags`. The workflow builds, attaches `sand-1.0.0.apk` to a GitHub Release, and generates notes.
- **Manual build:** Actions → *Android release* → *Run workflow*, set a version. With *release* checked (the default) it tags `v<version>` and publishes a GitHub Release; unchecked, the APK only lands in the run's artifacts.

Builds are signed with the keystore in `android-signing/`, committed on purpose so that every build installs over the previous one (see `android-signing/README.md` for what that implies). Repository secrets named `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` take precedence when present.

Version comes from the tag (or the workflow input), and the Android `versionCode` is the run number, so every build is installable over the previous one so every build installs over the previous one. Builds 0.1.0 and 0.2.0 were signed with throwaway keys: uninstall those once before installing 0.3.0 or later.

Local alternative, with Android Studio installed: `npx expo run:android --variant release`.

Web also works for desktop use: `npx expo start --web`.

## First launch

1. Settings → paste your OpenRouter key → **Save & test**.
2. Settings → **Refresh list** to cache the model catalog and the zero-data-retention list.
3. Pick a writer, summarizer and helper model.
4. Back on the home screen, tap **+**.

## Workshop

**+ → Workshop it** opens a conversation with an editor model. Say anything, answer its questions, ask for premises when ready, then keep pushing on them. When it feels settled, **Draft the brief**: the helper compiles the conversation into a title, a premise with its ideas stated outright, the people with rough setups, a world and a voice. Every field is editable. Creating the story adds those people, the world and the style to your library and attaches them to the session; the brief becomes the story's first note.

On the home screen, hold a story for Open, Session settings, Duplicate and Delete.

## How a passage gets written

Every request carries, in order: the voice's writer prompt with craft guidance, the voice card, the character cards, the **brief** (premise, ideas, people, limits; editable in session settings), the world and lore, the rolling summary, the recent passages, and then the ask. When the story has no prose yet the ask is an **opening directive**: start before anything goes wrong, introduce the people who matter, end on the first hint of trouble.

With **Plan before writing** on (the default), the helper first writes a plan of at most 120 words for the passage; the writer is told to follow it. The plan is stored on the beat and shown in the inspector and the beat menu.

**Critique and redo** in a passage's menu has the helper mark up the passage against the brief and the previous passage, then regenerates it with those notes as direction. The original stays one swipe away.

## Prompt structure and iteration

Everything the writer receives is visible in the inspector, in send order, and can be copied as a transcript or as the raw messages array to compare like for like in another chat. The app's own fixed text (default system prompt, opening directive, planner, summarizer, editor, soften step) lives in **Settings → Prompt templates**, editable with reset.

**Prompt lab** (story menu → Prompt lab) hands one piece of the stack to a strong editor model with a goal and an optional reference sample: the voice's writer prompt or post-history, the voice card, or the brief. It returns a revision with a rationale and a change list; you can edit it, test it on the next passage without touching the story, then accept. The writer prompt, post-history and card live on the voice, which is shared across stories: when more than one story uses it, accepting asks whether to **override** it for all of them or **save as a new voice** attached to this story only. Every accepted change records a revision (before and after, with the rationale) that the voice editor shows under **History**, with restore.

Three seeded voices: **Close third, past** and **First person, present** (manuscript voices with the persistent writer prompt and chain) and **Interactive narrator** (second person, present, 180 to 350 words, stop and wait for the writer's move). Settings names the default voice for new stories; the workshop writes a card of its own for each story and inherits the default voice's prompt and chain.

## Persistence (getting past refusals)

A voice's **Persistence** chain runs when a reply looks like a refusal. Each step is applied in order and the passage is retried; later retries carry earlier changes. The seeded voices use **Momentum**, then **Model, auto**, then **Diagnose**: in practice the free prefill and a model switch are what get past refusals, and after that it is better to ask the author than to keep guessing. Every step is still available:

1. **Momentum**: prefill the reply with the last sentence of the manuscript, so the model continues mid-flow instead of judging a request.
2. **Soften**: the helper model rewrites your latest instruction as a quiet author's note in the story's own register. Same content, no imperative.
3. **Two-step**: write only the approach with a small budget, then continue from inside the scene.
4. **Heat**: raise temperature and top-p.
5. **Reframe**: prepend stronger framing to the system prompt.
6. **Model, auto**: retry on the model with the best record in the refusal ledger.
7. **Diagnose**: stop retrying and open the refusal clinic. Existing chains get it placed right after Momentum, so the free prefill gets one try and then you decide. While a retry is running, the footer shows which attempt refused and offers **Diagnose instead**, which stops the chain and takes that refusal to the clinic.

**Refusal clinic.** A conversation with the editor model (Settings → Prompts) about one refusal. It sees the refusal, the model, your instruction, the voice's writer prompt and post-history, the brief, the heat directive, the refusal ledger and the exact request as sent. It says which words most likely tripped the model and why, and proposes up to three concrete edits: the writer prompt or post-history (saved on the voice with a revision), the brief, your latest instruction (rewritten in place), or a one-time direction for the retry. Apply the ones you agree with, push back in the chat, then **Retry**, or retry on another model. The clinic opens on its own once per refusal and keeps its conversation while you move between it and the story, so leaving and returning never re-asks the editor model. It also opens from the banner after any refusal the chain could not get past; the refused text stays on the page until you retry, and the retry replaces it as a sibling.

The ledger counts attempts and refusals per model and shows up as a badge in the model picker, with a **Proven** filter. A voice can also deliver the system prompt as the first user turn and avoid or prefer specific OpenRouter providers.

New stories start explicit with the heat dial fully up. The only gate is structural: every attached character must be flagged adult, and nothing about that check enters a prompt.

Nothing in this chain claims a false identity or authorization; it changes how the request is shaped and where it goes.

## Voices

A voice is one card for everything that shapes the writing: the card the model reads and the way it is driven (writer prompt, post-history, prefill, persistence chain, delivery). Besides point of view, register and banned phrases, the card carries **Influences** (writers to draw on, sent to the writer verbatim) and a **Repetition control** level. The level is applied purely through sampler penalties on the request, never as prompt text, and it leans on presence penalty: frequency and repetition penalties grow with token count and, over a long passage, strip out articles and then punctuation until the prose collapses into one run-on sentence. A guard trims such a tail off a generated passage and says so. The voice check on the manuscript also flags phrases reused from recent passages.

## Composer, drafts and pictures

The composer has three modes. **Write** puts your own prose on the page. **Direct** tells the writer what happens next and lets it write; the sparkle button asks the helper for three possible next moves as tappable chips. **Scene** asks the helper for a scene plan (setting, tension, goal, turn, opening) from an optional wish; you read it, then **Write it**, ask for **Another**, or keep it as a note. Notes remain in the manuscript as before; only Write and Direct add beats directly.

**Extra drafts** (the pill next to the writer model) names up to two more models that write every passage alongside the writer. Their drafts land as siblings of the main passage with a model chip each, so you compare in place and keep whichever you like; the others stay one swipe away.

**Illustrate** in a passage's menu is one tap: the helper turns the passage into an image prompt (strongest moment, people by appearance, medium and light), the image model from Settings paints it, and the picture is saved on device under the passage. Tap it to see it full size, share it, ask for another, or delete it.

OpenRouter's image models come with their providers' filters. **Settings → Illustrations** can point the painter elsewhere: any host that speaks the OpenAI images shape (Venice, Together, fal, a RunPod template, a local server), or a Stable Diffusion web UI (AUTOMATIC1111, Forge, SD.Next) running on your own PC with `--api --listen`, which loads whatever open checkpoint you like. The host key, if any, lives in the secure store next to the OpenRouter key. Perchance's generator has no API, so there is a **Prompt only** mode instead: Illustrate writes the image prompt and shows it with Copy and Share, to paste into Perchance or any generator's page. **Picture prompt** in a passage's menu does the same whatever backend is picked, and a saved illustration's view has Copy prompt too. **Show the prompt before painting** (Settings → Illustrations) stops every Illustrate at the helper's description, editable, with Paint, Copy and Share; when a painter blocks a picture the banner now says so (with the provider's finish reason) and the prompt stays open to trim and paint again, with the story untouched.

## Forge

The writer model invents library entries. Every Forge call first reads the world: the world card, a roster of every name in it, and in full the entries that bear on the request (linked to it, named in it, sharing its keywords), within a budget. New entries link to existing ones by exact name.

- **Forge** on Library → Characters and Worlds, on each tab of a world, and **Grow the world** on its World tab (any mix of places, factions, characters, things, peoples and lore).
- **Surprise me**: no wish needed. The world's loose threads (a faction without a leader or headquarters, a city nobody lives in, an enemy never written, someone a character knows who is not in the library) are offered to the model to pull on.
- **Forge under this** on a place, faction, character, people or lore entry: places inside a place, members or branches of a faction, people and belongings of a character, members of a people, related lore. Each new entry is tied to the one it was forged under.
- **Looks like** (characters): a real person or fictional character whose look inspires theirs. Forge writes the appearance from it in its own words; the name is kept on the character but never sent to the writer or an image model.
- **Preview and edit**: tap any forged entry to open it before saving. Every field is editable and has a sparkle to reforge just that field, with an optional instruction.
- **Links both ways on save**: Baker City forged as the seat of Baker Kingdom becomes the kingdom's headquarters (and is controlled by it); a character whose role in a faction is leader, chief, captain and so on becomes its leader; a thing with an owner goes into their inventory. Older entries whose text already points at a new one get the missing link (a kingdom described as "ruled from Baker City", a character who "lives in Baker City"). What was linked is listed after saving.

Every field of every existing entry (world, place, faction, thing, character, people, lore) has the same sparkle: the model rewrites that field given the entry and what in the world bears on it; reference fields pick from the world's names. Reforged links follow the same two-way rules.

Replies are read leniently (fenced, prefaced, literal newlines inside strings, bare quotes inside strings, trailing commas), and a reply cut off by the length limit keeps every entry that arrived whole, with a note saying so.

## Pictures of the world

Characters get a **portrait**, places a **view**, factions a **sigil**, things and peoples a **picture**, shown large at the head of their page (tap for full size, with Paint again, the prompt, and remove). The helper describes only the subject (appearance, materials, colours, never a lookalike's name); the app puts the world's **art direction** and a fixed framing for the kind in front of it (portraits head and shoulders, three-quarter view; views wide at eye level; objects centred on plain ground; sigils in the world's **sigil style**), so a world's pictures match. Art direction and sigil style live on the world's page (forgeable like any field) with a fallback in Settings → Illustrations; they never reach the writer. Passage illustrations use the same art direction.

Pictures show wherever the entry does: thumbnails in the place, faction and thing trees, avatars in character lists, in every reference picker (leader, home, faction...), on the story's cast and start screens, beside every passage that names a character, on the play strip and in the People tab. When a passage is illustrated, the people it names are described by their appearance, the scene's place by its description, and with an OpenRouter image model their portraits go with the request as references (Settings → Illustrations → Use portraits as references).

## Finding things

Places, factions and things are trees: sub-factions and places inside places fold under their parent, with a count, and open with the arrow. Every list in a world (and the Library's characters, voices and worlds) has a search once it holds more than a handful; a search flattens a tree to its matches, each with the path it sits in. Reference pickers (a faction's leader, a character's home or faction, a place's controller) get a search box once there are more than eight to choose from.

## Retcon

**Retcon** on any place, faction, thing, character, people or lore entry changes what is true about it and carries the change through the world. A new name replaces every mention in every entry's text, every reference by name, keywords, and event titles in the world's timelines. A change in words ("she founded the rival Ash Collective and leads it from the docks") goes to the writer model with the entry and every entry it touches, which proposes field edits wherever the world must change to agree. Every edit is listed, old and new, to untick before anything is saved; saving goes through the same two-way linking as Forge. Stories already written keep their words.

## Canonizing what the story invents

Stories bring in new names. With the Chronicle on, each passage's chronicle also lists named people, places, factions and things the library does not have; any passage's menu has **Find new names** for stories without it. They wait in a bar above the composer: **Canonize** forges the entry from what the story said about it (the sentences that mention it are given as fact), opens it for editing and reforging, and saves it into the world, linked like any forged entry; a canonized character joins the story's cast. **Not now** dismisses a name for that story.

## Worlds

Every story lives in a world. **The real world** is the default and sends nothing to the writer unless you write something on its page, so a blank story there is exactly the old vanilla experience: no extra context, no extra calls, free writing. Stories on the Stories tab are grouped by world, with filter chips once there is more than one.

A world (Library → Worlds) is a template with tabs:

- **World**: description, genre, tone, rules (magic, physics, law), technology, society, themes, currency, and a calendar (the real Gregorian one, or your own year label, month names, days per year and hours per day).
- **Places**: a hierarchy (continent › city › district › room), each with kind, summary, climate, dangers, resources, population, controlling faction, keywords and anything else that fits its kind.
- **Characters**: people with appearance, personality, backstory, goals, fears, secrets, skills, occupation, home place, memberships with roles, attributes, inventory and money, on top of voice, tells, relationships and limits.
- **Factions**, **Things** (objects, artefacts, goods), **Peoples** (species and races with traits, lifespan, adulthood in their own terms, culture, homeland) and **Lore** by category (history, religion, magic, law, custom...).

Forge works on every tab: the writer model invents places within places, factions with headquarters, people with homes and memberships, fitted to what the world already holds.

The writer gets only what the scene calls for: the world card, the place the scene is in with its parents and children, and any place, faction, thing, person, people or lore whose keywords show up in the recent passages, within the **World** budget (context strategy).

### Instances and timelines

An instance is one version of a world: the same people and places, its own history. Every world has a prime instance; add more, or **Fork** one at a moment in its timeline to branch the multiverse there. An instance can say how it differs from the template, and that note goes with every story in it.

Each story keeps an internal clock. Every passage is stamped with the in-world time and place, so undo and branches rewind both. The instance timeline (World page → Instances, or Timeline in a story's menu) holds events from two sources: ones you add by hand, and ones the **Chronicle** records from each story's current branch. Branches you abandoned do not count.

Two switches in a story's settings decide how much of this it uses:

- **Continuity** (free): the writer reads the instance's timeline up to the story's present and what the other stories in the instance have reached, within the **Continuity** budget. Nothing that happened later in world time leaks in.
- **Chronicle** (one cheap helper call per passage): records elapsed time, the place, events with importance and the people involved, and changes, so the timeline fills itself.

The Clock sheet in a story shows the time, lets you type the date and time, shift by an hour or a day, or skip by any duration ("3 days 4 hours"), and lists the story's events. Every number stepper in the app can be tapped to type a value and held to run.

## Playing a character

**Play a character** (from + on Stories, or **Play here** on an instance) puts you inside the world as one of its people. You write what they do or say; the narrator answers as the world, never deciding, speaking or acting for your character.

Play runs on its own rules, built for two things: full immersion, and a hard, satisfying game. Free writing never sees any of them.

### The world simulation

Play runs on a living world by default (story settings → **Engine**: World simulation or Classic). The world is the truth and the prose tells it: each turn is decided first, applied at once, and only then narrated.

- **A map made of the library.** Every location becomes a place joined to the one that contains it, with walking times (a room is a minute from its building, a district a quarter of an hour across). Unvisited places show dim on the **Map**; you learn your district's streets and landmarks as you arrive. Asking the way or exploring adds places that are not in the library yet. Tap any place to walk there; the time passes.
- **People on their rounds.** Library characters sleep at home, work at their faction's seat on a day shift and spend evenings at a haunt; every tavern, inn, shop, market, temple, clinic and workshop has its keeper on duty at their hours, the same person every day. Nobody needs a model call to be somewhere.
- **Crowds with faces.** Every place has a crowd that rises and falls with what it is and the hour (a market at noon holds well over a hundred, a tavern at night thirty). A few faces stand out from it, the same ones for the same place and hour, drawn from names and trades written once for the world. Talk to one and they become a person with a name that sticks, a haunt, and a memory of how you treated them. Thousands of people, almost free.
- **Snappy turns.** The bar above the composer shows where you are, how many are about, the ways out (→ name · minutes), the people here (dot: how they feel about you) and the faces in the crowd, and what the place offers. Taps settle at once by the world's rules, no model call: walk somewhere, wait, rest (a paid bed or your own place rests you properly), work a shift for pay, take a bed, buy the place, pick something up, buy and sell at the counter, store things where you live. Typed actions and all talk go to the **referee**, one cheap helper call that reads the world (everyone and everything with a reference) and answers with the changes it makes, a dice check when the outcome is in doubt (rolled on the phone), and what happens in a line. What changed shows as chips straight away (−12 crowns, + rope, Mara ▼, → The Docks · 4 min, New lead: …), then a short passage streams in.
- **Clear narration.** The narrator gets the turn as decided and a contract: your action lands in the first sentence, people answer in their own voices with the speaker named, and the turn ends on what is in front of you. Plain verbs, one figure of speech at most, 60 to 120 words by default (Brisk 40 to 80, Rich 100 to 170). It may not invent lasting changes: no money, items, arrivals, departures, injuries or places beyond what the turn decided.
- **Talk.** Tap a person (or a face) for **Talk** (Say mode, addressed to them), Ask about…, Give…, Trade (at a counter), Come with me / Part ways, Do…, Open entry, and Canonize for people the world made up. People remember what you did; how they feel shows on their dot and in the sheet.
- **Things to want.** Shops restock each morning with goods priced in the world's money. Paid work at taverns, docks, markets, workshops and offices. Beds by the night. Homes and businesses for sale; a business you own pays out daily, and anything you own (or a room you rent) keeps your things. **Leads** come from people (ask around for work) and from the hidden threads when they surface: a goal, who gave it, where, a reward and sometimes a deadline; they show on the sheet's Leads tab and the map. Standing with factions rises and falls.
- **A world that moves.** People come and go on their rounds while you stay; leads run out of time; a new day restocks shops and pays your businesses; now and then the place does something (a dice game erupts, a patrol passes).
- **Undo-proof.** Each passage keeps the changes its turn made, and the world is snapshotted every dozen passages, so undo, swipes and branches always see the world exactly as it was there. Regenerating a passage tells the same turn again.

The hidden threads, tests of skill, needs and sheet below work the same on the world simulation; the chronicle is not needed there (Record again is classic only). Classic play is described next.

- **The game master's contract** replaces the novelist's default prompt (a voice's own writer prompt stays, overruled on form). Every turn: resolve the action in the first sentence or two, let the world react (people with their own wants, short lines of speech), change something concrete, and hand back at a decision; never list options or ask what you do. Second person, present tense, held to your character's senses and body. The voice keeps its register, vocabulary, influences, banned phrases and samples; its point of view, tense and density give way to the game. **Turn length** (Brisk, Standard, Rich) is set when starting and in story settings.
- **The game master's read**: before the narrator writes, the helper reads the turn: what you are really trying to do, whether it can work and why not, whether it is tested (with Tests of skill on), how the people and things around you answer from their own point of view, and what this turn must change. A plain Continue counts: the world moves on its own. The narrator follows the read without quoting it; regenerating a passage keeps its read and roll.
- **Behind the screen**: at the start the game master prepares three hidden threads rooted in the world and your character (a threat that grows if ignored, a mystery or opportunity, something personal). They surface as signs when they fit, advance as the chronicle sees them move or as time passes without you, and when one lands it becomes an event in the instance's timeline, part of the world whether you were there or not; a strong new hook the story opens becomes a new thread. They live on the sheet, so undo and branches rewind them. The Aims tab has a **Peek behind the screen** for spoilers.

- **Tests of skill**: before the narrator writes, a helper call judges whether the action is risky and which attribute it tests (might, agility, wits, presence, resolve) and how hard. The app rolls a d20 locally, adds the attribute modifier and penalties for wounds, fatigue and despair, and tells the narrator the outcome (triumph, success, success at a cost, failure, disaster) to write to. The roll shows under your action.
- **Needs**: on Survival and Hardcore, energy, food and water run down with in-world time; rest recovers energy and health; starving or going without water hurts. Story difficulty keeps the sheet without the decay. Health at zero puts you down.
- **The sheet**: the status strip shows time, place, money and bars; tap it for Status, Inventory (Use and Drop, with effects), Aims and People (how others feel about you). The Chronicle, always on in play, moves money, items, conditions, aims and relations as the story says, and the Travel sheet moves you between places. Each passage shows what it did to the sheet underneath it ("+60 credits · +transit-scrip wafer"). The narrator is asked to name amounts when money or goods change hands, and the chronicle counts anything that works as money as money, estimating an amount when the story gives none. When the story and the sheet still disagree, **Correct the books** in the Inventory tab adds or takes money and things, and the latest passage's menu has **Record again**.

The world's people, places and timeline inform play just as they inform writing.

## The Lens (experimental)

Every passage has a **Lens** button (Settings → Illustrations → Lens to turn it off). It works on demand: the first time you open it on a passage, the helper marks that passage's points of interest (people, places, things, factions and the small details worth a second look), and they stay saved with the passage, so the names in it become tappable, dotted-underlined, from then on. The drawer slides in from the right:

- **Who's here**: everyone in the scene at that passage, not only those it names (the chronicle keeps a running list of who is present, unnamed people included; without the chronicle, whoever has been named since the scene last moved). Someone only remembered or talked about is not here. It shows with portraits, what they do, who they belong to, and in play how they stand with you; **History here**: timeline events tied to the place and the people.
- **A card per point**, written from the passage, the library entry it is (if it is one), what bears on it and what has happened to it. **Look closer** goes a level down (the coat, the patch on it, the insignia), with breadcrumbs back.
- **Pin** any detail on a card: what the Lens says is a suggestion until pinned; pinned details are fact and reach the writer (or the game master) from the next passage on. Pinned details are listed in the drawer and the story menu.
- **Writing**: Steer continues the story at once with that thing at the fore; Expand into a scene plans a scene around it; Picture paints it with the world's art direction; Canonize makes it a library entry through Forge.
- **Play**: the Lens sees only what your character could perceive or know, and says what they cannot tell yet. Examine, Talk, Ask about it, Take and Go there put the action in your composer (and open the keyboard), to send as a turn (so it costs time and may be tested). Threads behind the screen can leave traces on what you look at; those land on the **Clue board** (story menu, or the drawer's Clues tab). Connect clues and say what you think is going on: the game master judges it against the hidden threads; a theory that hits marks that thread as found out, and from then on the game master rewards what you know and lets the thread react to being discovered.

### Story map

The Lens's **Map** tab (or **Story map** in the story menu) shows the whole story rather than one passage, in both modes:

- **Places**: tap a place to open it (what the library says, Open entry, and Go there in play or Set a scene here when writing); a schematic map, places drawn inside the places that contain them (a tavern inside its city), the scene outlined (**you are here** in play), each with a line on what is going on there and the people in it as small portraits, with a dot for where they stand (in the scene, close by, away). People whose whereabouts are unknown, or who are gone, are listed under **Elsewhere** with where they were last seen.
- **People**: a web of ties with you (in play) or anyone you tap in the middle. Lines run green for warm, red for hostile, thicker the stronger; faint lines are ties between the others. Below it, Open entry, Talk or Find them (play) or Steer (writing), and every tie of the person in the middle: family, romance, friend, ally, work, rival, enemy or debt, how strong, and a few words on it as of now.

It draws at once from the library and, in play, your sheet: the scene's place and its neighbours, everyone's home, how people feel about you, who leads whom, and the ties written on character cards. **Read the story** has the helper redraw it from the story summary, the timeline, who is in the scene and the latest passages, as things stand at the end of the latest one (memories, flashbacks and hearsay are not taken as anyone's present): who has moved where, who met, who fell out, new places and people. In play it shows only what your character knows. The reading is kept with the story; when the story has moved on, the map says so and **Update** catches it up.

## Entry tooltips (play)

When you play a character in a world of your own (not the real world), every place, person, faction, thing, people and lore entry a passage names is underlined where it first appears, by its name, its capitalized "also called" names, or a person's first name when no one else shares it. Tap one for a quick card beside the text: picture, what it is, a line or two from the entry, a few key links (faction and home, who controls a place, a faction's leader and seat, who holds a thing), and how it stands with you: how that person feels about you, or that you carry it. Secrets never show. **Open entry** goes to its page; **Lens** opens the passage's Lens on it. It matches names on the phone, with no model call. Settings → Illustrations → Entry tooltips in play turns it off.

## Home

Home is three tabs: **Stories**, **Library** (characters, voices, worlds) and **Usage**. Usage shows spend today, over the last week and all time, split into writing, pictures (illustrations, portraits, views, sigils) and library work (Forge, reforge, retcon, picture prompts), totals for passages, words and tokens, and breakdowns by model (with the refusal ledger), by story and by day, all from the cost OpenRouter reports on each request; story helper calls (plans, summaries, chronicle) are not itemized, and pictures from your own image host have no price to report. With a key saved it also shows what OpenRouter has counted against the key. The build version sits at the foot of Stories and Settings.

While a passage streams, the manuscript follows the writing only until you scroll up; then it stays put and a **Follow the writing** button brings you back to the end.

Reasoning models sometimes put the whole passage on the reasoning channel when prefilled, leaving the content empty. Empty content would count as a refusal and the prose would show as "thinking", so when a reply has no content beyond the prefill but has reasoning, the reasoning is taken as the passage. A model that spent its whole budget thinking (finish reason `length`) is reported as such instead.

## Background generation

On Android the app runs a foreground service while anything is generating, with a small "Sand" notification, so switching apps does not freeze the process and drop the stream. If a connection still drops mid-reply, the client resumes from the text already received. Allow notifications when asked; the service still works without them, only silently.

## Appearance

Dark by default. Settings → Appearance switches to light or follows the system.

## Development

```bash
npm run typecheck   # tsc
npm test            # vitest, pure logic in src/core
npm run lint        # eslint
```

`src/core` has no React Native imports and holds everything testable: the beat tree, context assembly, the OpenRouter client, the refusal chain, voice drift heuristics and helper prompts. `src/app` is Expo Router screens. `src/db` is SQLite. `src/state` is zustand stores.
