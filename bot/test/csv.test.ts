import { describe, expect, it } from "vitest";
import { parseRosterCsv, parseDateLabel, findRoster } from "../csv";

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

describe("parseRosterCsv", () => {
    it("parses players listed under each date column", () => {
        const columns = parseRosterCsv(
            "Aug 25th,Sep 1st,Sep 8th\n" +
                "Kento Momota,Kento Momota,Viktor Axelsen\n" +
                "Viktor Axelsen,Chen Long,Chen Long\n" +
                "Chen Long,,\n",
        );
        expect(columns).toEqual([
            { label: "Aug 25th", month: 8, day: 25, players: ["Kento Momota", "Viktor Axelsen", "Chen Long"] },
            { label: "Sep 1st", month: 9, day: 1, players: ["Kento Momota", "Chen Long"] },
            { label: "Sep 8th", month: 9, day: 8, players: ["Viktor Axelsen", "Chen Long"] },
        ]);
    });

    it("skips header columns that are not dates", () => {
        const columns = parseRosterCsv("name,Aug 25th\nfoo,Kento Momota\nbar,Viktor Axelsen\n");
        expect(columns).toEqual([{ label: "Aug 25th", month: 8, day: 25, players: ["Kento Momota", "Viktor Axelsen"] }]);
    });

    it("trims whitespace, strips quotes, and drops per-column duplicates", () => {
        const columns = parseRosterCsv('Aug 25th\n"Kento Momota"\n kento momota \n Chen Long \n');
        expect(columns[0].players).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("handles quoted names containing commas", () => {
        const columns = parseRosterCsv('Aug 25th\n"Last, First"\n"Chen Long"\n');
        expect(columns[0].players).toEqual(["Last, First", "Chen Long"]);
    });

    it("returns an empty array for empty or blank input", () => {
        expect(parseRosterCsv("")).toEqual([]);
        expect(parseRosterCsv("\n\n")).toEqual([]);
    });

    it("returns an empty array when no header is a date", () => {
        expect(parseRosterCsv("name,other\nKento Momota,foo\n")).toEqual([]);
    });
});

describe("findRoster", () => {
    const columns = parseRosterCsv("Aug 25th,Sep 1st\nKento Momota,Chen Long\nViktor Axelsen,,\n");

    it("matches a date by month and day, ignoring year", () => {
        expect(findRoster(columns, new Date(2026, 7, 25, 18, 0))).toEqual(["Kento Momota", "Viktor Axelsen"]);
    });

    it("returns undefined when no column matches", () => {
        expect(findRoster(columns, new Date(2026, 7, 26, 18, 0))).toBeUndefined();
    });
});
