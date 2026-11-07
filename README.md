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

A voice is how the prose reads. Build one from the writers it should sound like: **Write like** takes one or more authors (Kurt Vonnegut, Don DeLillo, Brandon Sanderson), how far to go (**Echo**: a flavor; **Close**: clearly theirs; **Pastiche**: unmistakable), a tone, and optionally a passage to learn from. **Build the voice** has the editor model (or the writer) turn that into rules the writer can follow (sentence shapes, diction, how the narration and dialogue work, what it never does), a one-line **anchor**, the form (point of view, tense, density, dialogue, register), phrases to avoid and two original sample passages, as a proposal to use or dismiss. The rules and samples lead the writer's prompt, and the anchor is said again right before every passage, where it weighs most, so the voice holds from page to page. **Hear it** writes the same test scene in any voice, exactly as the writer gets it: the quickest way to tell two voices apart. Writer prompt, post-history, prefill, persistence and delivery are under **Advanced**.

Characters keep their own voices: each has a **Voice** (how they talk and think) and **Sounds like** (lines they might say). One **inspired by** someone plays like them: the writer is told to carry their manner, rhythm, energy and way of talking (never their lines, catchphrases or story); switch it off to keep the name on the card only. **Write ... from them** writes their personality, voice and lines from the inspiration. Before every passage the writer gets a reminder of every voice in the scene, and a library character who walks into a scene without being in the cast gets their card too. In a story, the **voice pill** under the composer opens **Voices**: the prose voice and everyone in the scene, with **Give a voice** to set who someone plays like and write their voice on the spot.

## Composer, drafts and pictures

The composer has three modes. **Write** puts your own prose on the page. **Direct** tells the writer what happens next and lets it write; the sparkle button asks the helper for three possible next moves as tappable chips. **Scene** asks the helper for a scene plan (setting, tension, goal, turn, opening) from an optional wish; you read it, then **Write it**, ask for **Another**, or keep it as a note. Notes remain in the manuscript as before; only Write and Direct add beats directly.

**Extra drafts** (the pill next to the writer model) names up to two more models that write every passage alongside the writer. Their drafts land as siblings of the main passage with a model chip each, so you compare in place and keep whichever you like; the others stay one swipe away.

**Illustrate** in a passage's menu is one tap: the helper turns the passage into an image prompt (strongest moment, people by appearance, medium and light), the image model from Settings paints it, and the picture is saved on device under the passage. Tap it to see it full size, share it, ask for another, or delete it.

OpenRouter's image models come with their providers' filters. **Settings → Illustrations** can point the painter elsewhere: any host that speaks the OpenAI images shape (Venice, Together, fal, a RunPod template, a local server), or a Stable Diffusion web UI (AUTOMATIC1111, Forge, SD.Next) running on your own PC with `--api --listen`, which loads whatever open checkpoint you like. The host key, if any, lives in the secure store next to the OpenRouter key. Perchance's generator has no API, so there is a **Prompt only** mode instead: Illustrate writes the image prompt and shows it with Copy and Share, to paste into Perchance or any generator's page. **Picture prompt** in a passage's menu does the same whatever backend is picked, and a saved illustration's view has Copy prompt too. **Show the prompt before painting** (Settings → Illustrations) stops every Illustrate at the helper's description, editable, with Paint, Copy and Share; when a painter blocks a picture the banner now says so (with the provider's finish reason) and the prompt stays open to trim and paint again, with the story untouched.

## Forge

The writer model invents library entries. Every Forge call first reads the world: the world card, a roster of every name in it, and in full the entries that bear on the request (linked to it, named in it, sharing its keywords), within a budget. New entries link to existing ones by exact name.

- **Forge** on Library → Characters and Worlds, on a world's Entries tab (for the kind picked), and **Grow the world** on its Workshop tab (any mix of places, factions, characters, things, peoples and lore).
- **In the background**: every forge, reforge and style bible is a job, saved before it runs. Close the sheet, leave the screen or the app: it keeps going (two at a time), and anything cut off by the app closing starts again on the next launch. Results wait in the world's **inbox** (Workshop tab, and the envelope on the world's header) until you add, edit or dismiss each one.
- **Surprise me**: no wish needed. The world's loose threads (a faction without a leader or headquarters, a city nobody lives in, an enemy never written, someone a character knows who is not in the library) are offered to the model to pull on.
- **Grow it** on a place, faction, thing, character, people or lore page (Places inside, Members, People in their life, Belongings, Rivals, Its history...) opens the world's workshop about that entry, with what you asked for: the agent proposes entries tied to it.
- **Inspired by** (characters): a character from a book, film, show or game, or a real person. The character is an original take on them: look, personality and voice are written from the inspiration in this world's terms and the model's own words, never naming them or borrowing their lines or story. On a character page (edit), pick what it shapes (look, personality, voice) and **Write ... from them** proposes those fields. The name stays on the card and never reaches the writer or a painter: scenes get the character as written, which you can read and change, not an imitation of somebody else's story.
- **Preview and edit**: tap any forged entry to open it before saving. Every field is editable and has a sparkle to reforge just that field, with an optional instruction.
- **Typed ties**: forged entries can name their ties (family, partner, friend, mentor, serves, ally, rival, enemy, knows, tied to) with a line of note; they become links both ways. A tie to someone not in the library stays as words on the person.
- **Links both ways on save**: Baker City forged as the seat of Baker Kingdom becomes the kingdom's headquarters (and is controlled by it); a character whose role in a faction is leader, chief, captain and so on becomes its leader; a thing with an owner goes into their inventory. Older entries whose text already points at a new one get the missing link (a kingdom described as "ruled from Baker City", a character who "lives in Baker City"). What was linked is listed after saving.

Every field of every existing entry (world, place, faction, thing, character, people, lore) has the same sparkle: the model rewrites that field given the entry and what in the world bears on it; reference fields pick from the world's names. Reforged links follow the same two-way rules.

Replies are read leniently (fenced, prefaced, literal newlines inside strings, bare quotes inside strings, trailing commas), and a reply cut off by the length limit keeps every entry that arrived whole, with a note saying so.

## Pictures of the world

Each world has one **style bible** (World tab, in edit): **the look** every picture shares (medium, palette, light, texture, influences), and how **portraits**, **places** and **things** are framed within it; **sigils** have their own line, since heraldry is not a painting. Write it yourself, or **Write the bible** / **Refine the bible** has the helper write all five lines at once so they agree (or the sparkle on one line rewrites just that one), in the background, as a proposal to use or dismiss. **Try it on** paints a test of any character, place or faction with the bible as it stands in the edit, beside the pictures already there, and **Keep** makes it their picture. Settings → Illustrations → **Default style bible** fills any line a world leaves empty. On the World tab the bible reads as a mood board: the look as a quote over a collage of the world's pictures, then the portraits as a gallery, places as wide views, things as studies and sigils as a row of seals, each under its line, each opening its entry. The bible never reaches the writer.

Characters get a **portrait**, places a **view**, factions a **sigil**, things and peoples a **picture**, shown large at the head of their page (tap for full size, with Paint again, the prompt, and remove). The helper describes only the subject (appearance, materials, colours, never a lookalike's name); the app puts the bible's look and the framing for the kind in front of it (the bible's line, or by default: portraits head and shoulders, three-quarter view; views wide at eye level; objects centred on plain ground; sigils by the sigil line), so a world's pictures match. Passage illustrations use the same look.

Pictures show wherever the entry does: thumbnails in the place, faction and thing trees, avatars in character lists, in every reference picker (leader, home, faction...), on the story's cast and start screens, beside every passage that names a character, on the play strip and in the People tab. When a passage is illustrated, the people it names are described by their appearance, the scene's place by its description, and with an OpenRouter image model their portraits go with the request as references (Settings → Illustrations → Use portraits as references).

## Entry pages

Every entry reads as a page: its picture (or a small Paint button), kind and type, the name and its line, short facts, then the same sections for every kind (at a glance, look and feel, life, edge, in play), with secrets folded until you tap to read them, and **Connections**: everything it is tied to, grouped by how (inside, contains, lives in, home of, leads, members, seat of, controls, family, ally, enemy, serves, carries, kept at...), each a tap away. Places have a **threat in play** (safe, rough, dangerous, deadly), defined by what it does: how often a walk across the place is interrupted and by what, and whether resting without a bed is safe. It only matters, and is only sent, when playing a character. The pencil opens **edit**: the same fields as editors under the same headings, the picture, its **Ties** (add a tie to anything in the world, pick its type, write how) and the danger zone. **Save** keeps the edit, **Discard** drops it, and leaving with unsaved changes asks. A new entry opens straight into edit.

The fields were consolidated in 0.17: one description for what a place is like (atmosphere, climate, landmarks, ways in), one for its life and trade, a faction's aims and methods, its strength and structure, its image; a thing's powers and history; a people's nature; a character's wants and fears (tells are part of personality). Existing entries were folded into the new fields on first launch, word for word, and free-text allies, enemies and relationships that named someone in the library became typed ties.

## Finding things

A world's **Entries** tab searches every field of every entry, filters by kind, sorts by name, recently changed or most tied, and narrows to what is tied to one entry (tap its tie count). Places and factions are trees: sub-factions and places inside places fold under their parent, with a count, and open with the arrow. Every list in a world (and the Library's characters, voices and worlds) has a search once it holds more than a handful; a search flattens a tree to its matches, each with the path it sits in. Reference pickers (a faction's leader, a character's home or faction, a place's controller) get a search box once there are more than eight to choose from.

## Retcon

**Retcon** on any place, faction, thing, character, people or lore entry changes what is true about it and carries the change through the world. A new name replaces every mention in every entry's text, every reference by name, keywords, and event titles in the world's timelines. A change in words ("she founded the rival Ash Collective and leads it from the docks") goes to the writer model with the entry and every entry it touches, which proposes field edits wherever the world must change to agree. Every edit is listed, old and new, to untick before anything is saved; saving goes through the same two-way linking as Forge. Stories already written keep their words.

## Canonizing what the story invents

Stories bring in new names. With the Chronicle on, each passage's chronicle also lists named people, places, factions and things the library does not have; any passage's menu has **Find new names** for stories without it. They wait in a bar above the composer: **Canonize** forges the entry from what the story said about it (the sentences that mention it are given as fact), opens it for editing and reforging, and saves it into the world, linked like any forged entry; a canonized character joins the story's cast. **Not now** dismisses a name for that story.

## Worlds

Every story lives in a world. **The real world** is the default and sends nothing to the writer unless you write something on its page, so a blank story there is exactly the old vanilla experience: no extra context, no extra calls, free writing. Stories on the Stories tab are grouped by world, with filter chips once there is more than one.

A world (Library → Worlds) is a template with four tabs:

- **World**: description, genre and tone, how the world works (magic, physics, technology), society, themes, currency, the style bible, and a calendar (the real Gregorian one, or your own year label, month names, days per year and hours per day).
- **Workshop**: today's question, the inbox, and the world's agent.
- **Entries**: places (a hierarchy: continent › city › district › room), characters, factions, things, peoples (adulthood in their own terms) and lore, searchable and tied together.
- **Instances**: the versions of the world stories happen in.

### The world's agent

Each world has an agent that owns its forging: a curious co-author that has read everything in the world, keeps a **brief** of what you want it to be (the vision, what you love, what to avoid, decisions made, questions open), and talks it through with you in the world's **workshop**. It asks good questions, offers concrete options, notices contradictions and gaps, aims at what the world is thin on, and never repeats what is there. When the conversation has earned it, it proposes new entries and changes to existing ones, which wait for you to add, edit or dismiss. It reworks what exists too: say you do not like a house, talk through what it should be, and it revises it (renaming it if it needs to) or removes it, and every entry that mentions it is brought in line, the way Retcon does; each touched entry is a change to apply, the removal one to confirm. Replies are written in the background and the conversation is kept: leave and come back. Open it from the Workshop tab, or from **Grow it** on any entry to talk about that entry. The brief is yours to edit too (the page icon in the workshop).

**Today's question**: once a day each world's agent asks one question that would most enrich the world, specific and answerable in a few sentences, never one it asked before. Stories shows one world's question a day, in turn, and each world's Workshop tab shows its own. Answer it and the agent folds the answer into the world: changes to the entries it touches, entries it implies, the brief; or skip it, or ask for another.

The writer gets only what the scene calls for: the world card, the place the scene is in with its parents and children, and any place, faction, thing, person, people or lore whose keywords show up in the recent passages, within the **World** budget (context strategy).

### Chapters and instance memory

In a world of your own, an instance's stories are its **chapters**, in the order they start in the world (Chapter 1, 2, 3, played ones included). Chapters in the same instance are one continuity: what happens in one is remembered in the next, either as **canon** (the world's lore, true in every instance) or as **instance memory** (true only in this version of the world). The real world stays a plain folder, with none of this.

- **The memory keeper** runs at chapter boundaries: when you start the next chapter (from the instance, the world's folder, or **Next chapter** in a story's menu), or when you tap **End chapter: remember it**. One helper call reads the chapter and writes three kinds of record into the instance's memory:
  - a **recap**: what happened, where it was left, what is still open;
  - a record for **each person who mattered**: where they stand now, what they have learned (kept, newest last), how they stand with each other (a new stance replaces the old), and what has changed about them for good (a scar, a title, a secret out). Library characters and people the chapters invented alike, so characters meet again with the same names, memories and grudges;
  - **only in this instance**: the people, places, factions and things the chapter made real that the library does not have. They are kept straight away so the next chapter knows them; canonize any of them later.
- **The next chapter reads it**: *Previously* (the latest chapter in full, older ones down to how they ended, within budget), *Remembered here* (the records of the people the passage is about: the cast and anyone named), and *Real in this instance* (the instance-only entries that come up). The instance timeline keeps working underneath, dated events with Continuity, and the "Other stories" block now only covers stories that have no recap.
- **Reviewing it**: the instance page lists the chapters (with whether each is remembered, or has more written since, and **Remember** to catch it up), *Previously* (tap to read, hold to edit a recap), *People remembered* (edit what someone knows, how they stand, what changed; **Forget**; canonize someone who exists only here), and *Only in this instance* (**Canonize** opens the forge with what the chapters said about it, then drops it from instance memory; **Drop**). Any timeline event can be **made canon**: it becomes a history entry in the world's lore.
- **Next chapter** remembers anything not yet remembered, then starts a story where the instance's clock stands, with the last chapter's voice, models and cast, Continuity and Chronicle on.

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

**The map is the game.** Opening a play story shows the map of where you are, not the manuscript:

- **Every scale, one grid.** Each place has its own map: a room or a ship's deck (a few steps a cell), an area of streets or a market, a city quarter, a whole city, a region (miles a cell), a realm, a world (days a cell), a star system. The map is drawn coarse and abstract on purpose: coloured terrain (floors and walls, roads and paving, buildings, fields, forest, hills, water, sand, snow, open space), the places you can go into as icons with their names, features to deal with (a notice board, an old crane) as diamonds, people as dots (blue: people you know of; grey: faces in the crowd), and you.
- **Laid out by the helper, as you go.** The first time you arrive somewhere, one helper call lays out its map in the world's own terms, keeping every library place that belongs inside it and adding the streets, rooms, villages or planets that make it whole; the rules take over if there is no key or the answer is unusable. Walk off the top of the known world (**Out** when nothing contains where you are) and the helper makes the larger place around it: the region around a city, the continent, the planet, the system. New places live in this play world; canonize the ones you want in the library.
- **Moving.** Tap any cell for what is there and how long it takes to walk; **Walk here** follows the roads, with time passing by distance and scale. Long or dangerous walks can be interrupted (someone wants a word, trouble blocks the way), and that is told. **Go in** walks to a place and enters it, zooming in a scale; **Out** and the breadcrumbs at the top zoom back out to where it stands. **Atlas** lists every place you know, near and far, for travelling straight there. Plain walks go in the journal as a line, with no model call; going in somewhere, arriving somewhere new and anything on the way get a short narrated passage.
- **Talk is where it happens.** **Act** (or Talk, Ask about…, Deal with it, Search here, on a person or a cell) slides the interaction panel up over the map: this stretch of the story and the composer (Do or Say, addressed to whoever you are talking to; **Let it play** lets the world move). Everything consequential goes through it to the referee. New passages bring the panel up so you can read them; put it away to see the map.
- **Less on screen.** The top line shows where you are (tap any level to go out to it), the time, your money and five small bars; the bottom bar has Act, Journal (the full story, with the classic composer), Bag, Leads and Atlas; the card above it shows what the place offers (shop, work, a bed, a sale, your things) and Wait and Rest. Model, drafts and suggestions are left to the story menu and settings in play.

- **A map made of the library.** Every location becomes a place inside the one that contains it, with travel times between them. Unvisited places show dim; out in a city or the country, places come into view as you get near. Asking the way, searching or exploring adds places that are not in the library yet.
- **People on their rounds.** Library characters sleep at home, work at their faction's seat on a day shift and spend evenings at a haunt; every tavern, inn, shop, market, temple, clinic and workshop has its keeper on duty at their hours, the same person every day. Nobody needs a model call to be somewhere.
- **Crowds with faces.** Every place has a crowd that rises and falls with what it is and the hour (a market at noon holds well over a hundred, a tavern at night thirty). A few faces stand out from it, the same ones for the same place and hour, drawn from names and trades written once for the world. Talk to one and they become a person with a name that sticks, a haunt, and a memory of how you treated them. Thousands of people, almost free.
- **Snappy turns.** Taps settle at once by the world's rules, no model call: walk somewhere, wait, rest (a paid bed or your own place rests you properly), work a shift for pay, take a bed, buy the place, pick something up, buy and sell at the counter, store things where you live. Typed actions and all talk go to the **referee**, one cheap helper call that reads the world (everyone and everything with a reference) and answers with the changes it makes, a dice check when the outcome is in doubt (rolled on the phone), and what happens in a line. What changed shows as chips straight away (−12 crowns, + rope, Mara ▼, → The Docks · 4 min, New lead: …), then a short passage streams in.
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

Home is three tabs: **Stories**, **Library** (characters, voices, worlds) and **Usage**. **Stories** shows your three most recent stories, then one folder per world: the real world is a plain folder of stories; any other world opens onto its instances, each a run of numbered chapters with its memory and a button for the next chapter (and **New instance**). Usage shows spend today, over the last week and all time, split into writing, pictures (illustrations, portraits, views, sigils) and library work (Forge, reforge, retcon, picture prompts), totals for passages, words and tokens, and breakdowns by model (with the refusal ledger), by story and by day, all from the cost OpenRouter reports on each request; story helper calls (plans, summaries, chronicle) are not itemized, and pictures from your own image host have no price to report. With a key saved it also shows what OpenRouter has counted against the key. The build version sits at the foot of Stories and Settings.

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
