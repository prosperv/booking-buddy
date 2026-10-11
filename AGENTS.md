# AGENTS.md

## What this is
TypeScript library that automates badminton court sign-ups at Bellevue Badminton
Club by driving app.courtreserve.com with Playwright. Public entrypoint is
`src/index.ts` (re-exports `CourtReserveClient` from `src/client.ts`). `bot/` is
a CLI that uses the library to reconcile rosters. Plain TypeScript, CommonJS
build, Node >= 20. **No lint, no formatter, no CI** — the only static checks are
the two `tsc` commands below, so nothing else catches a mistake.

## Commands
- `npm run build` — `tsc` → `dist/`. Typechecks **only** `src/**` (`tsconfig.json`
  sets `rootDir: src`), so it does not cover `test/`, `examples/`, or `bot/`.
- `npx tsc --noEmit -p tsconfig.bot.json` — typechecks `src/` + `bot/` (which
  includes `bot/test/`). The only static check over bot code, so run it after any
  `bot/` edit.
- `npx vitest run` — full suite: 14 unit files / 236 tests plus 4 functional
  files / 32 tests. Functional tests need Chromium (`npm run playwright:install`
  once). Narrow with `npx vitest run test/players.test.ts`, add `-t "<name>"` for
  one test, or `npx vitest run bot/test` for the bot only (4 files / 102 tests).
- `npm run test:unit` (no browser) / `npm run test:functional` (needs Chromium).
- `npm run test:coverage` is configured (v8) but `@vitest/coverage-v8` is not
  installed, so it fails with `MISSING DEPENDENCY`. Don't use it to verify a change.
- Every `vitest` run prints a `configLoader: 'native'` warning about ESM syntax
  in a CJS-loaded `vitest.config.ts`. Harmless — ignore it.
- `npm start` / `npx tsx examples/{list-bookings,add-player,remove-player,swap-player}.ts`
  — launch a real Chromium against the live site; needs a saved session, and every
  example forces `headless: false`. `--force` / `-f` forces a fresh login. Never in CI.
- `npx tsx bot/index.ts <command>` — the `ensure-roster` bot CLI; see below.

## Workflow
- Commit incrementally as you go, with Conventional Commit subjects
  (`feat(nav):`, `fix(bot):`, `test(bot):`, `docs(bot):`, `chore(data):`) — that
  matches the existing history.
- `package-lock.json` is gitignored, so installs are unpinned: use `npm install`,
  never `npm ci`, and don't try to commit the lockfile.

## The `bot/` (ensure-roster)
Full prose lives in `bot/README.md`, with a feature tree in `bot/FEATURE.md`
(the library has its own at `FEATURE.md`) — read those before changing bot
behavior. What's load-bearing here:
- `bot/index.ts` dispatches four commands: `ensure-roster`, `roster-test`
  (print parsed rosters, no browser), `check-auth`, `doctor`. Flags:
  `--dry-run` (plans only, never opens the edit modal), `--job <name>`,
  `--headed` (default is headless), `--live` (doctor only), `--config <path>`,
  `--log-path <dir>`. Uncaught exceptions and rejections are logged and exit 1
  via handlers registered before `main`.
- `doctor` (`bot/doctor.ts`) answers "can this setup run" without a browser,
  composing the already-tested `loadConfig`/`enabledJobs`, `credentialsFromEnv`,
  and (under `--live`) `loadGoogleSheets`. Findings carry a `severity`:
  `blocking` sets exit 1, `advisory` does not (missing credentials are advisory —
  runs work until the session expires). It reads files the *run* reads, so
  `authFile`, `credentialsFile`, and `loadSheet` are injectable for tests. The
  credentials check judges a key *after* `JSON.parse`: the `\n` escapes of a key
  pasted from the GCP download have become real newlines by then, so those are the
  healthy shape and only a twice-escaped paste (backslash-n surviving the parse) is
  a mangled one. It can only `stat` the systemd `EnvironmentFile=`, never read it —
  that file is root-owned mode 600 and holds the password — so a configured host
  and an unconfigured one are told apart by its presence, not its contents, and a
  hand-run `doctor` saying "not in this process" is expected rather than a fault.
  Two checks are gated on
  the config having no `REPLACE_ME` placeholders: an unedited example's key is
  the literal string `REPLACE_ME`, so judging its shape would report a mangled
  paste that never happened, and probing with it would just fail. A missing
  `bot.config.json` is reported by `loadConfig`, so `checkTemplate` swallows its
  own read error rather than double-reporting. Keep it that way browser-free —
  `check-auth` is the browser half, and merging them makes the fast path unusable.
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
  its `tab` for logging. `batchGet` answers are paired **by request order** with
  the echoed range only cross-checked (`pairTabValues`); a mismatch throws,
  because an empty tab is otherwise indistinguishable from a failed read.
  (`bot/rosters/example.csv` is the canonical format.)
- `parseRoster` auto-detects **three** roster layouts — stacked signups export
  (a `▶` marker row), single event export (`Paid` + `Player Name` headers), and
  the legacy date-column — so a file and a sheet tab of the same shape parse
  identically. Layouts are documented in `bot/README.md`; route any new layout
  through `parseRoster` rather than adding a parallel parser.
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
- A top-level `nameMap` in `bot.config.json` maps a roster name to the member's
  CourtReserve name (some members register under a modified name because theirs
  isn't unique). `bot/name-map.ts` holds the two pure helpers: `mappedName`
  (what to type into the member search) and `playerIdentity` (what to compare
  by — alias chains followed, cycle-safe). `planSession` compares court, roster,
  and organizer names by identity, so **either** side of a mapping counts as the
  same player — a roster `Riley Poe` is neither re-added against nor removed
  from a court holding `Lee Zii Jia`. Only the mapped name is added, and
  `searchNameError` is tested on the mapped name, not the roster name. With no
  `nameMap` configured both helpers are the identity/`normalizePlayerName`
  behaviour, so an unconfigured run is unchanged. `validateConfig` rejects a
  self-mapping and two keys that normalize alike; it stores keys normalized but
  values as written, since the value is what gets typed and logged.
- A **session** is the set of bookings at the same date/time/location across
  courts. `bot/session.ts` groups them and plans the split: fill courts in
  court-number order preserving roster order, up to `courtCapacity`. It imports
  `normalizePlayerName` / `searchNameError` from `../src/players` (not the
  `../src` barrel) so comparisons stay consistent with the add flow.
  `ensure-roster` applies each court with `swapPlayersOnBooking` — one
  edit-modal save per court, and courts with no add/remove are skipped.
- Names the session has no room for are reported, never added, split two ways in
  `SessionPlan`: `overflow` is at most **one name per court**, each attributed to
  the fullest court first (`postPlayers` descending, court number as tie-break),
  since that court is the one blocking; `waitlisted` is everything past that,
  which needs a court that isn't booked yet. Both are hypothetical attributions —
  the greedy fill exhausts every free slot before anything lands there, so
  `overflow`/`waitlisted` together are just the tail of the candidate list. They
  are `warn`-level and never affect `ok`; the `waitlist` event adds how many more
  courts are needed (`capacity - 1`, since a new court has its own organizer).
- One `now` is taken per run and threaded through, so month-tab selection and the
  "next session" pick can never disagree across a midnight.
- Bot unit tests cover `csv` / `config` / `doctor` / `name-map` / `session` /
  `sheets` only. Everything else is browser- or network-dependent and validated
  by a live run — including `doctor --live`'s actual sheet read.
- Runs via `tsx` (never compiled into `dist/`); systemd units live in
  `bot/systemd/`. The bot uses the default headless client, so `auth.json` must
  exist on the machine it runs on; `my-profile/` is created by the first run if
  it wasn't copied over — and shouldn't be, since a profile carries its
  creating host's `Singleton*` symlinks and a `Last Version` pinned to that
  Chromium build. The service runs as an unprivileged account
  (`@USER@`/`@GROUP@`/`@HOME@` in `booking-buddy.service.in`, resolved by
  `install.sh` from `--user` → `$SUDO_USER` → the checkout's owner), capped by
  `TimeoutStartSec` — a missing `auth.json` hangs on the interactive
  manual-login prompt, which a `Type=oneshot` unit has no TTY for. Configuring
  credentials removes the cause: `EnvironmentFile=-/etc/booking-buddy/credentials.env`
  (leading `-` = optional) is read by systemd as root before privileges drop.
- `install.sh` seeds `<repo>/bot.config.json` from `bot/bot.config.example.json`
  at mode 600 owned by the run user, but **only when absent** — it never
  overwrites, re-owns, or re-permissions an existing one, since that file holds a
  live service-account key. It warns on a seeded file still containing
  `REPLACE_ME`, and ends by pointing at `doctor` rather than running it, because
  it can only inspect local files.
- The secret-file ownership check is **two functions**, not one:
  `check_secret_file` demands root/600 (right for `credentials.env`, read by
  systemd before privileges drop), while `check_secret_file_for_user` demands
  run-user/600 for `auth.json` and `bot.config.json`, which the bot process reads
  itself. Checking either against the other's rule makes the run fail — root/600
  is an unreadable config. Don't merge them.
- `install.sh` has no test harness and must stay root-only; its seeding path was
  exercised against a throwaway repo copy in `/tmp` with `systemctl`/`runuser`/
  `timedatectl` stubbed on `PATH`. That is the only way to test it without
  touching the real `/etc/systemd/system` — a bare sandbox copy also silently
  drops `SCRIPT_DIR`-relative template lookups, so copy `bot/systemd/` wholesale.
  A stub that ignores its arguments (which is all `check_as_user` needs of
  `runuser`) can't see a malformed `test` invocation, so that call is the one to
  re-verify by hand: `check_as_user` takes the **bare** operator (`w`, `x`) and
  prepends the `-`, because `runuser -- test w path` is a syntax error whose
  exit 2 reads as a failed permission check and warns about all four targets.
- **Unattended re-login is opt-in, in the library, not the bot.** `ClientOptions.credentials`
  (or `COURTRESERVE_USERNAME` + `COURTRESERVE_PASSWORD`) resolves through
  `src/credentials.ts`: `credentialsFromEnv()` needs **both** vars non-blank (no
  `??` default — absence is the signal) and `shouldPromptManualLogin()` is the
  only branch in `init()` choosing manual vs. credential. `init()` calls
  `ensureLoggedIn()` after its first `navigateTo`, which is the only place that
  knows the restored session was stale; `bot/ensure-roster.ts` calls it again
  before doing work (a session can drop mid-run) and `check-auth` calls it after
  `isLoggedIn()` so a self-heal logs `check-auth-relogin` at `warn` rather than
  looking healthy. A failed credential login **throws** — no fallback to the
  prompt, which could not work on the Pi anyway; `manualLogin: true` still wins
  everywhere, so `--force` on a desktop is unchanged.
- `restoreAuth` is guarded by `hasSavedAuth` inside `init()`'s non-manual branch:
  with credentials configured, a checkout with no `auth.json` now reaches that
  branch instead of the manual one, and `setStorageState` on a missing path is an
  ENOENT.
- `ensure-roster` never exits non-zero for a player-level problem, so the
  `run-end` line in `bot/ensure-roster.ts` carries a `RunTally` (sessions,
  courts edited, added/removed/skipped/failed, no-booking, no-upcoming,
  empty-roster, deferred) and logs at `warn` when any of it needs a human. That
  single line is the only way to see a run that quietly did nothing; grep it
  rather than trusting the exit code.
- Deferred on purpose, tracked in the repo's untracked `TODO` under "Pi / ops":
  logrotate for `log/` (needs `copytruncate` — pino holds an open fd), alerting
  on failure (`OnFailure=`, a `check-auth` timer, or a `--strict` exit code),
  and Chromium build drift (`package-lock.json` is gitignored, so `npm install`
  can pull a playwright needing a newer browser build).

## Never read or commit these (gitignored local state)
- `auth.json` — real logged-in Playwright storage state (live cookies).
- `/etc/booking-buddy/credentials.env` — the CourtReserve account password, read
  by the systemd unit. Lives outside the repo, so nothing new to ignore.
- `.env` — the same two variables for local work: the debug adapter reads it via
  the `envFile` key in `.vscode/launch.json` (js-debug parses it with dotenv,
  and a *missing* file is silently ignored), and `set -a; . ./.env` covers a
  plain shell. Filled in locally, never committed.
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
- `.notes/`, `.temp-data/`, `opencode.json`, `.opencode/`.
- Note: the bot entries in `.vscode/launch.json` point at
  `/home/pvan/bot.test.config.json`, a machine-local config **outside** the repo.

## Gotchas
- `headless` defaults to **true** (`process.env.HEADLESS !== "false"` in
  `src/constants.ts`); the `examples/*` force it false so a window shows for
  login.
- The browser is a **persistent** Chromium context (`launchPersistentContext`
  with `viewport: null`), so `my-profile/` is live login state layered under the
  `auth.json` storage state — refreshing one does not replace the other.
- `manualLogin` (`src/auth.ts`) navigates to **google.com**, not CourtReserve,
  and waits for Enter; log into CourtReserve in that window yourself, then the
  storage state is saved. The README's "navigate to app.courtreserve.com"
  wording does not match the code.
- Credential login uses the **email/password** form (`COURTRESERVE_*`), not
  "Continue with Google" or "Request a Code", both of which the login page also
  offers — the Google path needs a browser you log into yourself, and the code
  path needs an inbox. So an account with no CourtReserve password cannot be
  recovered unattended.
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
- `src/pending-requests.ts` tracks in-flight requests per `Page` (attached to the
  whole context, later pages included) and the URLs still outstanding are logged
  as `pending` on `navigate-timeout` / `navigate-timeout-continue`. A `commit`
  navigation can't fail on a subresource, so those URLs are the only explanation
  of why the readiness wait timed out.
- `getCurrentBookings` returns **one `Booking` per booking card, i.e. per
  court** (the `BookingSession` name is legacy) and strips the internal `page`
  field. Cards whose `details-btn` says "Details" instead of "Edit Reservation"
  are skipped silently — bookings someone else added you to.
- `filterBookings` parses a bare `yyyy-mm-dd` `date` filter as **local**
  midnight, not UTC, so it doesn't silently shift a day in negative-offset
  timezones. Keep it that way; the club is US Pacific.
- `addPlayer*`/`removePlayer*`/`swap*` all run inside `withEditModal` on a
  throwaway `context.newPage()` that is closed in `finally`, so `this.page` stays
  on the bookings list and a later `getCurrentBookings()` still works. The modal
  is saved only if the pending roster actually changed, then re-navigated to the
  detail page and re-read. `swapPlayersOnBooking` seeds its add loop from the
  **post-removal** roster, so a just-removed name isn't reported `already-added`.
- Per-player problems (not found, ambiguous, too short, already added,
  not-removable) are returned in the result; structural failures (no session,
  missing `bookingId`, page/modal not loading, failed save) throw.
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
  breaks.
- `init()` registers SIGINT/SIGTERM/`beforeExit` handlers (re-exiting 130/143
  after `close()`) and `close()` removes them, so a long-lived host process can
  run the client without leaking handlers or an orphaned browser.

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
  process, and an unattached page (a functional test's page) just logs nothing.
- Convention: user actions are logged as `info` **at the call sites** of
  `humanClick`/`navigateTo` (never inside them), phrased as instructions —
  `click Edit Reservation`, `navigate to reservation detail`, `click remove
  member`, `click Save`, `typed search`, `login submitted`, `bookings scraped`
  — so the log reads as the sequence of steps performed. Webpage feedback is
  logged at `debug` where it is read: `member-search results`, `roster read`,
  `player verified`, `login state`.
- Failure paths are logged (then rethrown/returned) rather than silently
  dropped: `init-failed`, `save-auth-failed`, `session-not-saved` (warn),
  `credential-login-failed` (username only, never the password),
  `save-timeout`/`save-failed`, `detail-load-failed`, `modal-open-failed`,
  `confirm-dialog-timeout`, `member-search-timeout`, `filter-failed`,
  `navigate-timeout` (warn), `navigate-timeout-continue` (warn), and the
  bot's `config-error`/`roster-error`/`job-error`/`init-failed`. Precondition
  guards (`"Client not initialized"`, missing `bookingId`) deliberately stay
  unlogged — logging them would create `log/` files during the no-browser unit
  tests.
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
  pruned HTML fixture. Bot functional tests belong in `bot/test/functional/`
  (`npm run test:functional` already passes that path as a filter).
- Fixtures are referenced by subpath from `test/data/` — flat files
  (`one-booking-two-people.html`, `not-logged-in.html`, …) or per-flow
  directories (`adding-player/edit-modal.html`, `removing-player/modal-player-list.html`).
  `login.test.ts`/`auth.test.ts` instead `page.route()` + `fulfill()` the
  bookings-list URL so `isLoggedIn`'s URL check is exercised.
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
  `NAV_TIMEOUT_MS`, `NAV_RETRIES`, `PORT`, `COURTRESERVE_ORG_ID`,
  `COURTRESERVE_USERNAME`, `COURTRESERVE_PASSWORD`, `LOG_PATH`,
  `LOG_LEVEL`) so default-option tests are deterministic — note they are deleted
  (not set to `""`), because `src/constants.ts` uses `??`.
- `test/data/*.html` fixtures are pruned MHTML: no CSS, images, or scripts, so
  there is no realistic layout. Assertions on geometry (`boundingBox()`,
  scrolling, hover) won't match production — only DOM structure and text are
  faithful. `humanClick` (`src/interactions.ts`) falls back to
  `locator.click()` when an element has no usable bounding box, which is what
  keeps those tests working. Provenance / re-capture steps are in
  `test/data/README` (note: its claim that the raw captures live in
  `../test-data/` is stale — they sit beside the fixtures, gitignored).
- The captures contain no JavaScript, so the interactive chain (Kendo ComboBox,
  sweetalert2 confirm, member-search XHR, save POST) is untestable offline and
  gated on a live run; `saveReservation` only asserts HTTP status.
- `init()` / `ensureLoggedIn()` are likewise untestable offline — they launch a
  persistent context against the live site — so `test/functional/login.test.ts`
  covers the sequence they are built from (logged-out list → credential login →
  logged in) instead, and `src/credentials.ts` is tested as pure functions.

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
  CSRF/token field are only validated on a live run — as is the whole unattended
  path, since a real run against the live site is the only place
  `ensureLoggedIn()` actually executes.
- The failed-login page snapshot is asserted not to contain the typed password
  (`test/functional/login.test.ts`), which holds because `fill()` sets the input's
  value *property* and `page.content()` serializes the `value` *attribute*. If a
  future change fills differently, demote `login-failed` in `src/login.ts` from
  `error` to `warn` so it stops triggering `captureFailure`.
