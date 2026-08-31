# Booking Buddy bot (`ensure-roster`)

A small CLI that keeps your existing CourtReserve bookings stocked with the
right players. For each configured job it reads a roster of signups from a CSV
(one date column per session), finds the matching bookings, groups them into
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
npx tsx bot/index.ts ensure-roster [--job <name>] [--dry-run] [--config <path>]
npx tsx bot/index.ts roster-test   [--job <name>] [--config <path>]
npx tsx bot/index.ts check-auth    [--config <path>]
```

| Command | Purpose |
|---------|---------|
| `ensure-roster` | Reconcile each job's roster with its matching sessions (add missing, remove dropped). |
| `roster-test`   | Print the parsed roster for each enabled job (no browser). |
| `check-auth`    | Verify the saved CourtReserve session still works. |

Options:

- `--job <name>` — run only the named job.
- `--dry-run` — plan only: print the session/court assignment without opening
  the edit modal (recommended first live step).
- `--config <path>` — config file to use (default `./bot.config.json`).

`ensure-roster` exits non-zero only for config/data problems (e.g. a missing
roster CSV) so `systemd` can flag them. Player-level outcomes (`not-found`,
`ambiguous`, `not-removable`, `no space`) are logged but never fail the run.

## Configuration

Copy [`bot.config.example.json`](../bot.config.example.json) to
`bot.config.json` (gitignored). Each job names the bookings to match and the
session to fill:

```json
{
  "jobs": [
    {
      "name": "tuesday-evening",
      "enabled": true,
      "match": { "weekday": "Tue", "startTime": "18:00", "location": "Bellevue" },
      "session": { "rosterFile": "bot/rosters/tuesday.csv", "courtCapacity": 6, "organizer": "Kento Momota" }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name`       | string            | Unique job identifier. |
| `enabled`    | boolean           | Default `true`; disabled jobs are skipped. |
| `match`      | object (optional) | `weekday`, `startTime`, and/or `location` (all optional). `weekday`/`startTime` are passed straight to `getCurrentBookings`; `location` is matched case-insensitively against the booking's location name (e.g. `"Bellevue"`). Omit to match all editable bookings. The specific weeks to fill come from the roster CSV's date columns, not from `match`. |
| `session.rosterFile` | string     | Path (relative to the config file) to the roster CSV. |
| `session.courtCapacity` | number | Optional, default `6`. Total players per court, **including** the organizer. |
| `session.organizer` | string     | Optional. The organizer's name — never added or removed by the bot. Strongly recommended, especially for single-court sessions where the "on every court" heuristic can't tell the organizer apart from a dropped player. |

## Roster CSV format

The header row lists one date label per column (e.g. `Aug 25th`); each column's
non-empty cells below the header are the player names signed up for that date.
A name can appear under several dates. Columns whose header is not a date (e.g.
a stray `name` label) are ignored, surrounding whitespace/quotes are trimmed,
and duplicates within a column are dropped. Names must match the club's member
directory exactly — the member search is exact-match-first and requires at
least 3 letters.

```
Aug 25th,Sep 1st,Sep 8th
Kento Momota,Kento Momota,Viktor Axelsen
Viktor Axelsen,Chen Long,Chen Long
Chen Long,,
```

Dates are matched to bookings by month and day (year is ignored). If a booking
exists but has no date column in the CSV, the session is left untouched; if a
date column exists but the courts for that date haven't been booked yet, it is
reported and skipped. A date column applies to every session on that date, so
set `match.startTime` when a day could have more than one session.

## How a run works

1. Load `bot.config.json` and select enabled jobs.
2. For each job, read the roster CSV (date → players) and call
   `getCurrentBookings(match)`.
3. Group the bookings into sessions by date/time/location (`bot/session.ts`).
4. For each session, look up the roster column for its date. If there is no
   column, leave the session untouched and report it. Otherwise plan the
   session: fill courts in court-number order, preserving roster order, up to
   `courtCapacity` (the organizer already occupies a slot on every court).
   Names in the roster but on no court are added; names on a court but no
   longer in the roster are removed — except the organizer (and any name on
   every court). A removal frees a slot, so a dropped player's court can absorb
   a replacement in the same run. Names too short to search and names that
   exceed the total free slots are reported.
5. Report any roster date column with no matching booking (courts not booked
   yet).
6. In `--dry-run`, print the assignment. Otherwise `swapPlayersOnBooking()`
   removes and adds each court's players in a single edit-modal save and logs
   removed/added/skipped/failed.

The client uses the default headless browser, so `auth.json` and `my-profile/`
must exist in the working directory.

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
