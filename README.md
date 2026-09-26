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

Every request carries, in order: the preset's system prompt with craft guidance, the style card, the character cards, the **brief** (premise, ideas, people, limits; editable in session settings), the world and lore, the rolling summary, the recent passages, and then the ask. When the story has no prose yet the ask is an **opening directive**: start before anything goes wrong, introduce the people who matter, end on the first hint of trouble.

With **Plan before writing** on (the default), the helper first writes a plan of at most 120 words for the passage; the writer is told to follow it. The plan is stored on the beat and shown in the inspector and the beat menu.

**Critique and redo** in a passage's menu has the helper mark up the passage against the brief and the previous passage, then regenerates it with those notes as direction. The original stays one swipe away.

## Prompt structure and iteration

Everything the writer receives is visible in the inspector, in send order, and can be copied as a transcript or as the raw messages array to compare like for like in another chat. The app's own fixed text (default system prompt, opening directive, planner, summarizer, editor, soften step) lives in **Settings → Prompt templates**, editable with reset.

**Prompt lab** (story menu → Prompt lab) hands one piece of the stack to a strong editor model with a goal and an optional reference sample: the preset's system prompt or post-history, the style card, or the brief. It returns a revision with a rationale and a change list; you can edit it, test it on the next passage without touching the story, then accept. Accepting records a revision (before and after, with the rationale) that preset and style editors show under **History**, with restore.

Two seeded starting points: **Persistent** (third-person manuscript, planning on) and **Interactive narrator** with the **Literary, controlled** style (second person, present, 180 to 350 words, stop and wait for the writer's move).

## Persistence (getting past refusals)

A preset's **Persistence** chain runs when a reply looks like a refusal. Each step is applied in order and the passage is retried; later retries carry earlier changes. The seeded **Persistent** preset uses, in order:

1. **Momentum**: prefill the reply with the last sentence of the manuscript, so the model continues mid-flow instead of judging a request.
2. **Soften**: the helper model rewrites your latest instruction as a quiet author's note in the story's own register. Same content, no imperative.
3. **Two-step**: write only the approach with a small budget, then continue from inside the scene.
4. **Heat**: raise temperature and top-p.
5. **Reframe**: prepend stronger framing to the system prompt.
6. **Model, auto**: retry on the model with the best record in the refusal ledger.

The ledger counts attempts and refusals per model and shows up as a badge in the model picker, with a **Proven** filter. Presets can also deliver the system prompt as the first user turn and avoid or prefer specific OpenRouter providers.

Nothing in this chain claims a false identity or authorization; it changes how the request is shaped and where it goes.

## Style cards

Besides voice, register and banned phrases, a style card carries **Influences** (writers to draw on, sent to the writer verbatim) and a **Repetition control** level. The level is applied purely through sampler penalties on the request, never as prompt text, and it leans on presence penalty: frequency and repetition penalties grow with token count and, over a long passage, strip out articles and then punctuation until the prose collapses into one run-on sentence. A guard trims such a tail off a generated passage and says so. The voice check on the manuscript also flags phrases reused from recent passages.

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
