import { describe, expect, it } from "vitest";
import { parseRoster, parseRosterCsv, parseEventExportCsv, parseDateLabel } from "../csv";

describe("parseDateLabel", () => {
    it("parses a 3-letter month with ordinal suffix", () => {
        expect(parseDateLabel("Aug 25th")).toEqual({ month: 8, day:25 });
        expect(parseDateLabel("Sep 1st")).toEqual({ month: 9, day:1 });
        expect(parseDateLabel("Oct 2nd")).toEqual({ month: 10, day:2 });
        expect(parseDateLabel("Nov 3rd")).toEqual({ month: 11, day:3 });
    });

    it("parses without a suffix and with full month names", () => {
        expect(parseDateLabel("Aug 25")).toEqual({ month: 8, day:25 });
        expect(parseDateLabel("September 25th")).toEqual({ month: 9, day:25 });
    });

    it("is case-insensitive", () => {
        expect(parseDateLabel("aug 25th")).toEqual({ month: 8, day:25 });
    });

    it("returns null for non-date labels", () => {
        expect(parseDateLabel("name")).toBeNull();
        expect(parseDateLabel("")).toBeNull();
        expect(parseDateLabel("25 Aug")).toBeNull();
        expect(parseDateLabel("Aug")).toBeNull();
    });
});

describe("parseRosterCsv (legacy date-column)", () => {
    it("parses players listed under each date column", () => {
        const set = parseRosterCsv(
            "Aug 25th,Sep 1st,Sep 8th\n" +
                "Kento Momota,Kento Momota,Viktor Axelsen\n" +
                "Viktor Axelsen,Chen Long,Chen Long\n" +
                "Chen Long,,\n",
        );
        expect(set.rosters.map((r) => r.players)).toEqual([
            ["Kento Momota", "Viktor Axelsen", "Chen Long"],
            ["Kento Momota", "Chen Long"],
            ["Viktor Axelsen", "Chen Long"],
        ]);
    });

    it("skips header columns that are not dates", () => {
        const set = parseRosterCsv("name,Aug 25th\nfoo,Kento Momota\nbar,Viktor Axelsen\n");
        expect(set.rosters).toHaveLength(1);
        expect(set.rosters[0].players).toEqual(["Kento Momota", "Viktor Axelsen"]);
    });

    it("trims whitespace, strips quotes, and drops per-column duplicates", () => {
        const set = parseRosterCsv('Aug 25th\n"Kento Momota"\n kento momota \n Chen Long \n');
        expect(set.rosters[0].players).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("handles quoted names containing commas", () => {
        const set = parseRosterCsv('Aug 25th\n"Last, First"\n"Chen Long"\n');
        expect(set.rosters[0].players).toEqual(["Last, First", "Chen Long"]);
    });

    it("returns an empty array for empty or blank input", () => {
        expect(parseRosterCsv("").rosters).toEqual([]);
        expect(parseRosterCsv("\n\n").rosters).toEqual([]);
    });

    it("returns an empty array when no header is a date", () => {
        expect(parseRosterCsv("name,other\nKento Momota,foo\n").rosters).toEqual([]);
    });
});

describe("parseEventExportCsv (new format)", () => {
    const sample =
        "▶,Date,Start Time,\n" +
        ",9/7/2026,6:30 PM,\n" +
        ",,,\n" +
        "#,Paid,Player Name,\n" +
        "1,FALSE,Brandon Luu,\n" +
        "2,FALSE,Alex Chu,\n" +
        "3,FALSE,Davin Lee,\n" +
        "4,FALSE,Celeste Zhao,\n";

    it("parses the date, start time, and player names", () => {
        const set = parseEventExportCsv(sample);
        expect(set.rosters).toHaveLength(1);
        const roster = set.rosters[0];
        expect(roster.date.getFullYear()).toBe(2026);
        expect(roster.date.getMonth() + 1).toBe(9);
        expect(roster.date.getDate()).toBe(7);
        expect(roster.startTime).toBe("18:30");
        expect(roster.players).toEqual(["Brandon Luu", "Alex Chu", "Davin Lee", "Celeste Zhao"]);
    });

    it("finds the roster by month/day and year", () => {
        const set = parseEventExportCsv(sample);
        expect(set.find(new Date(2026, 8, 7))?.players).toHaveLength(4);
        expect(set.find(new Date(2026, 8, 8))).toBeUndefined();
        expect(set.find(new Date(2027, 8, 7))).toBeUndefined();
    });

    it("accepts zero-padded M/D/YYYY dates", () => {
        const set = parseEventExportCsv(sample.replace("9/7/2026", "09/07/2026"));
        expect(set.rosters[0].date.getMonth() + 1).toBe(9);
        expect(set.rosters[0].date.getDate()).toBe(7);
    });

    it("drops blank and duplicate player rows", () => {
        const set = parseEventExportCsv(
            "Date,Start Time,Player Name\n9/7/2026,6:30 PM,,\n,,A,\n,,A,\n,,,\n,,B,\n",
        );
        expect(set.rosters[0].players).toEqual(["A", "B"]);
    });

    it("returns no rosters when there is no Player Name column", () => {
        expect(parseEventExportCsv("foo,bar\n1,2\n").rosters).toEqual([]);
    });
});

describe("parseRoster (auto-detection)", () => {
    it("detects the event-export format by Paid/Player Name headers", () => {
        const set = parseRoster(
            "▶,Date,Start Time,\n,9/7/2026,6:30 PM,\n,,,\n#,Paid,Player Name,\n1,FALSE,Brandon Luu,\n",
        );
        expect(set.rosters).toHaveLength(1);
        expect(set.rosters[0].players).toEqual(["Brandon Luu"]);
    });

    it("falls back to the date-column format otherwise", () => {
        const set = parseRoster("Aug 25th,Sep 1st\nKento Momota,Chen Long\n");
        expect(set.rosters).toHaveLength(2);
        expect(set.rosters[0].players).toEqual(["Kento Momota"]);
    });

    it("find() matches month/day only for year-less rosters", () => {
        const set = parseRoster("Aug 25th,Sep 1st\nKento Momota,Chen Long\nViktor Axelsen,,\n");
        expect(set.find(new Date(2026, 7, 25))?.players).toEqual(["Kento Momota", "Viktor Axelsen"]);
        expect(set.find(new Date(2026, 7, 26))).toBeUndefined();
    });
});
