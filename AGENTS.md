# AGENTS.md

## What this is
TypeScript library that automates badminton court sign-ups at Bellevue
Badminton Club by driving app.courtreserve.com with Playwright. Public
entrypoint is `src/index.ts` (re-exports `CourtReserveClient` from
`src/client.ts`). Plain TypeScript, CommonJS build, no framework, no lint,
no CI.

## Commands
- `npm run build` — runs `tsc`; outputs to `dist/`. Only typechecks `src/**`
  (tsconfig rootDir `src`) — it does NOT typecheck `test/`.
- `npx vitest run` — full test suite. Config in `vitest.config.ts`: globals
  on, node env, include `test/**/*.test.ts` only.
- `npx vitest run test/utils.test.ts` (or add `-t "<test name>"` for one test).
- `npm start` / `npx tsx examples/usage.ts` — launches a real Chromium and
  talks to the live site; requires a saved session. Never run in CI/automation.
- `npm run playwright:install` — installs the Chromium binary; required once
  before any browser run.

## Never read or commit these (gitignored local state)
- `auth.json` — real logged-in Playwright storage state (live session cookies).
- `my-profile/` — persistent Chromium profile directory.
- `package-lock.json` — gitignored but exists locally; deps can drift.
- `test/data/**/*.mhtml` — raw full-page MHTML captures (~4.8MB each). Only the
  pruned `.html` fixtures derived from them are committed; re-capture live if
  markup changes.

## Gotchas
- `headless` actually defaults to TRUE in `src/constants.ts` (`process.env.HEADLESS !== "false"`),
  contradicting the README's "default false" table; `examples/usage.ts` forces it false.
- `pauseForAction()` inserts random 400–2000ms delays between browser actions
  (`MIN_ACTION_DELAY_MS` / `MAX_ACTION_DELAY_MS` env vars) — deliberate anti-bot
  pacing. Use fake timers in unit tests; never assert real timing.
- `addPlayerToBooking`/`addPlayersToBooking` run on a throwaway
  `context.newPage()` and close it, so `this.page` stays on the bookings list
  and later `getCurrentBookings()` calls keep working. The same applies to
  `removePlayerFromBooking`/`removePlayersFromBooking`.
- Removing a player clicks the `remove-member-btn` in that player's row of the
  modal's `member-table`. There is **no** confirmation dialog (unlike adding),
  but the change is only persisted by a later `saveReservation`. The
  reservation owner's row has no remove button, so removing them is reported as
  `not-removable` rather than thrown.
- All scraping depends on CourtReserve `data-testid` attributes and dayjs
  parsing (`src/booking.ts`); if the site markup changes, parsing breaks.

## Testing
- Unit tests (no browser): `test/*.test.ts`, import from `../src/index`.
- Functional tests (real Chromium): `test/functional/booking.test.ts` and
  `test/functional/players.test.ts`, load HTML fixtures from `test/data/` into
  Playwright and exercise the Playwright-dependent scraping functions
  (`getBookingsFound`, `collectBookingSessions`, `editBooking`) and the add-player
  step functions (`src/players.ts`). Requires `npm run playwright:install` first.
- `test/data/*.html` are pruned snapshots of live CourtReserve pages, used as
  fixtures by functional tests. They were captured as MHTML, then cut down to
  the subtree the code reads inside a minimal HTML shell — no CSS, images, or
  scripts. The markup inside the kept subtree is byte-for-byte as the site
  served it.
- The add-player fixtures (`reservation-detail.html`, `edit-modal.html`,
  `player-options.html`, `confirm-dialog.html`, `player-added.html`,
  `no-player-options.html`, `reservation-confirmed.html`, `two-bookings.html`)
  were pruned from `test/data/adding-player/*.mhtml`. Two deliberate deviations
  from byte-for-byte: the Kendo popup wrapper's `display:none`/`aria-hidden` is
  stripped (the capture blurred the input, so the wrapper was captured hidden),
  and `no-player-options.html` is hand-built from `edit-modal.html` to simulate
  the "player not found" dropdown state. `reservation-confirmed.html` is pruned
  from `6-click-save-reservation-confirmed.mhtml` (a plain HTML capture, not a
  multipart MHTML) and its `<script>`/`<style>` blocks are stripped like the
  others.
- The captured MHTML pages contain NO JavaScript (Chrome stripped every script).
  So the add-player functional tests only cover per-state DOM/locators — the
  interactive Kendo ComboBox + sweetalert2 chain, the member-search XHR, and the
  save POST cannot be exercised offline and are gated on a live run.
- The remove-player fixtures (`modal-player-list.html`, `modal-player-removed.html`)
  are pruned from `test/data/removing-player/*.mhtml`. They capture the edit modal
  before and after removing "Kento Momota" (5 players -> 4). As with the add
  fixtures, `removeMemberFromModal` only clicks the button; the DOM does not
  actually drop the row offline, so the post-removal state is a separate fixture.
- Because the CSS is gone, the fixtures have no realistic layout. Assertions on
  geometry (`boundingBox()`, scrolling, hover targets) will not reflect
  production; only DOM structure and text are faithful. `humanClick`
  (`src/interactions.ts`) therefore falls back to `locator.click()` when an
  element has no usable bounding box.
- `test/functional/setup.ts` provides `loadFixture()` — reads the file and sets
  it as page content.
- `npm run test:coverage` is configured (v8 provider) but `@vitest/coverage-v8`
  is not installed, so it will error until that package is added.

## Residual risks (validated only by a live run)
- Kendo keystroke sensitivity: `typePlayerSearch` uses `pressSequentially` with a
  per-char delay; a bulk `fill()` may collapse to one input event the widget's
  debounce drops. Untestable offline.
- Member-search XHR endpoint is undiscoverable from the captures, so option
  selection keys off the rendered `#OwnersDropdown_listbox` DOM, not the response.
- sweetalert2 copy and the save POST (`/Online/Reservations/UpdateMyReservation/*`)
  semantics are pinned by the captures but the response body shape is unknown;
  `saveReservation` only asserts HTTP status.
- On a successful save the edit modal is NOT detached — its content is swapped
  in place for a "Reservation Confirmed" screen (`data-testid="reservation-confirm"`)
  that `saveReservation` dismisses via `closeReservationConfirmation`. The site
  also fires an async `reloadReservationDetail()` in parallel, so
  `readDetailPlayers` immediately after close may still see the pre-save roster;
  validate the read-back ordering on a live run.
