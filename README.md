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

Builds are signed with a throwaway key unless the repository has a keystore in its secrets. A throwaway signature means Android refuses to install a new build over an old one until the old one is uninstalled. To keep one signature across builds, generate a keystore once and store it:

```bash
keytool -genkeypair -v -keystore sand.keystore -alias sand -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 sand.keystore   # macOS: base64 -i sand.keystore
```

Repository secrets: `ANDROID_KEYSTORE_BASE64` (the base64 output), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`sand`), `ANDROID_KEY_PASSWORD`. Keep the keystore file somewhere safe; losing it means a fresh signature.

Version comes from the tag (or the workflow input), and the Android `versionCode` is the run number, so every build is installable over the previous one **once the signature is stable**. Installing a stable-key build over a throwaway-key build needs one last uninstall; after that, updates keep settings and stories.

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

Besides voice, register and banned phrases, a style card carries **Influences** (writers to draw on, sent to the writer verbatim) and a **Repetition control** level. The level is applied purely through sampler penalties on the request, never as prompt text. The voice check on the manuscript also flags phrases reused from recent passages.

## Appearance

Dark by default. Settings → Appearance switches to light or follows the system.

## Development

```bash
npm run typecheck   # tsc
npm test            # vitest, pure logic in src/core
npm run lint        # eslint
```

`src/core` has no React Native imports and holds everything testable: the beat tree, context assembly, the OpenRouter client, the refusal chain, voice drift heuristics and helper prompts. `src/app` is Expo Router screens. `src/db` is SQLite. `src/state` is zustand stores.
