# Booking Buddy bot (`ensure-roster`) — features

## CLI
- **Commands**
  - `ensure-roster` — reconcile each job's roster with its matching bookings
  - `roster-test` — print parsed roster per date (no browser)
  - `check-auth` — verify saved CourtReserve session still works (via `isLoggedIn()`)
- **Options**
  - `--job <name>` — restrict to a single job
  - `--dry-run` — plan-only, print diff without editing
  - `--headed` — run a visible browser (default headless)
  - `--config <path>` — alternate `bot.config.json` (default `./bot.config.json`)
- **Exit codes** — non-zero only for config/data errors (e.g. missing CSV); player-level outcomes never fail the run

## Configuration (`bot/config.ts`)
- **Job definitions**
  - `name` — unique identifier
  - `enabled` — boolean (default `true`)
  - `match` — `weekday` / `startTime` filters + case-insensitive `location` (specific weeks come from the CSV's date columns)
- **Session definition**
  - `rosterFile` — CSV path (relative to config)
  - `courtCapacity` — default 6, includes organizer
  - `organizer` — name never added/removed
- **Validation** — strict schema validation with descriptive `ConfigError`s (duplicate names, malformed fields, missing jobs)

## Roster CSV (`bot/csv.ts`)
- **Format-agnostic API** — `parseRoster` auto-detects the format and returns a `RosterSet` of dated `Roster`s (`date`, optional `year`/`startTime`, `players`); `RosterSet.find(date)` is the single stable lookup
- **Auto-detection** — signups export recognized by `Player Name` at (row4,col3); event export by `Paid` + `Player Name` headers; otherwise legacy date-column
- **Signups export (fixed coordinates)** — `Date` at (row2,col2), `Start Time` at (row2,col3), player names in col3 from row5 (`M/D/YYYY` or zero-padded, year used when present); every other column/row ignored
- **Event-export fallback** — keyword-based `Date`/`Start Time`/`Player Name` (one event per file)
- **Legacy date-column** — header row is date labels (`Aug 25th`), each column lists that date's players (year-less)
- Date-label parsing (3-letter or full month, optional ordinal suffix); skips non-date columns/rows; trims whitespace/quotes, drops duplicates (case-insensitive, first wins)
- `find` matches by month/day, requiring an exact year only when the roster carries one; descriptive read errors

## Session planning (`bot/session.ts`)
- **Grouping** — bookings grouped by (date, startTime, location); courts sorted by number, sessions chronological
- **Reconciliation**
  - Add names on no court into free slots (roster order, court-number order)
  - Remove names on a court no longer in roster
  - Organizer (and "on every court" names) never removed
- **Name classification** — satisfied (on every court), already-placed (on some courts, left alone to avoid churn), too-short (search-ineligible), overflow (exceeds free slots)
- **Slot reuse** — removals free capacity, so a dropped player's court absorbs a replacement in the same run

## Execution (`bot/ensure-roster.ts`)
- Bail after `init()` when `isLoggedIn()` is false (stale/expired session)
- Per-job run with isolated error handling (one job's failure doesn't stop others)
- Per-date reconciliation: sessions whose date has no roster are skipped; rosters with no booking are reported
- Structured per-session/court logging (add/remove/already-placed/satisfied/overflow)
- Live apply via `swapPlayersOnBooking` (one edit-modal save per court), logging `removed/added/skipped/failed`

## Scheduling (systemd)
- `booking-buddy.service.in` — templated unit (`@REPO_DIR@` placeholder)
- `booking-buddy.timer` — daily `OnCalendar` trigger (Persistent)
- `install.sh` — path-agnostic installer (auto-detects or takes repo path, substitutes, installs, enables timer)
