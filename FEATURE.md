# Features — the library (`src/`)

What the `CourtReserveClient` library does, plus the engineering features around
it. The bot that builds on it is documented separately in
[`bot/FEATURE.md`](bot/FEATURE.md).

## Client
- One `CourtReserveClient` drives everything; `init()` prepares the browser and
  `close()` tears it down.
  - Configured with `headless`, `authPath`, `profileDir`, `manualLogin`,
    `credentials`, `debugPause`, `logPath`, `logLevel` (most also read an env
    var).
  - Every method is guarded against use before `init()`.
- `getCurrentBookings(filters?)` reads the bookings list.
  - Filters by weekday, date, or start time; a bare `yyyy-mm-dd` date is read as
    local midnight so it can't shift a day.
  - Returns one `Booking` per card with its id, weekday, times, court number and
    location, and player list.
- `addPlayerToBooking` / `addPlayersToBooking` add players to a booking.
  - One modal session and one save for the whole batch.
  - Per-player results: `added`, `skipped` (`already-added`), `failed`
    (`not-found`, `ambiguous`, `query-too-short`, `not-added`), plus `saved` and
    the roster read back afterwards.
  - Duplicate requests within one batch are skipped too.
- `removePlayerFromBooking` / `removePlayersFromBooking` remove players.
  - One modal session and one save for the whole batch.
  - Per-player results: `removed`, `skipped` (`not-in-roster`), `failed`
    (`not-removable`, e.g. the reservation owner), plus `saved` and the roster.
- `swapPlayersOnBooking(booking, remove, add)` does both in a single save.
  - Removes first, then adds against the post-removal roster, so a just-removed
    player is not reported as already added.
  - Merged `removed` / `added` / `skipped` / `failed` result.
- `isLoggedIn()` and `loginWithCredentials(user, password)` for stale sessions.
- `ensureLoggedIn()` re-authenticates a stale session with the configured
  credentials, and is what `init()` and long-running callers use.
- `getPlayersFromBooking(booking)` is a convenience accessor.
- Problems are separated by severity.
  - Per-player problems come back in the result and never throw.
  - Structural problems (not initialized, missing booking id, page or modal not
    loading, failed save) throw.
- Editing happens on a throwaway page, closed in a `finally`.
  - The bookings-list page is left intact for later reads.
  - The modal is saved only when the pending roster actually changed;
    otherwise it is closed unsaved and the original roster is returned.
  - The persisted roster is re-read from the detail page after a save.

## Player search
- Member search is driven through the site's combo box.
  - Typed per character, clearing the field first, so the widget's debounce
    keeps up.
  - Waits for options or an explicit "no data" state before reading results.
- Name matching prefers an exact normalized match over a substring match.
  - Normalization trims, collapses whitespace, casefolds, and drops the trailing
    characters the site appends to some names.
  - A unique substring match still resolves; many matches report `ambiguous`
    with the candidates.
- Queries with fewer than three letters are rejected before searching.
- A just-added player is confirmed present in the pending roster before the
  save, not assumed from the click.
- Removals match on exact normalized equality only, never a substring, and need
  no confirmation dialog.

## Sessions and login
- The browser is a persistent Chromium profile, layered with a saved storage
  state.
  - First run (or `manualLogin`) opens a window, waits for Enter, and saves the
    session.
  - Later runs restore the saved session.
  - The session is re-saved on close only while still logged in, so an expired
    session never overwrites a good one.
- Unattended re-login when the restored session has gone stale.
  - Opt-in credentials, from the constructor option or the environment.
    Unset means today's behaviour throughout.
  - `init()` checks the login state after its first navigation and logs back in
    if needed, so a missing session no longer means an interactive prompt on a
    headless host.
  - `ensureLoggedIn()` exposes the same recovery to callers that outlive the
    session they started with.
  - An explicit `manualLogin` always wins, so a desktop run can still log in
    interactively.
  - A failed credential login throws rather than falling back to the prompt.
- Credential login submits the site's login form and treats leaving the login
  URL as success.
  - Refreshes the saved session and returns to the bookings list.
  - The username may be logged; the password never is, and not in the
    failed-login page snapshot either.
- Shutdown is handled for the host process.
  - SIGINT and SIGTERM close the browser, then re-exit with the conventional
    code.
  - A drained event loop closes the browser too; `close()` unregisters the
    handlers so a long-lived host leaks nothing.

## Scraping and parsing
- All scraping keys off the site's test ids, so a pruned HTML fixture behaves
  like the live page.
- Bookings the current user cannot edit are skipped silently.
- Date, time, court, player and booking-id parsing are pure functions.
- Parsers are unit-testable without a browser.

## Stealth and resilience
- Random pauses before every navigation, click, and per-player step.
- Clicks scroll into view and use real mouse movement, with a fallback when an
  element has no usable box.
- Navigation commits on response headers and waits for a caller-supplied
  readiness selector instead of `DOMContentLoaded`, so a stalled third-party
  subresource can't fail a page that is already on screen.
  - One retry, and a probe before each retry that proceeds as soon as the
    content appears.
  - Outstanding in-flight request URLs are reported when a wait does time out.
- Edit-modal work is scoped to the modal, so the page behind it is never
  touched by mistake.

## Observability
- JSON-lines logging to a date-stamped file, mirrored to the console.
  - Log directory resolution: explicit option, then env var, then `./log`.
  - Level defaults to `info`; file logging can be switched off entirely.
  - Files are created lazily on the first write, so tests never litter `log/`.
- The log reads as the steps performed.
  - User actions are logged where they are triggered.
  - Page feedback (search results, roster reads, verifications, login state) is
    logged where it is read.
  - Every failure path is logged before it is rethrown or returned.
- HTML snapshots of the page are written on hard failures, with the path
  recorded next to the log line.
  - A failed snapshot never masks the original error.
  - Precondition guards stay unlogged, so no-browser unit tests stay quiet.
- The logger is attached per page, so helper functions log without threading a
  logger through every signature and two clients can share a process.

## Tooling
- Tests split by cost: fast unit tests with no browser, and functional tests
  driving real Chromium against HTML fixtures.
  - Fixtures are pruned captures with no CSS, images, or scripts.
  - Login tests serve the page from a route instead.
  - Timezone-pinned, and inherited env vars cleared so default-option tests are
    deterministic.
- `npm run build` compiles the library to `dist/`.
- `PLAYWRIGHT_DEBUG_PORT` opens a DevTools-protocol port on the launched browser,
  so a run can be watched or inspected from another machine. Off unless set, and
  loopback-bound, so it needs an SSH tunnel to reach.
- Example scripts cover listing bookings, adding, removing, and swapping a player, each
  with a flag to force a fresh login and a visible window.
- No lint, formatter, or CI — the two TypeScript checks are the static net.