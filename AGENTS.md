# AGENTS.md

## What this is
TypeScript library that automates badminton court sign-ups at Bellevue
Badminton Club by driving app.courtreserve.com with Playwright. Public
entrypoint is `src/index.ts` (re-exports `CourtReserveClient` from
`src/client.ts`). Plain TypeScript, CommonJS build, no framework, no lint,
no CI.

## Commands
- `npm run build` — `tsc` → `dist/`. Only typechecks `src/**` (tsconfig
  `rootDir: src`) — it does **not** typecheck `test/` or `examples/`.
- `npx vitest run` — full suite. One file: `npx vitest run test/players.test.ts`
  (add `-t "<name>"` for a single test).
- `npm run playwright:install` — installs Chromium; required once before any
  browser/functional test run.
- `npm start` / `npx tsx examples/{usage,add-player,remove-player}.ts` — launch
  a real Chromium against the live site; needs a saved session. Never run in CI.

## Workflow
- Commit incrementally as you go, especially when executing a multi-step plan.

## Never read or commit these (gitignored local state)
- `auth.json` — real logged-in Playwright storage state (live cookies).
- `my-profile/` — persistent Chromium profile directory.
- `package-lock.json` — gitignored but exists locally; deps can drift.
- `test/data/**/*.mhtml` — raw full-page captures (~4.8MB each). Only the pruned
  `.html` fixtures derived from them are committed; re-capture live if markup changes.

## Gotchas
- `headless` defaults to **true** (`process.env.HEADLESS !== "false"` in
  `src/constants.ts`); the `examples/*` force it false so a window shows for login.
- `pauseForAction()` inserts a random anti-bot delay (default 1000–3000ms via
  `MIN_ACTION_DELAY_MS`/`MAX_ACTION_DELAY_MS`). Use fake timers in unit tests;
  never assert real timing.
- `addPlayer*`/`removePlayer*` run on a throwaway `context.newPage()` and close
  it, so `this.page` stays on the bookings list and later `getCurrentBookings()`
  still works.
- Removing a player clicks that row's `remove-member-btn` in the modal's
  `member-table`. There is **no** confirmation dialog (unlike adding), but the
  change is only persisted by a later `saveReservation`. The reservation owner's
  row has no remove button, so removing them is reported as `not-removable`
  rather than thrown.
- All scraping keys off CourtReserve `data-testid` attributes and dayjs parsing
  (`src/booking.ts`); if the site markup changes, parsing breaks.

## Testing
- Unit tests (no browser): `test/*.test.ts`, import from `../src/index`.
- Functional tests (real Chromium): `test/functional/*.test.ts` load HTML
  fixtures from `test/data/` and exercise the Playwright-dependent functions.
- vitest config (`vitest.config.ts`) pins `TZ=America/Los_Angeles` — several date
  tests are offset-sensitive and would pass for the wrong reason on a UTC runner.
  Its `setupFiles: ./test/setup.ts` also `delete`s inherited env vars
  (`HEADLESS`, `AUTH_PATH`, `PROFILE_DIR`, `MIN/MAX_ACTION_DELAY_MS`, `PORT`,
  `COURTRESERVE_ORG_ID`) so default-option tests are deterministic — note they are
  deleted (not set to `""`), because `src/constants.ts` uses `??`.
- `test/data/*.html` fixtures are pruned MHTML: no CSS, images, or scripts, so
  there is no realistic layout. Assertions on geometry (`boundingBox()`,
  scrolling, hover) won't match production — only DOM structure and text are
  faithful. `humanClick` (`src/interactions.ts`) falls back to `locator.click()`
  when an element has no usable bounding box. Provenance / re-capture steps are
  in `test/data/README`.
- The captures contain no JavaScript, so the interactive chain (Kendo ComboBox,
  sweetalert2 confirm, member-search XHR, save POST) is untestable offline and
  gated on a live run; `saveReservation` only asserts HTTP status.
- `npm run test:coverage` is configured (v8) but `@vitest/coverage-v8` isn't
  installed, so it errors until that package is added.

## Residual risks (validated only by a live run)
- `typePlayerSearch` uses per-char delay; a bulk `fill()` may collapse to one
  input event the Kendo debounce drops.
- Member-search XHR is undiscoverable from captures, so option selection keys off
  the rendered `#OwnersDropdown_listbox` DOM, not the response.
- After save the edit modal is swapped in place for a "Reservation Confirmed"
  screen; the site also fires an async `reloadReservationDetail()`, so
  `readDetailPlayers` immediately after close may still see the pre-save roster.
