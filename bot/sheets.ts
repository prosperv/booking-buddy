import { google } from "googleapis";
import type { ServiceAccountKey } from "./config";
import { monthFromToken } from "./csv";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

/** One tab's roster, kept alongside its title so logs can say where it came from. */
export type SheetTab = {
    /** The tab's title, or the raw A1 range when the source pinned one. */
    tab: string;
    /** The tab's cells serialized as CSV, ready for `parseRoster`. */
    csv: string;
};

/** How many months past the current one {@link pickMonthTabs} looks by default. */
export const DEFAULT_MONTHS_AHEAD = 1;

function csvCell(cell: unknown): string {
    const text = cell == null ? "" : String(cell);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/** Serializes a Sheets `values` grid back into CSV text so it can flow through `parseRoster`. */
export function matrixToCsv(rows: unknown[][]): string {
    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Quotes a tab title for use as an A1 range, escaping any embedded apostrophes. */
function asRange(title: string): string {
    return `'${title.replace(/'/g, "''")}'`;
}

/**
 * Parses a month tab's title into its month and year. Tolerant by design, since
 * the naming is a human convention: `Sept-2026`, `Sept 2026`, `September 2026`
 * and `Rosters — Oct 2026` all resolve, case-insensitively, while non-month
 * tabs (`Readme`, `Sheet1`, `2026`) return `null`.
 */
export function parseMonthTitle(title: string): { month: number; year: number } | null {
    const year = /(\d{4})/.exec(title);
    if (!year) return null;
    for (const token of title.split(/[^A-Za-z]+/)) {
        const month = monthFromToken(token);
        if (month !== undefined) return { month, year: Number(year[1]) };
    }
    return null;
}

/**
 * Picks the tabs holding the month of `from` and the following
 * `monthsAhead` months — the window a booking can plausibly fall in, which is
 * what a month-per-tab roster sheet needs. Tabs whose title does not name a
 * month are ignored, and the result is chronological (so a roster can walk
 * from one tab into the next). When a month has no tab it is simply absent
 * from the result, and the first tab wins if a month is duplicated.
 */
export function pickMonthTabs(titles: string[], from: Date, monthsAhead = DEFAULT_MONTHS_AHEAD): string[] {
    const wanted: number[] = [];
    for (let i = 0; i <= monthsAhead; i++) {
        const month = new Date(from.getFullYear(), from.getMonth() + i, 1);
        wanted.push(month.getFullYear() * 12 + month.getMonth());
    }

    const picked: string[] = [];
    for (const key of wanted) {
        for (const title of titles) {
            const parsed = parseMonthTitle(title);
            if (parsed && parsed.year * 12 + (parsed.month - 1) === key) {
                picked.push(title);
                break;
            }
        }
    }
    return picked;
}

async function listSheetTitles(
    sheets: ReturnType<typeof google.sheets>,
    spreadsheetId: string,
    serviceAccount: ServiceAccountKey,
): Promise<string[]> {
    let res;
    try {
        res = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: "sheets(properties(title))",
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
            `could not read spreadsheet ${spreadsheetId}: ${message} ` +
                `(is it shared with the service account ${serviceAccount.client_email}?)`,
        );
    }
    const titles = (res.data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => !!t);
    if (titles.length === 0) throw new Error(`no sheets found in spreadsheet ${spreadsheetId}`);
    return titles;
}

function readError(target: string, spreadsheetId: string, serviceAccount: ServiceAccountKey, cause: unknown): Error {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new Error(
        `could not read range "${target}" of spreadsheet ${spreadsheetId}: ${message} ` +
            `(is it shared with the service account ${serviceAccount.client_email}?)`,
    );
}

/**
 * Extracts the sheet name from an A1 range as the API echoes it back — e.g.
 * `'Oct 2026'!A1:Z1000`. Quotes are stripped and `''` unescaped, because a name
 * quoted on the way out is not necessarily quoted on the way back (a
 * hyphenated `Sept-2026` comes back bare), and a name may itself contain `!`
 * or `'`. Returns `""` when there is no name to read.
 */
export function sheetNameOfRange(range: string | null | undefined): string {
    if (!range) return "";
    if (range.startsWith("'")) {
        let name = "";
        for (let i = 1; i < range.length; i++) {
            if (range[i] !== "'") {
                name += range[i];
            } else if (range[i + 1] === "'") {
                name += "'";
                i++;
            } else {
                return name;
            }
        }
        return name;
    }
    const bang = range.indexOf("!");
    return (bang === -1 ? range : range.slice(0, bang)).trim();
}

/** The part of a Sheets `ValueRange` this module needs, so pairing is testable without the API client. */
export type SheetValueRange = { range?: string | null; values?: unknown[][] | null };

/**
 * Pairs each requested tab with the values the API answered for it.
 *
 * `values.batchGet` answers in request order — "the order of the ValueRanges is
 * the same as the order of the requested ranges" — but the `range` it echoes is
 * the canonical A1 form covering the data (`'Oct 2026'!A1:Z1000`), not the bare
 * tab name that was asked for, so the two can only be matched after unwrapping
 * the name. Pairing is therefore positional with the name cross-checked: a
 * mismatch, or fewer answers than requests, throws rather than returning an
 * empty CSV, because an empty tab would otherwise be indistinguishable from a
 * failed read and the caller would plan against an empty roster.
 */
export function pairTabValues(tabs: string[], valueRanges: SheetValueRange[]): SheetTab[] {
    if (valueRanges.length < tabs.length) {
        throw new Error(
            `the Sheets API answered ${valueRanges.length} range(s) for ${tabs.length} requested tab(s) ` +
                `(${tabs.map((t) => `"${t}"`).join(", ")})`,
        );
    }
    return tabs.map((tab, i) => {
        const found = valueRanges[i];
        const answered = sheetNameOfRange(found.range);
        if (answered && answered !== tab) {
            throw new Error(`expected an answer for roster tab "${tab}" but the API returned range "${found.range}"`);
        }
        return { tab, csv: matrixToCsv(found.values ?? []) };
    });
}

function authedSheets(serviceAccount: ServiceAccountKey): ReturnType<typeof google.sheets> {
    const auth = new google.auth.JWT({
        email: serviceAccount.client_email,
        key: serviceAccount.private_key,
        scopes: SCOPES,
    });
    return google.sheets({ version: "v4", auth });
}

/**
 * Reads a Google Sheet as CSV using a service account, returning one entry per
 * tab so the caller can tell them apart.
 *
 * The spreadsheet is organized one tab per month (`Sept-2026`, `Oct-2026`, ...),
 * each holding a month of sessions, so by default this reads the tabs for the
 * month of `options.from` (default: today) and the months after it — the window
 * a booking can fall in. `pickMonthTabs` decides which, and non-month tabs are
 * ignored. Passing `range` bypasses all of that and reads exactly that A1
 * range instead.
 *
 * Throws on auth/network/API errors so callers can fail the run loudly rather
 * than plan against an empty roster.
 */
export async function loadGoogleSheets(
    spreadsheetId: string,
    range: string | undefined,
    serviceAccount: ServiceAccountKey,
    options: { from?: Date; monthsAhead?: number } = {},
): Promise<SheetTab[]> {
    const sheets = authedSheets(serviceAccount);

    if (range !== undefined) {
        let res;
        try {
            res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        } catch (err) {
            throw readError(range, spreadsheetId, serviceAccount, err);
        }
        return [{ tab: range, csv: matrixToCsv(res.data.values ?? []) }];
    }

    const titles = await listSheetTitles(sheets, spreadsheetId, serviceAccount);
    const tabs = pickMonthTabs(titles, options.from ?? new Date(), options.monthsAhead ?? DEFAULT_MONTHS_AHEAD);
    if (tabs.length === 0) {
        throw new Error(
            `no roster tab found in spreadsheet ${spreadsheetId} for this month or the next ` +
                `(titled tabs: ${titles.map((t) => `"${t}"`).join(", ")} — expected one like "Oct 2026")`,
        );
    }

    let res;
    try {
        res = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: tabs.map(asRange),
        });
    } catch (err) {
        throw readError(tabs.join(", "), spreadsheetId, serviceAccount, err);
    }

    return pairTabValues(tabs, res.data.valueRanges ?? []);
}
