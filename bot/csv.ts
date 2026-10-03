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
    /**
     * Signup year, when the source carries one; `undefined` for year-less
     * sources. Retained for display/round-tripping only — matching deliberately
     * ignores it (see `RosterSet.find`).
     */
    year?: number;
    /** Signup start time, parsed to `"HH:MM"` (24h), or `undefined` when the source omits it. */
    startTime?: string;
    /** Player names signed up, trimmed, deduped, in source order. */
    players: string[];
    /**
     * The sheet tab this roster came from, when the source was a multi-tab
     * Google Sheet. Purely informational — it identifies the roster in logs and
     * never affects matching.
     */
    tab?: string;
};

/**
 * A collection of rosters plus a stable lookup: `find(date)` returns the
 * roster matching a booking date. This is what `parseRoster` and
 * `loadRosterFile` return, and it is format-agnostic — callers never see
 * columns, headers, or any layout detail.
 */
export type RosterSet = {
    rosters: Roster[];
    /**
     * Returns the roster whose month/day matches `date` (the year is ignored),
     * or `undefined` when none does.
     */
    find(date: Date): Roster | undefined;
    /**
     * Returns the closest session on or after `from`, or `undefined` when every
     * roster has passed. A roster that carries a year is compared at its full
     * date (and start time, when it has one); a year-less roster is treated as
     * its next occurrence on or after `from`, mirroring `find`'s year-ignoring
     * rule. Pass `startTime` to restrict the choice to one session slot, so jobs
     * sharing a sheet with different start times each pick their own session.
     */
    next(from: Date, options?: { startTime?: string }): Roster | undefined;
};

/**
 * Resolves a month name or abbreviation to its number — `"sep"`, `"Sept"` and
 * `"September"` all resolve to `9`. Returns `undefined` for anything that is
 * not a month name, so callers can skip non-month cells/tokens.
 */
export function monthFromToken(token: string): number | undefined {
    return MONTHS[token.trim().toLowerCase().slice(0, 3)];
}

/**
 * Parses a date label like "Aug 25th", "Sep 1", or "September 25th" into its
 * month and day. The year is not part of the label, so it is not represented.
 * Returns `null` for anything that is not a recognizable date (e.g. an empty
 * cell or a stray "name" label).
 */
export function parseDateLabel(label: string): { month: number; day: number } | null {
    const match = /^\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*$/.exec(label);
    if (!match) return null;

    const month = monthFromToken(match[1]);
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
 * keeping the first occurrence). Year-less, so each roster's `date` uses
 * month/day only (year 1970).
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
 * Parses the CourtReserve signups export, which stacks one block per event.
 * Each block begins with a row whose first cell is the "▶" marker, followed by
 * a `Date` / `Start Time` header and value row, an optional blank row, then a
 * `#`/`Paid`/`Player Name` table. Columns are located by header keyword within
 * each block (not fixed position), so blocks with different widths are all
 * read. Every block becomes one dated `Roster`; blocks whose date is missing
 * or unparseable are skipped.
 */
export function parseSignupsExportCsv(text: string): RosterSet {
    const rows = nonEmptyLines(text).map(splitRow);

    const rosters: Roster[] = [];
    let blockStart = -1;
    for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] ?? "").trim() !== "▶") continue;
        if (blockStart !== -1) parseSignupsBlock(rows.slice(blockStart, i), rosters);
        blockStart = i;
    }
    if (blockStart !== -1) parseSignupsBlock(rows.slice(blockStart), rosters);

    return makeRosterSet(rosters);
}

/** Reads one "▶"-headed signups block into a `Roster`, pushing it onto `rosters`. */
function parseSignupsBlock(rows: string[][], rosters: Roster[]): void {
    const header = rows[0];
    const dateCol = header.findIndex((c) => /^date$/i.test(c.trim()));
    const timeCol = header.findIndex((c) => /^start\s*time$/i.test(c.trim()));

    let dateValue: string | undefined;
    let timeValue: string | undefined;
    let nameCol = -1;
    let playerHeaderRow = -1;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (nameCol === -1) {
            const idx = row.findIndex((c) => /^player\s*name$/i.test(c.trim()));
            if (idx !== -1) {
                nameCol = idx;
                playerHeaderRow = i;
            }
        }
        if (dateCol >= 0 && dateValue === undefined) {
            const cell = (row[dateCol] ?? "").trim();
            if (cell !== "" && !/^date$/i.test(cell)) dateValue = cell;
        }
        if (timeCol >= 0 && timeValue === undefined) {
            const cell = (row[timeCol] ?? "").trim();
            if (cell !== "" && !/^start\s*time$/i.test(cell)) timeValue = cell;
        }
    }

    if (nameCol === -1) return;
    const parsed = dateValue ? parseNumericDate(dateValue) : null;
    if (!parsed) return;

    const roster: Roster = {
        date: new Date(parsed.year ?? 1970, parsed.month - 1, parsed.day),
        players: [],
    };
    if (parsed.year !== undefined) roster.year = parsed.year;

    const time = timeValue ? parseStartTime(timeValue) : undefined;
    if (time !== undefined) roster.startTime = time;

    const players: string[] = [];
    const seen = new Set<string>();
    for (let i = playerHeaderRow + 1; i < rows.length; i++) {
        const name = (rows[i][nameCol] ?? "").trim();
        if (name === "") continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        players.push(name);
    }
    roster.players = players;

    rosters.push(roster);
}

/**
 * Detects which CSV format `text` is and parses it. The signups export is
 * recognized by a leading "▶" marker row (one block per event); the event
 * export by a `Paid` + `Player Name` header (keyword based); anything else is
 * treated as the legacy date-column layout.
 */
export function parseRoster(text: string): RosterSet {
    const lines = nonEmptyLines(text);
    if (lines.some((line) => (splitRow(line)[0] ?? "").trim() === "▶")) {
        return parseSignupsExportCsv(text);
    }

    const hasPaid = /(^|,)paid(,|$)/i.test(lines[0] ?? "") || /(^|,)paid(,|$)/i.test(text);
    const hasPlayerName = /player\s*name/i.test(text);
    if (hasPaid && hasPlayerName) return parseEventExportCsv(text);
    return parseRosterCsv(text);
}

/**
 * One roster source: raw CSV text, optionally labelled with the sheet tab it
 * came from (which is then recorded on every roster parsed out of it).
 */
export type RosterSourceText = string | { text: string; tab?: string };

/**
 * Parses several roster sources into one `RosterSet` — the shape a
 * month-per-tab Google Sheet produces, where each tab is a separate CSV text
 * and each carries a month of sessions. Every source is auto-detected
 * independently and the rosters are concatenated in the order given, so
 * calling {@link next} walks straight from one month into the next.
 */
export function parseRosterAll(sources: RosterSourceText[]): RosterSet {
    const rosters: Roster[] = [];
    for (const source of sources) {
        const { text, tab } = typeof source === "string" ? { text: source, tab: undefined } : source;
        for (const roster of parseRoster(text).rosters) {
            rosters.push(tab === undefined ? roster : { ...roster, tab });
        }
    }
    return makeRosterSet(rosters);
}

function makeRosterSet(rosters: Roster[]): RosterSet {
    return {
        rosters,
        find(date: Date): Roster | undefined {
            const month = date.getMonth() + 1;
            const day = date.getDate();
            // Year is intentionally ignored: rosters are (re)exported fresh for
            // the upcoming event, and matching by month/day means a year-carrying
            // export (e.g. "9/7/2026") still matches a booking across a New Year
            // boundary (a "Jan 5" signup is for the *next* Jan 5, not last year's).
            return rosters.find((r) => r.date.getMonth() + 1 === month && r.date.getDate() === day);
        },
        next(from: Date, options?: { startTime?: string }): Roster | undefined {
            const wanted = options?.startTime;
            let best: Roster | undefined;
            let bestAt = Number.POSITIVE_INFINITY;
            for (const roster of rosters) {
                if (wanted !== undefined && roster.startTime !== undefined && roster.startTime !== wanted) {
                    continue;
                }
                const at = occurrenceOf(roster, from);
                if (at === undefined) continue;
                const time = at.getTime();
                if (time < from.getTime()) continue;
                if (time < bestAt) {
                    best = roster;
                    bestAt = time;
                }
            }
            return best;
        },
    };
}

/**
 * Resolves a roster to the concrete instant it next falls on, relative to
 * `from`: its own date (plus start time) when the source carried a year, or
 * its next month/day occurrence when the source is year-less — the same
 * year-ignoring rule `find` uses, so a legacy date-column CSV keeps working
 * (`Roster.date` there is a 1970 placeholder).
 */
function occurrenceOf(roster: Roster, from: Date): Date | undefined {
    const month = roster.date.getMonth();
    const day = roster.date.getDate();
    const [hours, minutes] = roster.startTime ? roster.startTime.split(":").map(Number) : [0, 0];

    if (roster.year !== undefined) {
        return new Date(roster.year, month, day, hours, minutes);
    }

    let next = new Date(from.getFullYear(), month, day, hours, minutes);
    if (next.getTime() < from.getTime()) {
        next = new Date(from.getFullYear() + 1, month, day, hours, minutes);
    }
    return next;
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
