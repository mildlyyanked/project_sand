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

The writer model can invent library entries from a wish. **Forge** on the People and Worlds tabs, and on a world's page for its species, lore and people, asks for what you want and how many, shows the model what the world already holds so new entries fit and avoid repeats, then previews the result for you to prune before saving. A forged world arrives with a description and, where it calls for them, first species and lore. Characters come with a life stage and an adult flag by their species' definition, shown in the preview; everything is editable afterwards.

## Home

Home is three tabs: **Stories**, **Library** (people, voices, worlds) and **Usage**. Usage shows spend today, over the last week and all time, totals for passages, words and tokens, and breakdowns by model (with the refusal ledger), by story and by day, all from the cost OpenRouter reports on every writer request; helper calls are not itemized. With a key saved it also shows what OpenRouter has counted against the key. The build version sits at the foot of Stories and Settings.

While a passage streams, the manuscript follows the writing only until you scroll up; then it stays put and a **Follow the writing** button brings you back to the end.

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
