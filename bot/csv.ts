import fs from "node:fs";

const MONTHS: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
};

const MONTH_NAMES: Record<number, string> = {
    1: "jan",
    2: "feb",
    3: "mar",
    4: "apr",
    5: "may",
    6: "jun",
    7: "jul",
    8: "aug",
    9: "sep",
    10: "oct",
    11: "nov",
    12: "dec",
};

/**
 * A single dated list of signups, abstracted away from how the CSV lays it
 * out. This is the stable unit the rest of the bot consumes — whether the
 * source file is the legacy date-column layout or the CourtReserve event
 * export, callers only ever see `Roster` objects.
 */
export type Roster = {
    /** Signup date. When the source omits the year, `date` carries month/day only (year 1970). */
    date: Date;
    /** Signup year, when the source carries one; `undefined` for year-less sources. */
    year?: number;
    /** Signup start time, parsed to `"HH:MM"` (24h), or `undefined` when the source omits it. */
    startTime?: string;
    /** Player names signed up, trimmed, deduped, in source order. */
    players: string[];
};

/**
 * A collection of rosters plus a stable lookup: `find(date)` returns the
 * roster matching a booking date. This is what `parseRoster` and
 * `loadRosterFile` return, and it is format-agnostic — callers never see
 * columns, headers, or any layout detail.
 */
export type RosterSet = {
    rosters: Roster[];
    /** Returns the roster whose date matches `date`, or `undefined` when none does. */
    find(date: Date): Roster | undefined;
};

/**
 * Parses a date label like "Aug 25th", "Sep 1", or "September 25th" into its
 * month and day. The year is not part of the label, so it is not represented.
 * Returns `null` for anything that is not a recognizable date (e.g. an empty
 * cell or a stray "name" label).
 */
export function parseDateLabel(label: string): { month: number; day: number } | null {
    const match = /^\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*$/.exec(label);
    if (!match) return null;

    const month = MONTHS[match[1].toLowerCase().slice(0, 3)];
    if (month === undefined) return null;

    const day = Number(match[2]);
    if (day < 1 || day > 31) return null;

    return { month, day };
}

/**
 * Parses an ambiguous numeric date string into month/day (and year when
 * present). Used by the event-export format, whose `Date` cell may arrive as
 * `M/D/YYYY` or `M/D` (year-less), with the month and day either zero- or
 * non-zero-padded. Falls back to `parseDateLabel` so a written month
 * (e.g. "Aug 25th") still resolves. Returns `null` when unrecognizable.
 */
function parseNumericDate(label: string): { month: number; day: number; year?: number } | null {
    const text = label.trim();
    const match = /^\s*(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\s*$/.exec(text);
    if (!match) {
        const fallback = parseDateLabel(text);
        return fallback ? { ...fallback } : null;
    }

    const first = Number(match[1]);
    const second = Number(match[2]);

    let month: number;
    let day: number;
    if (first >= 1 && first <= 12) {
        month = first;
        day = second;
    } else if (second >= 1 && second <= 12) {
        month = second;
        day = first;
    } else {
        return null;
    }

    if (day < 1 || day > 31) return null;

    let year: number | undefined;
    if (match[3] !== undefined) {
        year = Number(match[3]);
        if (year < 0 || year > 9999) return null;
        if (year < 100) year += 2000;
    }

    return { month, day, year };
}

/**
 * Parses `"6:30 PM"` / `"18:30"` into a `"HH:MM"` 24h string, tolerating
 * missing spaces and lowercase am/pm. Returns `undefined` when unparseable so
 * a missing or odd time never breaks loading.
 */
function parseStartTime(label: string): string | undefined {
    const text = label.trim();
    if (text === "") return undefined;

    const match = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?\s*$/i.exec(text);
    if (!match) return undefined;

    let hour = Number(match[1]);
    const minute = match[2] !== undefined ? Number(match[2]) : 0;
    const meridiem = match[3]?.toLowerCase();

    if (minute > 59) return undefined;

    if (meridiem === "am" || meridiem === "pm") {
        if (hour < 1 || hour > 12) return undefined;
        const hourMod = hour % 12;
        if (meridiem === "pm") hour = hourMod + 12;
        else hour = hourMod;
    } else if (hour < 0 || hour > 23) {
        return undefined;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function splitRow(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            cells.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

function nonEmptyLines(text: string): string[] {
    return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/**
 * Parses the legacy date-column roster CSV: the header row lists one date
 * label per column (e.g. "Aug 25th"), and each column's non-empty cells below
 * the header are the player names signed up for that date. Columns whose
 * header is not a recognizable date are skipped. Player cells are trimmed,
 * quotes stripped, and per-column duplicates dropped (case-insensitively,
 * keeping the first occurrence). Year-less, so each roster's `date` uses the
 * current year and month/day only.
 */
export function parseRosterCsv(text: string): RosterSet {
    const lines = nonEmptyLines(text);
    if (lines.length === 0) return makeRosterSet([]);

    const headers = splitRow(lines[0]).map((cell) => cell.trim());
    const rosters: Roster[] = [];
    const seenPerColumn = new Map<number, Set<string>>();
    const rosterByHeader = new Map<string, Roster>();

    for (let i = 0; i < headers.length; i++) {
        const parsed = parseDateLabel(headers[i]);
        if (!parsed) continue;
        const roster: Roster = { date: new Date(1970, parsed.month - 1, parsed.day), players: [] };
        rosters.push(roster);
        seenPerColumn.set(i, new Set());
        rosterByHeader.set(headers[i], roster);
    }

    for (let line = 1; line < lines.length; line++) {
        const cells = splitRow(lines[line]);
        for (let i = 0; i < headers.length; i++) {
            if (!seenPerColumn.has(i)) continue;
            const raw = (cells[i] ?? "").trim();
            if (raw === "") continue;

            const key = raw.toLowerCase();
            const seen = seenPerColumn.get(i)!;
            if (seen.has(key)) continue;
            seen.add(key);

            rosterByHeader.get(headers[i])!.players.push(raw);
        }
    }

    return makeRosterSet(rosters);
}

/**
 * Parses the CourtReserve event-export CSV: a `Date`, `Start Time`, and a
 * `#`/`Paid`/`Player Name` table listing one event's signups. The date is
 * matched by header keyword (not position) and the players are read from the
 * `Player Name` column. Only a single roster is ever produced per file for
 * now. The date is parsed via `parseNumericDate`, so it may carry a year.
 */
export function parseEventExportCsv(text: string): RosterSet {
    const lines = nonEmptyLines(text);
    const rows = lines.map(splitRow);

    let nameIndex = -1;
    let dateCol = -1;
    let timeCol = -1;

    // Locate the header columns by keyword (position-independent).
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            const cell = row[i].trim();
            if (cell === "") continue;
            if (/^date$/i.test(cell) && dateCol === -1) dateCol = i;
            if (/^start\s*time$/i.test(cell) && timeCol === -1) timeCol = i;
            if (/^player\s*name$/i.test(cell)) {
                nameIndex = i;
                break;
            }
        }
        if (nameIndex !== -1) break;
    }

    if (nameIndex === -1) return makeRosterSet([]);

    // The Date / Start Time values sit in the same column as their labels, in
    // the metadata rows above the player table header.
    let dateValue: string | undefined;
    let timeValue: string | undefined;
    for (const row of rows) {
        const hasPlayerHeader = row.some((cell) => /^player\s*name$/i.test(cell.trim()));
        if (hasPlayerHeader) break;
        if (dateValue === undefined && dateCol !== -1) {
            const cell = (row[dateCol] ?? "").trim();
            if (cell !== "" && !/^date$/i.test(cell)) dateValue = cell;
        }
        if (timeValue === undefined && timeCol !== -1) {
            const cell = (row[timeCol] ?? "").trim();
            if (cell !== "" && !/^start\s*time$/i.test(cell)) timeValue = cell;
        }
    }

    const parsed = dateValue ? parseNumericDate(dateValue) : null;
    const roster: Roster = {
        date: new Date(parsed?.year ?? 1970, (parsed?.month ?? 1) - 1, parsed?.day ?? 1),
        players: [],
    };
    if (parsed?.year !== undefined) roster.year = parsed.year;

    const players: string[] = [];
    const seen = new Set<string>();
    let pastHeader = false;
    for (const row of rows) {
        const cell = (row[nameIndex] ?? "").trim();
        const isHeaderCell = /^player\s*name$/i.test(cell);
        if (isHeaderCell) {
            pastHeader = true;
            continue;
        }
        if (!pastHeader) continue;
        if (cell === "") continue;
        const key = cell.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        players.push(cell);
    }
    roster.players = players;

    const time = timeValue ? parseStartTime(timeValue) : undefined;
    if (time !== undefined) roster.startTime = time;

    return makeRosterSet([roster]);
}

/**
 * Fixed cell coordinates for the signups export:
 *   - the date sits at (row 2, col 2)
 *   - the `Player Name` header sits at (row 4, col 3), with player names in
 *     col 3 from row 5 onward.
 * All 1-based. Everything else in the file is ignored.
 */
const SIGNUPS_DATE_ROW = 2;
const SIGNUPS_DATE_COL = 2;
const SIGNUPS_TIME_COL = 3;
const SIGNUPS_NAME_ROW = 4;
const SIGNUPS_NAME_COL = 3;

/**
 * Parses the signups export via fixed cell coordinates rather than header
 * keywords. The date is read from (row 2, col 2) and the players from col 3
 * starting at row 5; every other column/row is ignored. Returns an empty set
 * when the identified cells don't look like a date or an export at those
 * coordinates.
 */
export function parseSignupsCsv(text: string): RosterSet {
    const rows = nonEmptyLines(text).map(splitRow);

    const dateValue = (rows[SIGNUPS_DATE_ROW - 1]?.[SIGNUPS_DATE_COL - 1] ?? "").trim();
    const timeValue = (rows[SIGNUPS_DATE_ROW - 1]?.[SIGNUPS_TIME_COL - 1] ?? "").trim();
    const headerCell = (rows[SIGNUPS_NAME_ROW - 1]?.[SIGNUPS_NAME_COL - 1] ?? "").trim();
    if (!/^player\s*name$/i.test(headerCell)) return makeRosterSet([]);

    const parsed = dateValue ? parseNumericDate(dateValue) : null;
    if (!parsed) return makeRosterSet([]);

    const roster: Roster = {
        date: new Date(parsed.year ?? 1970, parsed.month - 1, parsed.day),
        players: [],
    };
    if (parsed.year !== undefined) roster.year = parsed.year;

    const time = timeValue ? parseStartTime(timeValue) : undefined;
    if (time !== undefined) roster.startTime = time;

    const players: string[] = [];
    const seen = new Set<string>();
    for (let r = SIGNUPS_NAME_ROW; r < rows.length; r++) {
        const name = (rows[r]?.[SIGNUPS_NAME_COL - 1] ?? "").trim();
        if (name === "") continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        players.push(name);
    }
    roster.players = players;

    return makeRosterSet([roster]);
}

/**
 * Detects which CSV format `text` is and parses it. The signups export is
 * recognized by a `Player Name` header at (row 4, col 3); the event export by
 * an `Paid` + `Player Name` header (keyword based); anything else is treated
 * as the legacy date-column layout.
 */
export function parseRoster(text: string): RosterSet {
    const rows = nonEmptyLines(text);
    const signupsHeader = (rows[SIGNUPS_NAME_ROW - 1] ?? "")
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[SIGNUPS_NAME_COL - 1]
        ?.trim();
    if (/^player\s*name$/i.test(signupsHeader ?? "")) return parseSignupsCsv(text);

    const hasPaid = /(^|,)paid(,|$)/i.test(rows[0] ?? "") || /(^|,)paid(,|$)/i.test(text);
    const hasPlayerName = /player\s*name/i.test(text);
    if (hasPaid && hasPlayerName) return parseEventExportCsv(text);
    return parseRosterCsv(text);
}

function makeRosterSet(rosters: Roster[]): RosterSet {
    return {
        rosters,
        find(date: Date): Roster | undefined {
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const day = date.getDate();
            // A roster that carries a year must match it exactly; a year-less
            // roster matches by month/day alone.
            const withYear = rosters.find(
                (r) => r.year === year && r.date.getMonth() + 1 === month && r.date.getDate() === day,
            );
            if (withYear) return withYear;
            return rosters.find(
                (r) => r.year === undefined && r.date.getMonth() + 1 === month && r.date.getDate() === day,
            );
        },
    };
}

/** Reads a roster CSV from disk, auto-detecting its format; throws a descriptive error when missing/unreadable. */
export function loadRosterFile(path: string): RosterSet {
    let text: string;
    try {
        text = fs.readFileSync(path, "utf8");
    } catch (err) {
        throw new Error(`could not read roster at ${path}: ${err instanceof Error ? err.message : err}`);
    }
    return parseRoster(text);
}

/** Human-readable "MMM D" key for a date, e.g. "Aug 25". */
export function formatDateKey(date: Date): string {
    const month = MONTH_NAMES[date.getMonth() + 1] ?? String(date.getMonth() + 1);
    return `${month} ${date.getDate()}`;
}
