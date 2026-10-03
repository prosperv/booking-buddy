# AGENTS.md

## What this is
TypeScript library that automates badminton court sign-ups at Bellevue
Badminton Club by driving app.courtreserve.com with Playwright. Public
entrypoint is `src/index.ts` (re-exports `CourtReserveClient` from
`src/client.ts`). `bot/` is a CLI that uses the library to reconcile rosters.
Plain TypeScript, CommonJS build, **no lint, no CI**.

## Commands
- `npm run build` — `tsc` → `dist/`. Only typechecks `src/**` (tsconfig
  `rootDir: src`) — it does **not** typecheck `test/`, `examples/`, or `bot/`.
- `npx tsc --noEmit -p tsconfig.bot.json` — typechecks `bot/` + `src/`. This
  is the only static check that exists, so run it after any `bot/` edit.
- `npx vitest run` — full suite (unit **and** functional; needs Chromium, so
  run `npm run playwright:install` once first). Currently 18 files / 268 tests.
  One file: `npx vitest run test/players.test.ts`, one test: add `-t "<name>"`.
- `npm run test:unit` — unit only, no browser. `npm run test:functional` — needs
  Chromium.
- `npm start` / `npx tsx examples/{usage,add-player,remove-player,swap-player}.ts`
  — launch a real Chromium against the live site; needs a saved session. Never
  in CI. `--force` / `-f` forces a fresh login; the examples all pass
  `headless: false`.
- `npx tsx bot/index.ts <command>` — the `ensure-roster` bot CLI; see below.
- `npm run test:coverage` is configured (v8) but `@vitest/coverage-v8` is not
  installed, so it errors. Don't use it to verify a change.
- Every `vitest` run prints a `configLoader: 'native'` warning about ESM syntax
  in a CJS-loaded `vitest.config.ts`. Harmless — ignore it.

## Workflow
- Commit incrementally as you go, especially when executing a multi-step plan.

## The `bot/` (ensure-roster)
Full prose lives in `bot/README.md` and `bot/FEATURE-LIST.md` — read those
before changing bot behavior. What's load-bearing here:
- `bot/index.ts` dispatches three commands: `ensure-roster`, `roster-test`
  (print parsed rosters, no browser), `check-auth`. Flags: `--dry-run` (plans
  only, never opens the edit modal), `--job <name>`, `--headed` (default is
  headless), `--config <path>`, `--log-path <dir>`. Uncaught exceptions and
  rejections are logged and exit 1 via handlers registered before `main`.
- `bot.config.json` maps job name → `match` (`weekday`/`startTime` go straight
  to `getCurrentBookings`; `location` is a case-insensitive bot-side filter) →
  `session` (`roster`, `courtCapacity` default 6 **including** the organizer,
  optional `organizer`). `validateConfig` is strict and throws `ConfigError`
  with a path-like message rather than skipping a bad job.
- `session.roster` in JSON is a **string** (local CSV path, resolved relative to
  the config file) or an **object** `{ sheet: "<url|id>", range? }`.
  `validateConfig` normalizes these into a discriminated union
  `{ kind: "file", path }` | `{ kind: "googleSheet", spreadsheetId, range? }` —
  so branch on `source.kind`, not on the JSON shape. A sheet job requires the
  top-level `google.serviceAccount` (inline key; only `client_email` and
  `private_key` are read).
- The roster sheet is **one tab per month** (`Sept-2026`, `Oct 2026`, …), each
  holding a month of stacked `▶` blocks. `bot/sheets.ts` `pickMonthTabs` /
  `parseMonthTitle` choose the current month plus the next (lenient: a month
  name — first three letters suffice — plus a 4-digit year anywhere; non-month
  tabs ignored), and `loadGoogleSheets` fetches them in one `values.batchGet`.
  An explicit `range` bypasses tab selection. Each tab is re-serialized by
  `matrixToCsv` and merged by `parseRosterAll`, which stamps each `Roster` with
  its `tab` for logging. (`bot/rosters/example.csv` is the canonical format.)
- `parseRoster` auto-detects **three** roster layouts — stacked signups export
  (a `▶` marker row), single event export (`Paid` + `Player Name` headers), and
  the legacy date-column — so a file and a sheet tab of the same shape parse
  identically. Layouts are documented in `bot/README.md`; don't add a fourth
  without routing it through `parseRoster`.
- A run reconciles **one session per job**: `RosterSet.next(now, {startTime?})`
  returns the closest upcoming roster (a dated one compared at its full date +
  start time, a year-less one at its next occurrence), so a run walks forward
  through the month instead of re-editing finished games. The rest are logged at
  `debug` (`roster-deferred`); the pick is announced at `info`
  (`roster-selected`). An **empty roster is still authoritative** — the courts
  get cleared of everyone not on it — and is warned about first
  (`empty-roster`), because a month tab's future blocks start out unfilled.
- The roster is authoritative: names on no court are added, names on a court no
  longer in the roster are removed. The organizer (from `session.organizer`, or
  any name on **every** court of a multi-court session) is never removed but also
  never auto-added — so the organizer must already be booked onto every court
  or the split is wrong. A removal frees a slot, so a dropped player's court can
  absorb a replacement in the same run.
- A **session** is the set of bookings at the same date/time/location across
  courts. `bot/session.ts` groups them and plans the split: fill courts in
  court-number order preserving roster order, up to `courtCapacity`. It imports
  `normalizePlayerName` / `searchNameError` from `../src/players` (not the
  `../src` barrel) so comparisons stay consistent with the add flow.
  `ensure-roster` applies each court with `swapPlayersOnBooking` — one
  edit-modal save per court, and courts with no add/remove are skipped.
- Bot unit tests cover `csv` / `config` / `session` / `sheets` only
  (`matrixToCsv`, month-tab picking, config validation, session selection).
  Everything else is browser- or network-dependent and validated by a live run.
- Runs via `tsx` (never compiled into `dist/`); systemd units live in
  `bot/systemd/`. The bot uses the default headless client, so `auth.json` and
  `my-profile/` must exist on the machine it runs on.

## Never read or commit these (gitignored local state)
- `auth.json` — real logged-in Playwright storage state (live cookies).
- `my-profile/` — persistent Chromium profile directory.
- `bot.config.json` — real bot config (job + roster paths, and any inline
  Google service-account key). Committed example: `bot/bot.config.example.json`.
- `bot/rosters/*.csv` — real player rosters (except the committed
  `example.csv`).
- `test/data/**/*.mhtml` — raw full-page captures (~4.8MB each). Only the pruned
  `.html` fixtures derived from them are committed; re-capture live if the
  markup changes.
- `log/` — file logs (`booking-buddy-<date>.log`, `bot-<date>.log`); written by
  `src/logger.ts` (`createLogger`), see "Logging" below.
- `.notes/`, `.temp-data/` — local scratch.

## Gotchas
- `headless` defaults to **true** (`process.env.HEADLESS !== "false"` in
  `src/constants.ts`); the `examples/*` force it false so a window shows for
  login.
- `pauseForAction()` inserts a random anti-bot delay (default 1000–3000ms via
  `MIN_ACTION_DELAY_MS`/`MAX_ACTION_DELAY_MS`) before every navigation, click,
  and per-player step. Use fake timers in unit tests; never assert real timing.
- `navigateTo` (`src/navigation.ts`) takes a **required readiness selector** (a
  CSS string, or an array of alternatives joined into one union selector) and
  never waits on `DOMContentLoaded`: it uses `waitUntil: "commit"` plus a
  `waitFor({ state: "attached" })` on that selector. CourtReserve's pages carry
  deferred third-party scripts and webfont stylesheets, and one stalled
  subresource holds `domcontentloaded` open indefinitely while the page is
  fully rendered. The list passes
  `['[data-testid="booking-list-active"]', LOGIN_LINK_SELECTOR]` because a
  stale session redirects to the portal — that page is usable (so `init()`
  returns fast and `isLoggedIn()` reports it), not a hang. Budget is
  `NAV_TIMEOUT_MS` (default 60s, also set as the context's default navigation
  timeout) with `NAV_RETRIES` (default 1) retries; before each retry `navigateTo`
  probes `count()` and proceeds with a `warn` if the content is already on
  screen, so a late page is accepted rather than retried into the ground.
  Don't add a call site without a selector — that's the race `commit` opens up.
- `addPlayer*`/`removePlayer*`/`swap*` all run inside `withEditModal` on a
  throwaway `context.newPage()` that is closed in `finally`, so `this.page` stays
  on the bookings list and a later `getCurrentBookings()` still works. The modal
  is saved only if the pending roster actually changed, then re-navigated to the
  detail page and re-read.
- `restoreAuth` (`src/auth.ts`) must `await context.setStorageState(path)`; the
  method returns a promise and dropping it races the cookie restore against the
  first navigation, so the client intermittently starts logged out.
- Login-state detection (`isLoggedIn` in `src/login.ts`) keys off the
  `a[href*="/Online/Account/LogIn/"]` "LOG IN" button on the unauthenticated
  portal **and** the current URL still being `/Online/Bookings/List/` — both
  signals are required. The login form (`/Online/Account/LogIn/<org>`) uses
  `input[name="email"]`, `input[name="password"]`, and
  `button[data-testid="Continue"]`.
- Removing a player clicks that row's `remove-member-btn` in the modal's
  `member-table`. There is **no** confirmation dialog (unlike adding), and the
  change is only persisted by a later `saveReservation`. The reservation owner's
  row has no remove button, so removing them reports `not-removable` rather than
  throwing. Removal matches on normalized equality only (never a substring
  match, which would remove "Lee Zii Jia" when asked for "Lee Zii Jiaa").
- All scraping keys off CourtReserve `data-testid` attributes and dayjs parsing
  (`src/booking.ts`, `src/parsers.ts`); if the site markup changes, parsing
  breaks. The "Details"/"Edit Reservation" button text is what marks a booking
  editable, so bookings someone else added you to are silently skipped.

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
  (or `createLogger`) never creates files — unit tests don't need `logPath: false`.
- `src/log-context.ts` attaches the client's logger (and the failure-capture
  dir) to every `Page` in its context via `attachLoggerToContext`, called from
  `init()`. The action and feedback helpers resolve it with `loggerFor(page)`
  (falling back to a silent no-op), so they log without taking a logger
  parameter. A `WeakMap`, not a module singleton — two clients can run in one
  process.
- Convention: user actions are logged as `info` **at the call sites** of
  `humanClick`/`navigateTo` (never inside them), phrased as instructions —
  `click Edit Reservation`, `navigate to reservation detail`, `click remove
  member`, `click Save`, `typed search`, `login submitted`, `bookings scraped`
  — so the log reads as the sequence of steps performed. Webpage feedback is
  logged at `debug` where it is read: `member-search results`, `roster read`,
  `player verified`, `login state`.
- Failure paths are logged (then rethrown/returned) rather than silently
  dropped: `init-failed`, `save-auth-failed`, `session-not-saved` (warn),
  `save-timeout`/`save-failed`, `detail-load-failed`, `modal-open-failed`,
  `confirm-dialog-timeout`, `member-search-timeout`, `filter-failed`,
  `navigate-timeout` (warn), `navigate-timeout-continue` (warn), and the
  bot's `config-error`/`roster-error`/`init-failed`. Precondition guards
  (`"Client not initialized"`, missing `bookingId`) deliberately stay unlogged —
  logging them would create `log/` files during the no-browser unit tests.
- On an `error`-level failure the code also snapshots the page HTML
  (`src/capture.ts` `captureFailure` → `page.content()`) into
  `<logDir>/failures/failure-<timestamp>.html` and records the path in the log
  line's `snapshot` field, so a failure is matched to its snapshot. Snapshotting
  follows the same switch as file logging (`logPath: false` disables it) and is
  skipped when there is no page (bot config/roster errors) or on `warn`-level
  paths. A failed snapshot never masks the original error.

## Testing
- Unit tests (no browser) sit at the top level of each test root:
  `test/*.test.ts` (import from `../src/index`) and `bot/test/*.test.ts`.
- Where a helper only needs a `Page`/`BrowserContext` as a WeakMap key or an
  event emitter, the unit tests drive it with a plain cast stand-in
  (`{} as Page`, an object with `on`/`pages`) instead of a browser — see
  `test/log-context.test.ts`, `test/pending-requests.test.ts`, and the fake page
  in `test/navigation.test.ts` (which also `vi.mock`s `pauseForAction` away,
  since the real one sleeps 1–3s).
- Functional tests (real Chromium) live under `*/test/functional/` — currently
  `test/functional/*.test.ts`; they `chromium.launch()` themselves and use
  `test/functional/setup.ts` (`fixturePath`, `loadFixture`) to `setContent()` a
  pruned HTML fixture. Bot functional tests belong in `bot/test/functional/`.
- Roster fixtures live in `bot/test/data/*.csv` — one file per sheet tab
  (`Sept-2026.csv` is a real CourtReserve export, `Oct-2026.csv` is hand-written
  to the same layout) so the month-tab merge and the closest-upcoming-session
  selection are tested against the real format. `bot/test/csv.test.ts` reads
  them with `resolve(process.cwd(), "bot/test/data", …)` rather than
  `import.meta`, because `tsconfig.bot.json` typechecks `bot/**` as CommonJS.
- vitest config (`vitest.config.ts`) pins `TZ=America/Los_Angeles` — several
  date tests are offset-sensitive and would pass for the wrong reason on a UTC
  runner. Its `setupFiles: ./test/setup.ts` also `delete`s inherited env vars
  (`HEADLESS`, `AUTH_PATH`, `PROFILE_DIR`, `MIN/MAX_ACTION_DELAY_MS`,
  `NAV_TIMEOUT_MS`, `NAV_RETRIES`, `PORT`, `COURTRESERVE_ORG_ID`, `LOG_PATH`,
  `LOG_LEVEL`) so default-option tests are
  deterministic — note they are deleted (not set to `""`), because
  `src/constants.ts` uses `??`.
- `test/data/*.html` fixtures are pruned MHTML: no CSS, images, or scripts, so
  there is no realistic layout. Assertions on geometry (`boundingBox()`,
  scrolling, hover) won't match production — only DOM structure and text are
  faithful. `humanClick` (`src/interactions.ts`) falls back to
  `locator.click()` when an element has no usable bounding box, which is what
  keeps those tests working. Provenance / re-capture steps are in
  `test/data/README`.
- The captures contain no JavaScript, so the interactive chain (Kendo ComboBox,
  sweetalert2 confirm, member-search XHR, save POST) is untestable offline and
  gated on a live run; `saveReservation` only asserts HTTP status.

## Residual risks (validated only by a live run)
- `typePlayerSearch` uses `pressSequentially` with an 80ms per-char delay; a
  bulk `fill()` collapses to one input event that the Kendo debounce drops.
- Member-search XHR is undiscoverable from captures, so option selection keys
  off the rendered `#OwnersDropdown_listbox li.k-list-item` DOM, not the
  response.
- After save the edit modal is swapped in place for a "Reservation Confirmed"
  screen (only when the detail page was reached directly — empty
  `document.referrer`; otherwise the site navigates away and it never appears).
  The site also fires an async `reloadReservationDetail()`, so the
  `readDetailPlayers` right after the re-navigation may still see the pre-save
  roster.
- `loginWithCredentials` detects success purely by the page redirecting off
  `/Online/Account/LogIn/` within 10s (the login form is an Ant Design JS/XHR
  submit with no `action`), so the exact submit/redirect timing and any
  CSRF/token field are only validated on a live run.
