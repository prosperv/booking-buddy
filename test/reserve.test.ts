import { describe, expect, it } from "vitest";
import {
    durationLabel,
    parseSlotStart,
    parseCourtLabel,
    combineDateTime,
    findCandidateCourts,
    calendarDateTitle,
    assertFutureStart,
    parseDate,
    parseScheduleDateText,
    FreeCell,
} from "../src/reserve";

describe("durationLabel", () => {
    it("maps valid durations to site labels", () => {
        expect(durationLabel(60)).toBe("1 hour");
        expect(durationLabel(90)).toBe("1 hour & 30 minutes");
        expect(durationLabel(120)).toBe("2 hours");
        expect(durationLabel(150)).toBe("2 hours & 30 minutes");
        expect(durationLabel(180)).toBe("3 hours");
    });

    it("throws on invalid durations", () => {
        expect(() => durationLabel(45)).toThrow(/Invalid duration/);
        expect(() => durationLabel(30)).toThrow(/Invalid duration/);
        expect(() => durationLabel(200)).toThrow(/Invalid duration/);
    });
});

describe("parseSlotStart", () => {
    it("parses a reserveBtn start attribute", () => {
        const d = parseSlotStart("Sat Sep 12 2026 09:00:00 GMT-0700 (Pacific Daylight Time)");
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(8); // Sep
        expect(d.getDate()).toBe(12);
        expect(d.getHours()).toBe(9);
        expect(d.getMinutes()).toBe(0);
    });

    it("parses a different time", () => {
        const d = parseSlotStart("Sat Sep 12 2026 18:30:00 GMT-0700 (Pacific Daylight Time)");
        expect(d.getHours()).toBe(18);
        expect(d.getMinutes()).toBe(30);
    });

    it("throws on unparseable input", () => {
        expect(() => parseSlotStart("not a date")).toThrow(/Could not parse/);
    });
});

describe("assertFutureStart", () => {
    const now = new Date(2026, 8, 12, 12, 0, 0); // Sep 12 2026, noon

    it("accepts a start after now", () => {
        expect(() => assertFutureStart(new Date(2026, 8, 12, 12, 0, 1), now)).not.toThrow();
        expect(() => assertFutureStart(new Date(2026, 8, 13), now)).not.toThrow();
    });

    it("rejects a start equal to now", () => {
        expect(() => assertFutureStart(new Date(2026, 8, 12, 12, 0, 0), now)).toThrow(/future/);
    });

    it("rejects a start in the past", () => {
        expect(() => assertFutureStart(new Date(2026, 8, 12, 11, 59), now)).toThrow(/future/);
        expect(() => assertFutureStart(new Date(2026, 8, 11), now)).toThrow(/future/);
    });

    it("rejects an invalid date", () => {
        expect(() => assertFutureStart(new Date("nonsense"), now)).toThrow(/valid date/);
    });
});

describe("parseScheduleDateText", () => {
    it("parses the full toolbar date text", () => {
        const d = parseScheduleDateText("Saturday, September 12, 2026");
        expect(d).not.toBeNull();
        expect(d!.year()).toBe(2026);
        expect(d!.month()).toBe(8); // September
        expect(d!.date()).toBe(12);
    });

    it("parses the short toolbar date text", () => {
        const d = parseScheduleDateText("Sat, Sep 12");
        expect(d).not.toBeNull();
        expect(d!.month()).toBe(8);
        expect(d!.date()).toBe(12);
    });

    it("returns null for unparseable text", () => {
        expect(parseScheduleDateText("")).toBeNull();
        expect(parseScheduleDateText("garbage")).toBeNull();
    });
});

describe("calendarDateTitle", () => {
    it("matches the title CourtReserve renders on a date cell", () => {
        expect(calendarDateTitle(new Date(2026, 8, 18))).toBe("Friday, September 18, 2026");
        expect(calendarDateTitle(new Date(2026, 8, 1))).toBe("Tuesday, September 1, 2026");
    });

    it("pads the day-of-month like the site does", () => {
        expect(calendarDateTitle(new Date(2026, 0, 5))).toBe("Monday, January 5, 2026");
    });
});

describe("parseCourtLabel", () => {
    it("parses 'Mukilteo 1'", () => {
        expect(parseCourtLabel("Mukilteo 1")).toEqual({
            courtLocation: "Mukilteo",
            courtNumber: 1,
        });
    });

    it("parses 'Mukilteo 12'", () => {
        expect(parseCourtLabel("Mukilteo 12")).toEqual({
            courtLocation: "Mukilteo",
            courtNumber: 12,
        });
    });

    it("parses multi-word locations", () => {
        expect(parseCourtLabel("South Center 3")).toEqual({
            courtLocation: "South Center",
            courtNumber: 3,
        });
    });

    it("throws when no number", () => {
        expect(() => parseCourtLabel("Mukilteo")).toThrow(/Could not parse court number/);
    });
});

describe("parseDate", () => {
    it("parses a yyyy-mm-dd string as local midnight", () => {
        const result = parseDate("2026-09-06");
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(8);
        expect(result.getDate()).toBe(6);
        expect(result.getHours()).toBe(0);
    });

    it("returns a Date object unchanged", () => {
        const date = new Date(2026, 8, 6, 12, 30);
        expect(parseDate(date)).toBe(date);
    });

    it("parses a full timestamp string as-is", () => {
        const result = parseDate("2026-09-06T18:00:00");
        expect(result.getDate()).toBe(6);
    });

    it("throws on an unparseable string", () => {
        expect(() => parseDate("not-a-date")).toThrow(/Invalid date/);
    });

    it("throws on an invalid Date object", () => {
        expect(() => parseDate(new Date("nonsense"))).toThrow(/Invalid date/);
    });
});

describe("combineDateTime", () => {
    it("combines a Date and time string", () => {
        const date = new Date(2026, 8, 12); // Sep 12 2026
        const result = combineDateTime(date, "18:00");
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(8);
        expect(result.getDate()).toBe(12);
        expect(result.getHours()).toBe(18);
        expect(result.getMinutes()).toBe(0);
    });

    it("combines a date string and time string", () => {
        const result = combineDateTime("2026-09-12", "9:30");
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(8);
        expect(result.getDate()).toBe(12);
        expect(result.getHours()).toBe(9);
        expect(result.getMinutes()).toBe(30);
    });

    it("throws on invalid time format", () => {
        expect(() => combineDateTime("2026-09-12", "6pm")).toThrow(/Invalid time format/);
    });
});

describe("findCandidateCourts", () => {
    const makeCell = (courtLabel: string, hour: number, minute = 0): FreeCell => ({
        courtLabel,
        courtLocation: courtLabel.split(" ").slice(0, -1).join(" "),
        courtNumber: Number(courtLabel.split(" ").pop()),
        startTime: new Date(2026, 8, 12, hour, minute),
        endTime: new Date(2026, 8, 12, hour, minute + 30),
    });

    it("returns courts where all cells in the window are free", () => {
        const cells = [
            makeCell("Mukilteo 1", 18),
            makeCell("Mukilteo 1", 18, 30),
            makeCell("Mukilteo 2", 18),
            // Mukilteo 2 missing 18:30
        ];
        const start = new Date(2026, 8, 12, 18, 0);
        const result = findCandidateCourts(cells, [], start, 60);
        expect(result).toEqual(["Mukilteo 1"]);
    });

    it("returns empty when no court has all cells free", () => {
        const cells = [
            makeCell("Mukilteo 1", 18),
            // missing 18:30
            makeCell("Mukilteo 2", 18, 30),
            // missing 18:00
        ];
        const start = new Date(2026, 8, 12, 18, 0);
        const result = findCandidateCourts(cells, [], start, 60);
        expect(result).toEqual([]);
    });

    it("puts preferred courts first", () => {
        const cells = [
            makeCell("Mukilteo 1", 18),
            makeCell("Mukilteo 1", 18, 30),
            makeCell("Mukilteo 2", 18),
            makeCell("Mukilteo 2", 18, 30),
            makeCell("Mukilteo 3", 18),
            makeCell("Mukilteo 3", 18, 30),
        ];
        const start = new Date(2026, 8, 12, 18, 0);
        const result = findCandidateCourts(cells, [3, 1], start, 60);
        expect(result[0]).toBe("Mukilteo 3");
        expect(result[1]).toBe("Mukilteo 1");
        expect(result[2]).toBe("Mukilteo 2");
    });

    it("falls back to non-preferred courts", () => {
        const cells = [
            makeCell("Mukilteo 1", 18),
            makeCell("Mukilteo 1", 18, 30),
            makeCell("Mukilteo 5", 18),
            makeCell("Mukilteo 5", 18, 30),
        ];
        const start = new Date(2026, 8, 12, 18, 0);
        const result = findCandidateCourts(cells, [3], start, 60);
        // No court 3 available, so all candidates are non-preferred
        expect(result).toEqual(["Mukilteo 1", "Mukilteo 5"]);
    });

    it("handles 2-hour duration (4 cells)", () => {
        const cells = [
            makeCell("Mukilteo 1", 18),
            makeCell("Mukilteo 1", 18, 30),
            makeCell("Mukilteo 1", 19),
            makeCell("Mukilteo 1", 19, 30),
            makeCell("Mukilteo 2", 18),
            makeCell("Mukilteo 2", 18, 30),
            // Mukilteo 2 missing 19:00 and 19:30
        ];
        const start = new Date(2026, 8, 12, 18, 0);
        const result = findCandidateCourts(cells, [], start, 120);
        expect(result).toEqual(["Mukilteo 1"]);
    });

    it("returns all courts when no preference given", () => {
        const cells = [
            makeCell("Mukilteo 1", 18),
            makeCell("Mukilteo 2", 18),
        ];
        const start = new Date(2026, 8, 12, 18, 0);
        const result = findCandidateCourts(cells, [], start, 30);
        expect(result).toHaveLength(2);
        expect(result).toContain("Mukilteo 1");
        expect(result).toContain("Mukilteo 2");
    });
});
