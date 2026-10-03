# Booking Buddy bot (`ensure-roster`)

A small CLI that keeps your existing CourtReserve bookings stocked with the
right players. For each configured job it reads a roster of signups from a CSV
(one roster per dated session), finds the matching bookings, groups them into
**sessions** (same date, time, and location across multiple courts), and
reconciles each date's roster across those courts: it adds names that are
missing and removes names that are no longer in the roster. The roster is the
source of truth, and the organizer is never removed, so it is safe to run on a
schedule.

It runs on top of the [`CourtReserveClient`](../src/client.ts) library in this
repo and is driven by [`bot.config.json`](#configuration).

## Sessions

A session is a group of bookings at the same date, time, and location spread
across courts (e.g. three courts booked for one evening). The roster of signups
is split across the session's courts, respecting the per-court capacity. The
organizer — named in `session.organizer` — appears on every court and is never
added or removed by the bot.

## Commands

```
npx tsx bot/index.ts ensure-roster [--job <name>] [--dry-run] [--headed] [--config <path>]
npx tsx bot/index.ts roster-test   [--job <name>] [--config <path>]
npx tsx bot/index.ts check-auth    [--config <path>]
```

| Command | Purpose |
|---------|---------|
| `ensure-roster` | Reconcile each job's roster with its matching sessions (add missing, remove dropped). |
| `roster-test`   | Print the parsed roster for each enabled job (no browser). |
| `check-auth`    | Verify the saved CourtReserve session still works (via `isLoggedIn()`). |

Options:

- `--job <name>` — run only the named job.
- `--dry-run` — plan only: print the session/court assignment without opening
  the edit modal (recommended first live step).
- `--headed` — run a visible browser instead of headless (for watching a local
  run; the default is headless).
- `--config <path>` — config file to use (default `./bot.config.json`).

`ensure-roster` exits non-zero only for config/data problems (e.g. a missing
roster CSV) so `systemd` can flag them. Player-level outcomes (`not-found`,
`ambiguous`, `not-removable`, `no space`) are logged but never fail the run.
Both `ensure-roster` and `check-auth` abort after `init()` if `isLoggedIn()`
is false (a stale/expired session), so a failure can be flagged to `systemd`.

## Configuration

Copy [`bot.config.example.json`](bot.config.example.json) to
`bot.config.json` (gitignored). Each job names the bookings to match and the
session to fill:

```json
{
  "google": {
    "serviceAccount": {
      "type": "service_account",
      "project_id": "...",
      "private_key_id": "...",
      "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
      "client_email": "...",
      "client_id": "..."
    }
  },
  "jobs": [
    {
      "name": "tuesday-evening",
      "enabled": true,
      "match": { "weekday": "Tue", "startTime": "18:00", "location": "Bellevue" },
      "session": { "roster": "bot/rosters/tuesday.csv", "courtCapacity": 6, "organizer": "Kento Momota" }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name`       | string            | Unique job identifier. |
| `enabled`    | boolean           | Default `true`; disabled jobs are skipped. |
| `match`      | object (optional) | `weekday`, `startTime`, and/or `location` (all optional). `weekday`/`startTime` are passed straight to `getCurrentBookings`; `location` is matched case-insensitively against the booking's location name (e.g. `"Bellevue"`). Omit to match all editable bookings. The specific weeks to fill come from the roster's dates, not from `match`. |
| `session.roster` | string or object | The roster source. A **string** is a path (relative to the config file) to a local CSV. An **object** with `"sheet"` is a Google Sheet (see below). |
| `session.courtCapacity` | number | Optional, default `6`. Total players per court, **including** the organizer. |
| `session.organizer` | string     | Optional. The organizer's name — never added or removed by the bot. Strongly recommended, especially for single-court sessions where the "on every court" heuristic can't tell the organizer apart from a dropped player. |
| `google.serviceAccount` | object | Required when any job uses a Google Sheet. The full service-account key, inline (only `client_email` and `private_key` are used). |

## Google Sheets source

A job can read its roster from a Google Sheet instead of a CSV file. Set
`session.roster` to an object:

```json
"session": { "roster": { "sheet": "https://docs.google.com/spreadsheets/d/<ID>/edit" } }
```

- `sheet` — either the full share URL (the spreadsheet id is parsed out) or a
  bare spreadsheet id.
- `range` — optional A1 range, e.g. `"Signups!A1:Z200"`. When set, exactly that
  range is read and no tab is selected. Omit it for the month-tab behaviour
  below.

Auth uses a Google **service account** via the inline
`google.serviceAccount` key. The sheet is fetched as CSV text and parsed by the
same format auto-detection as local files, so the source makes no difference to
parsing.

### Month tabs

The spreadsheet is organized **one tab per month** — `Sept-2026`, `Oct 2026`,
… — and each tab holds a month of stacked sessions (see
[Roster CSV format](#roster-csv-format)). On each run the bot reads the tab for
the current month **and the next one**, which is the window a booking can
plausibly fall in, and merges their sessions into one roster list. A run on
September 30th still finds October 5th's session.

Tab names are matched leniently: a title needs a month name (the first three
letters are enough, so `Sept`, `Sep` and `September` all work) and a four-digit
year anywhere in it, with any separator. `Sept-2026`, `Sept 2026`,
`September 2026` and `Rosters — Oct 2026` are all recognized; tabs that name no
month (`Readme`, `Sheet1`) are ignored. If no tab matches, the run fails with
the list of tab names it found — usually a sign the tabs are named unusually.

A missing month is not an error: the run simply uses whichever of the two tabs
exists.

### Setting up the service account

1. **Create a project** (or reuse one) in the
   [Google Cloud Console](https://console.cloud.google.com/). You don't need a
   billing account — the Sheets API has a generous free tier.
2. **Enable the Google Sheets API**: *APIs & Services → Library* → search
   "Google Sheets API" → **Enable**. (No OAuth consent screen is needed for a
   service account.)
3. **Create the service account**: *IAM & Admin → Service Accounts → Create
   Service Account*. Give it a name (e.g. `booking-buddy`) and create it —
   no roles/grant steps required.
4. **Create a key**: open the new service account → *Keys → Add Key → Create
   new key → JSON*. This downloads a `*.json` file.
5. **Paste the key into the config**: copy that file's contents into
   `bot.config.json` under `google.serviceAccount`. The key is JSON with an
   escaped `private_key` (literal `\n` newlines) — paste it verbatim; only
   `client_email` and `private_key` are actually read.
6. **Share the spreadsheet**: open the target sheet → *Share* → add the
   service account's `client_email` as a **Viewer** (the bot only reads). This
   is required even for a "link shareable" sheet, since the service account is a
   distinct identity.

Verify with `roster-test` (no browser, prints the parsed names, and marks the
session the next run would edit with `NEXT`):

```
npx tsx bot/index.ts roster-test --config bot.config.json
```

Common failure: a "not found" / "permission denied" error from the Sheets API
almost always means step 6 was missed, or the wrong `spreadsheetId`/URL was
configured.

## Roster CSV format

Two formats are supported, and the loader (`parseRoster` in `bot/csv.ts`)
auto-detects which one a file is. Both normalize to the same stable shape — a
list of dated rosters — so the format can change again without touching the
consumers.

### CourtReserve signups export (current)

One or more events' signups as exported from CourtReserve, stacked vertically in
a single sheet. Each event begins with a row whose first cell is the `▶` marker,
followed by a `Date` / `Start Time` value row, an optional blank row, then a
`#`/`Paid`/`Player Name` table. Columns are located by header keyword within
each block (not fixed position), so blocks with different widths are all read.
Every `▶` block becomes one dated roster.

```
▶,Date,Start Time,Hrs,Location,Host,Courts,Max Players,...
,9/7/2026,6:30 PM,2,BBC Mukilteo,Taufik Hidayat,"1, 3, 4, 5",24,....
,,,,,,,,
#,Paid,Player Name,,Pos,Ct 1,Ct 3,Ct 4,Ct 5,
1,FALSE,Chou Tien-chen,,P1,Chou Tien-chen,...
2,FALSE,Chen Chia Hung,,P2,Kento Momota,...
...
▶,Date,Start Time,Hrs,...
,9/14/2026,6:30 PM,2,...
#,Paid,Player Name,...
1,FALSE,Alice,...
```

The date may be `M/D/YYYY` or `MM/DD/YYYY`; the year is used when present. The
start time (e.g. `6:30 PM` → `18:30`) is read from each block. Blocks whose date
is missing or unparseable are skipped, so past/future blocks without signups
still surface as empty rosters.

One tab holds a whole month of these blocks, and a spreadsheet of month tabs
holds several months; they are merged into a single list of dated sessions.

### Legacy date-column

The header row lists one date label per column (e.g. `Aug 25th`); each column's
non-empty cells below the header are that date's players. Year-less, so dates
are matched by month/day only.

```
Aug 25th,Sep 1st,Sep 8th
Kento Momota,Kento Momota,Viktor Axelsen
Viktor Axelsen,Chen Long,Chen Long
Chen Long,,
```

In both formats: a name can appear under several dates, columns/rows that aren't
a recognizable date or the player list are ignored, whitespace/quotes are
trimmed, and duplicates are dropped. Names must match the club's member
directory exactly — the member search is exact-match-first and requires at
least 3 letters.

Dates are matched to bookings by month and day; the year is ignored even when
a roster carries one (some exports), so a signup exported in one year still
matches the booking in the next. If a booking exists but has no roster for that
date, the session is left untouched; if a roster date has no booking, it is
reported and skipped. A roster applies to every session on that date, so set
`match.startTime` when a day could have more than one session.

### Which session a run edits

A run reconciles **one** session: the closest one still ahead of the run. Once a
session's date (and start time, where the sheet records one) has passed, the
next one is picked, so a run walks forward through the month as the weeks go by
and never re-edits a game that has already happened. The other sessions in the
tab are logged as deferred (at `debug`). Once every session has passed, the run
reports that there is nothing to do.

Two consequences worth knowing:

- If the next session's courts aren't booked yet, the run does nothing that day
  and the next scheduled run picks it up once the booking appears.
- A month tab opens with its upcoming blocks **empty** until names are typed in,
  and an empty roster is authoritative — the courts get cleared of everyone not
  on it. The run logs `empty-roster` at `warn` before doing so, so check that
  line first if a session's players suddenly vanish.

## How a run works

1. Load `bot.config.json` and select enabled jobs.
2. Load each job's roster (CSV file, or the current and next month tabs of a
   Google Sheet) up front, so a missing file or a sheet auth/network failure
   fails the run before any browser opens.
3. Initialize the client and bail early if `isLoggedIn()` is false.
4. For each job, call `getCurrentBookings(match)`.
5. Group the bookings into sessions by date/time/location (`bot/session.ts`).
6. Pick the job's **closest upcoming** roster session and find its booking —
   matching by month/day, and by start time when the roster carries one. With
   no such session, report that there is nothing to do. With no matching
   booking, report it and move on.
7. Plan the session: fill courts in court-number order, preserving roster
   order, up to `courtCapacity` (the organizer already occupies a slot on every
   court). Names in the roster but on no court are added; names on a court but
   no longer in the roster are removed — except the organizer (and any name on
   every court). A removal frees a slot, so a dropped player's court can absorb
   a replacement in the same run. Names too short to search and names that
   exceed the total free slots are reported.
8. In `--dry-run`, print the assignment. Otherwise `swapPlayersOnBooking()`
   removes and adds each court's players in a single edit-modal save and logs
   removed/added/skipped/failed.

The client uses the default headless browser, so `auth.json` and `my-profile/`
must exist in the working directory.

## Logging

Every run writes two date-stamped JSON-lines files (one event per line with
`time`, `level`, `msg`, and context fields):

- `log/booking-buddy-<date>.log` — the library's own lifecycle and per-player
  outcomes (init, login, modal open/save, add/remove/swap outcomes).
- `log/bot-<date>.log` — the bot's orchestration (run/job/session plan, swap
  summaries, per-player failures, errors with stack traces).

The directory is resolved per layer: `--log-path` (bot) / `ClientOptions.logPath`
(library) → `LOG_PATH` env var → `<cwd>/log`. File names are fixed. `LOG_LEVEL`
(default `info`) controls verbosity (`debug` for extra detail). The `log/`
directory is gitignored, and console output is unchanged — each event is also
mirrored to stdout/stderr.

To review a failed run: `jq . log/bot-<date>.log`, or
`grep '"level":"error"' log/bot-<date>.log`.

## Scheduling on an always-on machine

See [`bot/systemd/README.md`](systemd/README.md) for a daily `systemd` timer.

## Tests

Unit tests (no browser) cover `bot/csv.ts`, `bot/config.ts`, and
`bot/session.ts`:

```
npx vitest run bot/test
```

Browser-dependent behavior has no functional tests yet; when added they live
in `bot/test/functional/` (mirroring the root `test/functional/` split). Run
all unit tests repo-wide with `npm run test:unit`.

Typecheck the bot (the `npm run build` only covers `src/`):

```
npx tsc --noEmit -p tsconfig.bot.json
```
