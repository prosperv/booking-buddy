import { describe, expect, it } from "vitest";
import { parseDatetime, parseCourt, parsePlayers } from "../src/parsers";

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
});

describe("parsePlayers", () => {
    it("parses comma-separated players", () => {
        expect(parsePlayers("Prosper Van, Peter Nguyen")).toEqual([
            "Prosper Van",
            "Peter Nguyen",
        ]);
    });

    it("returns empty array for empty string", () => {
        expect(parsePlayers("")).toEqual([]);
    });

    it("returns single player for single name", () => {
        expect(parsePlayers("Prosper Van")).toEqual(["Prosper Van"]);
    });
});
