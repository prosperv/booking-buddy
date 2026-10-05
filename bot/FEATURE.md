# Features — the `ensure-roster` bot

What the `bot/` CLI does on top of the library (see
[`../FEATURE.md`](../FEATURE.md) for the client itself). Prose docs live in
[`README.md`](README.md).

## CLI
- Three commands:
  - `ensure-roster` — reconcile each job's roster with its matching bookings.
  - `roster-test` — print the parsed rosters with no browser, marking the
    session the next run would edit and any name a map rewrites.
  - `check-auth` — verify the saved CourtReserve session still works.
- Options: `--job <name>`, `--dry-run`, `--headed`, `--config <path>`,
  `--log-path <dir>`.
  - Headless by default, visible with `--headed`.
  - Dry run plans and prints the diff without ever opening the edit modal.
- Exit codes signal config or data problems only; player-level outcomes never
  fail a run.
- Uncaught exceptions and rejections are logged with stack traces and exit 1.

## Configuration
- A list of jobs, each a recurring slot plus its roster.
  - `name`, `enabled` (default on), and a `match` of weekday / start time /
    location.
  - `location` is a case-insensitive bot-side filter, not a scrape parameter.
- Per job, a session definition.
  - `roster` — a local CSV path (relative to the config file) or a Google Sheet
    by URL or id, with an optional A1 range.
  - `courtCapacity` — defaults to 6 and includes the organizer.
  - `organizer` — a name that is never removed.
- A global player name map.
  - Roster name → CourtReserve member name, for members who registered under a
    modified name because theirs isn't unique.
  - Keys are normalized, values are kept as written (the value is what gets
    typed and logged).
- An inline Google service-account key, required when any job reads a sheet.
- Validation is strict and fails loudly.
  - Path-like messages for duplicate job names, malformed fields, an empty job
    list, a missing service account, and a name map that self-maps or has two
    entries normalizing alike.
  - Roster sources are normalized into a discriminated union, so callers branch
    on the source kind, not the JSON shape.

## Roster sources
- One format-agnostic parser, fed by whichever source the job uses.
  - The stacked signups export is recognized by its marker row, one block per
    event, each with its own date, start time, and player table.
  - A single-event export is recognized by its paid and player-name headers.
  - Otherwise the legacy date-column layout is assumed.
  - A file and a sheet tab of the same shape parse identically.
- Parsed rosters carry their date, year and start time where known, plus the tab
  they came from.
  - Lookups: find by month and day, and pick the closest upcoming session so a
    run walks forward through the month.
  - Names are trimmed, de-duplicated case-insensitively, and unparseable
    columns and events are skipped rather than failing the run.
- Several sources merge into one set of rosters.
  - Used to stitch a month of tabs into a single schedule.
- Google Sheets are read with the service account, one tab per month.
  - The current month plus the next are selected from lenient tab titles
    (a three-letter month and any four-digit year is enough); non-month tabs are
    ignored.
  - An explicit range bypasses tab selection.
  - All selected tabs are fetched in one batched call and paired back to their
    titles by request order, with the echoed range only cross-checked.
  - A short or mismatched answer throws, so an empty tab is never mistaken for a
    failed read and planned against as an empty roster.
  - Every tab is re-serialized to CSV so it flows through the same parser.
- Roster loading happens before the browser opens, so a missing file or an auth
  failure fails fast.

## Session planning
- Bookings are grouped into sessions by date, start time, and location.
  - Courts sorted by number, sessions in chronological order.
- The roster is authoritative: names on no court are added, names on a court
  that are no longer on the roster are removed.
- The organizer is protected but never added.
  - Any name appearing on every court of a multi-court session is treated the
    same way.
  - The organizer must therefore already be booked onto every court.
- Each roster name is classified.
  - On every court: satisfied.
  - On some courts: left alone, so re-running never churns an assignment.
  - On no court and too short to search: flagged rather than assigned.
  - On no court and beyond the free slots: reported, split two ways.
    - Overflow: at most one name per court, attributed to the fullest court
      first, since that court is the one actually blocking.
    - Waitlisted: everything past one per court, which needs a court that is not
      booked yet.
    - Both are hypothetical — no court had room, so neither was added.
- Slot filling respects court capacity.
  - Roster order preserved, courts filled in court-number order.
  - Removals free capacity, so a dropped player's court absorbs a replacement in
    the same run.
- With a name map configured, court, roster, and organizer names are compared
  by identity.
  - Either side of a mapping counts as the same player, so no double-add and no
    spurious removal.
  - Only the mapped name is searched and reported, and searchability is tested
    on the mapped name.
  - Mapping chains resolve to one identity, and a cycle still resolves
    consistently.

## Execution
- The saved session is re-checked before any editing, so a stale session aborts
  the run instead of failing player by player.
- One session per job per run.
  - The job's closest upcoming roster is reconciled; the rest are logged as
    deferred, and a job with nothing upcoming is reported and skipped.
  - A job pinning a start time only considers rosters in that slot, so two jobs
    can share one sheet.
  - A selected roster with no matching booking is reported, not failed.
- One instant is taken per run and threaded through, so the tabs read and the
  session picked can never disagree across a midnight.
- An empty roster is still authoritative — the courts are cleared of everyone not
  on it — but is warned about first, since a month tab's future blocks start out
  unfilled.
- Applied live one court at a time.
  - One edit-modal save per court, through the client's swap call.
  - Courts with nothing to add or remove are skipped entirely.
- Each job is isolated, so one job's failure doesn't stop the others.
- Structured logging per run: roster reads, the selected and deferred sessions,
  the name mappings applied, per-court adds and removes, satisfied/too-short
  names, per-court overflow and waitlisted names, and per-swap
  saved/removed/added/skipped/failed counts.
  - The run's outcome decides the exit code, so a data problem is visible to
    the scheduler.

## Scheduling
- Templated systemd service unit, with the repo path substituted at install
  time.
- Daily, persistent timer — safe because the job is idempotent and skips players
  who are already on a court.
- A path-agnostic installer that detects or accepts the repo path, installs both
  units, and enables the timer.
- Two date-stamped JSON-lines logs per run (library and bot), so
  `journalctl` and the log files tell the same story.

## Testing
- Unit tests cover the browser-free logic: roster parsing, config validation,
  the name map, session planning, and sheet range/tab handling.
  - Fixtures are per-tab CSVs in the real CourtReserve export layout, so month
  merging and closest-upcoming-session selection are tested against the real
  format.
  - The Google client is exercised through testable seams (range parsing, tab
  picking, answer pairing) instead of network calls.
- Everything else is browser- or network-dependent and validated by a live run.
- The bot is typechecked as CommonJS alongside the library, since it runs through
  `tsx` and is never compiled into `dist/`.