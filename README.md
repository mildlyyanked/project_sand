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

Version comes from the tag (or the workflow input), and the Android `versionCode` is the run number, so every build is installable over the previous one.

Local alternative, with Android Studio installed: `npx expo run:android --variant release`.

Web also works for desktop use: `npx expo start --web`.

## First launch

1. Settings → paste your OpenRouter key → **Save & test**.
2. Settings → **Refresh list** to cache the model catalog and the zero-data-retention list.
3. Pick a writer, summarizer and helper model.
4. Back on the home screen, tap **+**.

## Workshop

**+ → Workshop it** opens a conversation with an editor model. Say anything, answer its questions, ask for premises when ready, then keep pushing on them. Tap *Use premise N* under any numbered list, or *Use this as the premise* under any reply. A condensed note of what was decided becomes the story's first beat.

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
