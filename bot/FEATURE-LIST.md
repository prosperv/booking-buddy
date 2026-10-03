# Booking Buddy bot (`ensure-roster`) — features

## CLI
- **Commands**
  - `ensure-roster` — reconcile each job's roster with its matching bookings
  - `roster-test` — print parsed roster per date (no browser), marking the session the next run would edit
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
  - `roster` — a local CSV path (relative to config) or a Google Sheet object `{ sheet: "<url|id>", range? }`
  - `courtCapacity` — default 6, includes organizer
  - `organizer` — name never added/removed
- **Google Sheets** — `google.serviceAccount` (inline key) is required when a job uses a sheet; `bot/sheets.ts` reads the roster spreadsheet's **month tabs** (this month + next, matched leniently by `parseMonthTitle`/`pickMonthTabs`, non-month tabs ignored) and re-serializes each via `matrixToCsv` into `parseRoster`; an explicit `range` bypasses tab selection
- **Validation** — strict schema validation with descriptive `ConfigError`s (duplicate names, malformed fields, missing jobs, missing service account for sheet jobs)

## Roster CSV (`bot/csv.ts`)
- **Format-agnostic API** — `parseRoster` auto-detects the format and returns a `RosterSet` of dated `Roster`s (`date`, optional `year`/`startTime`/`tab`, `players`); `RosterSet.find(date)` (by month/day) and `RosterSet.next(from, {startTime?})` (closest upcoming session) are the stable lookups
- **Multi-tab** — `parseRosterAll` merges several sources (one per sheet tab) into one `RosterSet`, tagging each roster with the tab it came from
- **Auto-detection** — signups export recognized by a leading `▶` marker row (one block per event); event export by `Paid` + `Player Name` headers; otherwise legacy date-column
- **Signups export (stacked)** — each `▶` block is one event: `Date`/`Start Time` located by header keyword within the block, `Player Name` table read from its column (`M/D/YYYY` or zero-padded, year used when present); multiple blocks → multiple rosters, blocks with unparseable dates are skipped
- **Event-export fallback** — keyword-based `Date`/`Start Time`/`Player Name` (one event per file)
- **Legacy date-column** — header row is date labels (`Aug 25th`), each column lists that date's players (year-less)
- Date-label parsing (3-letter or full month, optional ordinal suffix); skips non-date columns/rows; trims whitespace/quotes, drops duplicates (case-insensitive, first wins)
- `next()` compares a dated roster at its full date+start time and a year-less one at its next occurrence, so a run advances to the following session as the previous one passes; `find` matches by month/day only; descriptive read errors

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
- One session per run: the job's closest upcoming roster is reconciled (a `match.startTime` narrows it to that slot), the rest logged as deferred; nothing upcoming is reported, and a selected roster with no booking is reported
- An empty roster stays authoritative (courts are cleared) but is logged as `empty-roster` first, since a month tab's future blocks start out unfilled
- Structured per-session/court logging (add/remove/already-placed/satisfied/overflow)
- Live apply via `swapPlayersOnBooking` (one edit-modal save per court), logging `removed/added/skipped/failed`

## Scheduling (systemd)
- `booking-buddy.service.in` — templated unit (`@REPO_DIR@` placeholder)
- `booking-buddy.timer` — daily `OnCalendar` trigger (Persistent)
- `install.sh` — path-agnostic installer (auto-detects or takes repo path, substitutes, installs, enables timer)
