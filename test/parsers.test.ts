import { describe, expect, it } from "vitest";
import { parseDatetime, parseCourt, parsePlayers, parseBookingId } from "../src/parsers";

describe("parseDatetime", () => {
    it.each([
        ["Mon", "Mon, Aug 10th,  6:00 PM - 8:00 PM"],
        ["Tue", "Tue, Sep 8th,  9:00 PM - 10:00 PM"],
        ["Wed", "Wed, Aug 5th,  6:00 PM - 8:00 PM"],
        ["Thu", "Thu, Aug 6th,  6:00 PM - 8:00 PM"],
        ["Fri", "Fri, Aug 7th,  6:00 PM - 8:00 PM"],
        ["Sat", "Sat, Aug 8th,  6:00 PM - 8:00 PM"],
        ["Sun", "Sun, Aug 9th,  6:00 PM - 8:00 PM"],
    ])("parses %s as dayOfWeek from %s", (expectedWeekday, datetimeText) => {
        const result = parseDatetime(datetimeText);
        expect(result.dayOfWeek).toBe(expectedWeekday);
    });

    it("parses start and end times", () => {
        const result = parseDatetime("Mon, Aug 10th,  6:00 PM - 8:00 PM");

        expect(result.startTime.getHours()).toBe(18);
        expect(result.startTime.getMinutes()).toBe(0);
        expect(result.endTime.getHours()).toBe(20);
        expect(result.endTime.getMinutes()).toBe(0);
    });

    it("sets correct month and day from the date text", () => {
        const result = parseDatetime("Mon, Aug 10th,  6:00 PM - 8:00 PM");

        expect(result.startTime.getMonth()).toBe(7); // August
        expect(result.startTime.getDate()).toBe(10);
    });

    it("handles the double space the site emits after the date", () => {
        expect(parseDatetime("Tue, Sep 8th,  9:00 PM - 10:00 PM").startTime.getHours()).toBe(21);
    });

    it("handles a date with no ordinal suffix", () => {
        const result = parseDatetime("Mon, Aug 10, 6:00 PM - 8:00 PM");

        expect(result.startTime.getDate()).toBe(10);
        expect(result.startTime.getHours()).toBe(18);
    });

    it("defaults to the reference date's year when the site text is still ahead of it", () => {
        const reference = new Date(2026, 7, 10, 12, 0, 0);
        const result = parseDatetime("Mon, Aug 10th,  6:00 PM - 8:00 PM", reference);

        expect(result.startTime.getFullYear()).toBe(2026);
    });

    it("rolls a month/day that has already passed into next year", () => {
        // The site text carries no year, so dayjs fills in the reference's. Read
        // literally, "Jan 4" parsed in December 2026 is 11 months in the past
        // and every date comparison misses it.
        const reference = new Date(2026, 11, 28, 12, 0, 0);
        const result = parseDatetime("Mon, Jan 4th,  6:30 PM - 8:30 PM", reference);

        expect(result.startTime.getFullYear()).toBe(2027);
        expect(result.startTime.getMonth()).toBe(0);
        expect(result.startTime.getDate()).toBe(4);
        expect(result.startTime.getHours()).toBe(18);
    });

    it("does not roll a booking that is later today", () => {
        // Only month/day is compared, so a booking still to come today stays
        // today instead of jumping a whole year.
        const reference = new Date(2026, 9, 15, 9, 0, 0);
        const result = parseDatetime("Wed, Oct 15th,  6:30 PM - 8:30 PM", reference);

        expect(result.startTime.getFullYear()).toBe(2026);
        expect(result.startTime.getDate()).toBe(15);
        expect(result.startTime.getHours()).toBe(18);
    });

    it("rolls the end time with the start time", () => {
        const reference = new Date(2026, 11, 28, 12, 0, 0);
        const result = parseDatetime("Mon, Jan 4th,  6:30 PM - 8:30 PM", reference);

        expect(result.endTime.getFullYear()).toBe(2027);
        expect(result.endTime.getHours()).toBe(20);
    });

    it("produces an endTime before startTime for a cross-midnight booking", () => {
        // Known limitation: no date rollover, so 11PM-12AM ends up going backwards.
        const result = parseDatetime("Tue, Sep 8th,  11:00 PM - 12:00 AM");

        expect(result.endTime.getTime()).toBeLessThan(result.startTime.getTime());
    });

    it("returns an Invalid Date when the time range separator is missing", () => {
        const result = parseDatetime("Tue, Sep 8th,  9:00 PM");

        expect(result.startTime.getHours()).toBe(21);
        expect(Number.isNaN(result.endTime.getTime())).toBe(true);
    });

    it("throws when the text has no comma-separated time section", () => {
        expect(() => parseDatetime("garbage")).toThrow(TypeError);
    });

    it("throws on empty input", () => {
        expect(() => parseDatetime("")).toThrow(TypeError);
    });
});

describe("parseCourt", () => {
    it("parses court number and location", () => {
        const { courtNumber, courtLocation } = parseCourt("Bellevue Court 3");

        expect(courtNumber).toBe(3);
        expect(courtLocation).toBe("Bellevue Court");
    });

    it("handles single-word location", () => {
        const { courtNumber, courtLocation } = parseCourt("Main 5");

        expect(courtNumber).toBe(5);
        expect(courtLocation).toBe("Main");
    });

    it("parses the real site format", () => {
        expect(parseCourt("Mukilteo 10")).toEqual({
            courtNumber: 10,
            courtLocation: "Mukilteo",
            courtNumbers: [10],
        });
    });

    it("keeps the location a real location when one card covers several courts", () => {
        // Courts booked together render as a single card listing every court.
        // Splitting that on spaces made the whole run the "location", so it then
        // failed every location comparison and dropped out of its session.
        const parsed = parseCourt("Mukilteo 8, Mukilteo 9, Mukilteo 10, Mukilteo 11, Mukilteo 12");

        expect(parsed.courtLocation).toBe("Mukilteo");
        expect(parsed.courtNumbers).toEqual([8, 9, 10, 11, 12]);
    });

    it("keys a multi-court card on its lowest court so ordering stays stable", () => {
        expect(parseCourt("Mukilteo 12, Mukilteo 8, Mukilteo 9").courtNumber).toBe(8);
    });

    it("handles a multi-word location across a multi-court card", () => {
        const parsed = parseCourt("Bellevue Court 3, Bellevue Court 4");

        expect(parsed.courtLocation).toBe("Bellevue Court");
        expect(parsed.courtNumbers).toEqual([3, 4]);
    });

    it("returns an empty location when there is only a number", () => {
        expect(parseCourt("10")).toEqual({ courtNumber: 10, courtLocation: "", courtNumbers: [10] });
    });

    it("returns NaN when the trailing token is not numeric", () => {
        // Documents a sharp edge: bad markup yields NaN rather than throwing.
        const { courtNumber, courtLocation } = parseCourt("Court A");

        expect(Number.isNaN(courtNumber)).toBe(true);
        expect(courtLocation).toBe("Court");
    });

    it("returns court 0 for empty input", () => {
        expect(parseCourt("")).toEqual({ courtNumber: 0, courtLocation: "", courtNumbers: [] });
    });
});

describe("parsePlayers", () => {
    it("parses comma-separated players", () => {
        expect(parsePlayers("Viktor Axelsen, Kento Momota")).toEqual([
            "Viktor Axelsen",
            "Kento Momota",
        ]);
    });

    it("returns empty array for empty string", () => {
        expect(parsePlayers("")).toEqual([]);
    });

    it("returns single player for single name", () => {
        expect(parsePlayers("Viktor Axelsen")).toEqual(["Viktor Axelsen"]);
    });

    it("keeps empty entries from doubled or trailing commas", () => {
        // Documents current behavior: entries are not filtered out.
        expect(parsePlayers("A,,B")).toEqual(["A", "", "B"]);
        expect(parsePlayers("A,")).toEqual(["A", ""]);
    });

    it("returns a single empty entry for whitespace-only input", () => {
        expect(parsePlayers("   ")).toEqual([""]);
    });

    it("preserves trailing characters the site appends to names", () => {
        expect(parsePlayers("Viktor Axelsen, Kento Momota ??")).toEqual([
            "Viktor Axelsen",
            "Kento Momota ??",
        ]);
    });
});

describe("parseBookingId", () => {
    it("parses the numeric suffix off the wrapper testid", () => {
        expect(parseBookingId("booking-card-wrapper-58800347")).toBe("58800347");
    });

    it("tolerates surrounding whitespace", () => {
        expect(parseBookingId("  booking-card-wrapper-59019419  ")).toBe("59019419");
    });

    it("throws when the prefix does not match", () => {
        expect(() => parseBookingId("booking-card")).toThrow(/booking id/i);
    });

    it("throws when the suffix is not numeric", () => {
        expect(() => parseBookingId("booking-card-wrapper-abc")).toThrow(/booking id/i);
    });

    it("throws on empty input", () => {
        expect(() => parseBookingId("")).toThrow(/booking id/i);
    });
});
