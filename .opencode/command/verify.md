---
description: Typecheck the whole repo and run the no-browser tests (the two commands that actually verify a change)
agent: build
---

Verify the working tree. Run these two, in this order, from the repo root:

```
npm run typecheck
npm run test:unit
```

**`npm run typecheck`** is the only static check over the whole repo — `tsc --noEmit -p tsconfig.check.json`, which includes `src/`, `bot/`, `test/`, `examples/`, and `vitest.config.ts`. Do **not** reach for `npm run build` instead: `tsconfig.json` is `include: ["src/**/*"]` with `rootDir: src`, so a green build says nothing about `bot/`, `test/`, or `examples/` and fails *silently*. "Run the typecheck" means `npm run typecheck`, full stop.

**`npm run test:unit`** is `vitest run --exclude "**/functional/**"` — 15 files / 265 tests, no browser, a couple of seconds. Every vitest run prints a `configLoader: 'native'` warning about ESM syntax in the CommonJS-loaded `vitest.config.ts`; that is expected, ignore it.

Report, don't fix, unless asked:

- Typecheck: quote `file:line` and the error code for each error, and count them.
- Tests: the failing file, test name, and the first assertion message.

Not part of this check, and when each is the right call:

- `npx vitest run` — the full suite, functional included. Use it when a change touches `src/` behaviour the fixtures cover.
- `npm run test:functional` — functional only. Needs Chromium: `npm run playwright:install` once per machine.
- `npm run test:coverage` — whole suite under v8; needs Chromium, has no thresholds, and is for finding untested paths rather than gating a change.

If a check fails only in `test/functional/`, say so explicitly rather than reporting a green verify — the unit run excluded those files.
