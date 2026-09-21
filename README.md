# Sand

A mobile-first story writing app on top of OpenRouter. Single user, no server, everything stays on the device.

Read `docs/SPEC.md` for the design and the decisions behind it.

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** on Android. Every native module used here (SQLite, secure store, streaming fetch) ships inside Expo Go, so no custom build is needed to try it.

For an installable APK without an app store:

```bash
npx expo run:android          # local build, needs Android Studio
# or
npx eas-cli build -p android --profile preview
```

Web also works for desktop use: `npx expo start --web`.

## First launch

1. Settings → paste your OpenRouter key → **Save & test**.
2. Settings → **Refresh list** to cache the model catalog and the zero-data-retention list.
3. Pick a writer, summarizer and helper model.
4. Back on the home screen, tap **+**.

## Development

```bash
npm run typecheck   # tsc
npm test            # vitest, pure logic in src/core
npm run lint        # eslint
```

`src/core` has no React Native imports and holds everything testable: the beat tree, context assembly, the OpenRouter client, the refusal chain, voice drift heuristics and helper prompts. `src/app` is Expo Router screens. `src/db` is SQLite. `src/state` is zustand stores.
