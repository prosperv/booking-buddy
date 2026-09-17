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
- `npm run test:unit` — unit tests only (no browser). `npm run test:functional` —
  functional tests only (needs Chromium).
- `npm run playwright:install` — installs Chromium; required once before any
  browser/functional test run.
- `npm start` / `npx tsx examples/{usage,add-player,remove-player}.ts` — launch
  a real Chromium against the live site; needs a saved session. Never run in CI.
- `npx tsc --noEmit -p tsconfig.bot.json` — typecheck `bot/` (and `src/`);
  the build above deliberately excludes them.
- `npx tsx bot/index.ts <command>` — the `ensure-roster` bot CLI; see below.

## Workflow
- Commit incrementally as you go, especially when executing a multi-step plan.

## The `bot/` (ensure-roster)
- `bot/index.ts` dispatches three commands: `ensure-roster` (reconcile a job's
  roster with its matching bookings), `roster-test` (print parsed roster
  names per date, no browser), `check-auth` (validate the saved session).
  `--dry-run` plans only and never opens the edit modal.
- `bot.config.json` maps job name → `match` (weekday/startTime filters
  passed straight to `getCurrentBookings`, plus an optional case-insensitive
  `location` filter applied bot-side) → `session` (`rosterFile` + optional
  `courtCapacity`, default 6, + optional `organizer` name). Rosters are loaded
  from disk only — no Google Drive, no network.
- The roster is authoritative: names on no court are added, names on a court
  no longer in the roster are removed, and the organizer (from
  `session.organizer`, or any name on every court in the session) is never
  touched. A removal frees a slot, so a dropped player's court can absorb a
  replacement in the same run. Unit tests cover `csv`/`config`/`session` only;
  the rest is browser-dependent and validated by a live run.
- The roster CSV is date-columnar: the header row lists date labels (e.g.
  `Aug 25th`), and each column holds that date's players. A session whose date
  has no column is skipped; a column whose date has no booking is reported.
- A **session** is the set of bookings at the same date/time/location spread
  across courts. `bot/session.ts` groups bookings into sessions and plans the
  split: fill courts in court-number order preserving roster order, up to
  `courtCapacity` (organizer occupies a slot on every court and is auto-skipped
  as a name on every court). It reuses `normalizePlayerName`/`searchNameError`
  so comparisons stay consistent with the add flow. `ensure-roster` applies
  each court with `swapPlayersOnBooking` (one edit-modal save per court).
- Runs via `tsx` (never compiled into `dist/`); systemd units live in
  `bot/systemd/`. The bot uses the default headless client, so `auth.json` and
  `my-profile/` must exist on the machine it runs on.

## Never read or commit these (gitignored local state)
- `auth.json` — real logged-in Playwright storage state (live cookies).
- `my-profile/` — persistent Chromium profile directory.
- `bot.config.json` — real bot config (job + roster paths). Committed example:
  `bot.config.example.json`.
- `bot/rosters/*.csv` — real player rosters (except the committed
  `example.csv`).
- `test/data/**/*.mhtml` — raw full-page captures (~4.8MB each). Only the pruned
  `.html` fixtures derived from them are committed; re-capture live if markup changes.
- `log/` — file logs (`booking-buddy-<date>.log`, `bot-<date>.log`); written by
  `src/logger.ts` (`createLogger`), see "Logging" below.

## Gotchas
- `headless` defaults to **true** (`process.env.HEADLESS !== "false"` in
  `src/constants.ts`); the `examples/*` force it false so a window shows for login.
- `pauseForAction()` inserts a random anti-bot delay (default 1000–3000ms via
  `MIN_ACTION_DELAY_MS`/`MAX_ACTION_DELAY_MS`). Use fake timers in unit tests;
  never assert real timing.
- `addPlayer*`/`removePlayer*` run on a throwaway `context.newPage()` and close
  it, so `this.page` stays on the bookings list and later `getCurrentBookings()`
  still works.
- `restoreAuth` (`src/auth.ts`) must `await context.setStorageState(path)`; the
  method returns a promise and dropping it races the cookie restore against the
  first navigation, so the client intermittently starts logged out.
- Login-state detection (`isLoggedIn` in `src/login.ts`) keys off the
  `a[href*="/Online/Account/LogIn/"]` "LOG IN" button on the unauthenticated
  portal and the current URL still being `/Online/Bookings/List/`. The login
  form itself (`/Online/Account/LogIn/<org>`) uses `input[name="email"]`,
  `input[name="password"]`, and `button[data-testid="Continue"]`.
- Removing a player clicks that row's `remove-member-btn` in the modal's
  `member-table`. There is **no** confirmation dialog (unlike adding), but the
  change is only persisted by a later `saveReservation`. The reservation owner's
  row has no remove button, so removing them is reported as `not-removable`
  rather than thrown.
- All scraping keys off CourtReserve `data-testid` attributes and dayjs parsing
  (`src/booking.ts`); if the site markup changes, parsing breaks.

## Logging
- `src/logger.ts` exports `createLogger({ filePath, level, console })` (pino,
  JSON lines, synchronous writes, console mirror on by default) plus
  `resolveLogDir` / `defaultLogFile`. The `CourtReserveClient` logs its own
  lifecycle + per-player outcomes to `log/booking-buddy-<date>.log`; the bot
  logs orchestration to `log/bot-<date>.log`.
- Log dir resolution: `ClientOptions.logPath` (library) / `--log-path` (bot) →
  `LOG_PATH` → `<cwd>/log`. File names are fixed. `LOG_LEVEL` (default `info`)
  controls verbosity. `ClientOptions.logPath: false` disables the library file.
- The destination is created lazily on first write, so constructing a client
  (or `createLogger`) never creates files — unit tests don't need to set
  `logPath: false`.
- `src/log-context.ts` attaches the client's logger to every `Page` in its
  context (`attachLoggerToContext`, called from `init()`); the action and
  feedback helpers resolve it via `loggerFor(page)` (falling back to a silent
  no-op logger) so they can log without taking a logger parameter. User actions
  are logged as `info` *at the call sites* of `humanClick`/`navigateTo` (not
  inside them), phrased as instructions — `click Edit Reservation`, `navigate
  to reservation detail`, `click remove member`, `click Save`, `typed search`,
  `login submitted`, `bookings scraped` — so the log reads like the sequence of
  steps performed. Webpage feedback is logged as `debug` at the read sites:
  `member-search results`, `roster read`, `player verified`, `login state`.
- Failure paths are logged (then rethrown/returned) rather than silently
  dropped: `init-failed`, `save-auth-failed`, `session-not-saved` (warn),
  `save-timeout`/`save-failed`, `detail-load-failed`, `modal-open-failed`,
  `confirm-dialog-timeout`, `member-search-timeout`, `filter-failed`, and the
  bot's `config-error`/`roster-error`/`init-failed`. Precondition guards
  (`"Client not initialized"`, missing `bookingId`) deliberately stay unlogged —
  logging them would create `log/` files during the no-browser unit tests.
- On an `error`-level failure, the code also captures an HTML snapshot of the
  page (`src/capture.ts` `captureFailure` → `page.content()`) into
  `<logDir>/failures/failure-<timestamp>.html` and records its path in the log
  line's `snapshot` field, so a failure is matched to its snapshot. Snapshotting
  follows the same enable/disable switch as file logging (`logPath: false`
  disables it) and is skipped when there is no page (bot config/roster errors)
  or for `warn`-level paths. A failed snapshot never masks the original error.

## Testing
- Unit tests (no browser) live at the top level of each test root:
  `test/*.test.ts` (import from `../src/index`) and `bot/test/*.test.ts`.
- Functional tests (real Chromium) live under `*/test/functional/` — currently
  `test/functional/*.test.ts`; they load HTML fixtures from `test/data/` and
  exercise the Playwright-dependent functions. Any bot functional tests belong
  in `bot/test/functional/`.
- vitest config (`vitest.config.ts`) pins `TZ=America/Los_Angeles` — several date
  tests are offset-sensitive and would pass for the wrong reason on a UTC runner.
  Its `setupFiles: ./test/setup.ts` also `delete`s inherited env vars
  (`HEADLESS`, `AUTH_PATH`, `PROFILE_DIR`, `MIN/MAX_ACTION_DELAY_MS`, `PORT`,
  `COURTRESERVE_ORG_ID`, `LOG_PATH`, `LOG_LEVEL`) so default-option tests are
  deterministic — note they are deleted (not set to `""`), because
  `src/constants.ts` uses `??`.
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
- `loginWithCredentials` detects success purely by the page redirecting off
  `/Online/Account/LogIn/` (the login form is an Ant Design JS/XHR submit with
  no `action`), so the exact submit/redirect timing and any CSRF/token field are
  only validated on a live run.
