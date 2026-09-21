@AGENTS.md

# Sand

Mobile-first story writing app backed by OpenRouter. Read `docs/SPEC.md` first.

- Routes live in `src/app/`. Pure logic lives in `src/core/` and must stay free of React Native imports so it can be unit tested with vitest.
- `npm run typecheck`, `npm test`, `npm run lint` before declaring work done.
- Never inject content rules into prompts. The only content gate is structural (see SPEC, "Adulthood").
