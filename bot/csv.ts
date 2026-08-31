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

export type RosterColumn = {
    /** The raw header cell, e.g. "Aug 25th". */
    label: string;
    /** Month, 1-12. */
    month: number;
    /** Day of month, 1-31. */
    day: number;
    /** Player names listed under this date's column. */
    players: string[];
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

/**
 * Parses a date-column roster CSV. The header row lists one date label per
 * column (e.g. "Aug 25th"); each column's non-empty cells below the header are
 * the player names signed up for that date. Columns whose header is not a
 * recognizable date are skipped. Within a column, surrounding whitespace and
 * quotes are trimmed and duplicates are dropped (case-insensitively, keeping
 * the first occurrence).
 */
export function parseRosterCsv(text: string): RosterColumn[] {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length === 0) return [];

    const headers = splitRow(lines[0]).map((cell) => cell.trim());
    const columns: RosterColumn[] = [];
    const seenPerColumn = new Map<number, Set<string>>();

    for (let i = 0; i < headers.length; i++) {
        const parsed = parseDateLabel(headers[i]);
        if (!parsed) continue;
        columns.push({ label: headers[i], ...parsed, players: [] });
        seenPerColumn.set(i, new Set());
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

            const column = columns.find((c) => c.label === headers[i])!;
            column.players.push(raw);
        }
    }

    return columns;
}

/** Reads a roster CSV from disk, throwing a descriptive error when missing/unreadable. */
export function loadRosterFile(path: string): RosterColumn[] {
    let text: string;
    try {
        text = fs.readFileSync(path, "utf8");
    } catch (err) {
        throw new Error(`could not read roster at ${path}: ${err instanceof Error ? err.message : err}`);
    }
    return parseRosterCsv(text);
}

/**
 * Returns the players for the roster column whose month/day matches `date`
 * (year ignored), or `undefined` when no column matches.
 */
export function findRoster(columns: RosterColumn[], date: Date): string[] | undefined {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return columns.find((c) => c.month === month && c.day === day)?.players;
}

/** Human-readable "MMM D" key for a date, e.g. "Aug 25". */
export function formatDateKey(date: Date): string {
    const month = MONTH_NAMES[date.getMonth() + 1] ?? String(date.getMonth() + 1);
    return `${month} ${date.getDate()}`;
}
