import { describe, expect, it } from "vitest";
import { matrixToCsv, parseMonthTitle, pairTabValues, pickMonthTabs, sheetNameOfRange } from "../sheets";

describe("matrixToCsv", () => {
    it("joins rows and cells with commas and newlines", () => {
        expect(
            matrixToCsv([
                ["Aug 25th", "Sep 1st"],
                ["Kento Momota", "Chen Long"],
            ]),
        ).toBe("Aug 25th,Sep 1st\nKento Momota,Chen Long");
    });

    it("quotes cells containing commas, quotes, or newlines", () => {
        expect(matrixToCsv([["Last, First", 'say "hi"']])).toBe('"Last, First","say ""hi"""');
    });

    it("treats null/undefined cells as empty", () => {
        expect(matrixToCsv([[null, undefined, "a"]])).toBe(",,a");
    });

    it("returns an empty string for no rows", () => {
        expect(matrixToCsv([])).toBe("");
    });
});

describe("parseMonthTitle", () => {
    it("reads a hyphenated month tab", () => {
        expect(parseMonthTitle("Sept-2026")).toEqual({ month: 9, year: 2026 });
        expect(parseMonthTitle("Oct-2026")).toEqual({ month: 10, year: 2026 });
    });

    it("tolerates spaces, longer month names, and surrounding text", () => {
        expect(parseMonthTitle("Sept 2026")).toEqual({ month: 9, year: 2026 });
        expect(parseMonthTitle("September 2026")).toEqual({ month: 9, year: 2026 });
        expect(parseMonthTitle("Rosters — Oct 2026")).toEqual({ month: 10, year: 2026 });
        expect(parseMonthTitle("2026 Nov")).toEqual({ month: 11, year: 2026 });
        expect(parseMonthTitle("may 2027")).toEqual({ month: 5, year: 2027 });
    });

    it("rejects tabs that are not named after a month", () => {
        expect(parseMonthTitle("Readme")).toBeNull();
        expect(parseMonthTitle("Sheet1")).toBeNull();
        expect(parseMonthTitle("2026")).toBeNull();
        expect(parseMonthTitle("Sept")).toBeNull();
        expect(parseMonthTitle("Q1 2026")).toBeNull();
        expect(parseMonthTitle("")).toBeNull();
    });
});

describe("pickMonthTabs", () => {
    const titles = ["Readme", "Sept-2026", "Oct-2026", "Nov-2026", "Aug 2026"];

    it("picks this month and the next, in order", () => {
        expect(pickMonthTabs(titles, new Date(2026, 8, 28))).toEqual(["Sept-2026", "Oct-2026"]);
        expect(pickMonthTabs(titles, new Date(2026, 9, 15))).toEqual(["Oct-2026", "Nov-2026"]);
        expect(pickMonthTabs(titles, new Date(2026, 10, 1))).toEqual(["Nov-2026"]);
    });

    it("rolls the window over the new year", () => {
        const year = ["Nov 2026", "Dec 2026", "Jan 2027"];
        expect(pickMonthTabs(year, new Date(2026, 11, 20))).toEqual(["Dec 2026", "Jan 2027"]);
        expect(pickMonthTabs(year, new Date(2026, 10, 20))).toEqual(["Nov 2026", "Dec 2026"]);
        // January reaches back for December of the year before.
        expect(pickMonthTabs(year, new Date(2027, 0, 5))).toEqual(["Jan 2027"]);
    });

    it("reads whichever tabs exist, skipping missing months", () => {
        expect(pickMonthTabs(["Sept-2026", "Nov-2026"], new Date(2026, 8, 28))).toEqual(["Sept-2026"]);
        expect(pickMonthTabs(["Oct-2026"], new Date(2026, 8, 28))).toEqual(["Oct-2026"]);
    });

    it("ignores tabs that are not named after a month", () => {
        expect(pickMonthTabs(["Instructions", "Readme", "Sept 2026"], new Date(2026, 8, 28))).toEqual(["Sept 2026"]);
        expect(pickMonthTabs(["Readme", "Instructions"], new Date(2026, 8, 28))).toEqual([]);
    });

    it("widens the window on request", () => {
        expect(pickMonthTabs(titles, new Date(2026, 8, 28), 2)).toEqual([
            "Sept-2026",
            "Oct-2026",
            "Nov-2026",
        ]);
    });

    it("takes the first tab when a month is duplicated", () => {
        expect(pickMonthTabs(["Sept 2026", "Sept 2026", "Oct 2026"], new Date(2026, 8, 28))).toEqual([
            "Sept 2026",
            "Oct 2026",
        ]);
    });
});

describe("sheetNameOfRange", () => {
    it("unwraps a quoted name and drops the A1 bounds", () => {
        expect(sheetNameOfRange("'Oct 2026'!A1:Z1000")).toBe("Oct 2026");
    });

    it("accepts a name the API returned unquoted", () => {
        expect(sheetNameOfRange("Sept-2026!A1:Z1000")).toBe("Sept-2026");
    });

    it("handles a name containing a quote or an exclamation mark", () => {
        expect(sheetNameOfRange("'It''s Oct!'!A1:B2")).toBe("It's Oct!");
    });

    it("returns the whole string when there are no cell bounds", () => {
        expect(sheetNameOfRange("Oct 2026")).toBe("Oct 2026");
    });

    it("returns empty for a missing range", () => {
        expect(sheetNameOfRange(undefined)).toBe("");
        expect(sheetNameOfRange(null)).toBe("");
    });
});

describe("pairTabValues", () => {
    // The real shapes, as the API returns them: it answers with the canonical
    // A1 range covering the data, never the bare tab name that was requested.
    it("pairs tabs with the values the API answered for them", () => {
        expect(
            pairTabValues(
                ["Sept 2026", "Oct 2026"],
                [
                    { range: "'Sept 2026'!A1:Z1000", values: [["▶", "Date"], ["", "9/28/2026"]] },
                    { range: "'Oct 2026'!A1:Z1000", values: [["▶", "Date"], ["", "10/5/2026"]] },
                ],
            ),
        ).toEqual([
            { tab: "Sept 2026", csv: "▶,Date\n,9/28/2026" },
            { tab: "Oct 2026", csv: "▶,Date\n,10/5/2026" },
        ]);
    });

    it("pairs an unquoted answer with a hyphenated tab", () => {
        expect(pairTabValues(["Sept-2026"], [{ range: "Sept-2026!A1:Z1000", values: [["a"]] }])).toEqual([
            { tab: "Sept-2026", csv: "a" },
        ]);
    });

    it("keeps a genuinely empty tab as empty CSV rather than throwing", () => {
        expect(pairTabValues(["Oct 2026"], [{ range: "'Oct 2026'!A1" }])).toEqual([{ tab: "Oct 2026", csv: "" }]);
    });

    it("throws when the API answers fewer ranges than were asked for", () => {
        expect(() => pairTabValues(["Sept 2026", "Oct 2026"], [{ range: "'Sept 2026'!A1", values: [] }])).toThrow(
            /answered 1 range\(s\) for 2 requested tab\(s\)/,
        );
    });

    it("throws when an answer names a different tab", () => {
        expect(() =>
            pairTabValues(
                ["Sept 2026", "Oct 2026"],
                [
                    { range: "'Oct 2026'!A1", values: [] },
                    { range: "'Sept 2026'!A1", values: [] },
                ],
            ),
        ).toThrow(/expected an answer for roster tab "Sept 2026" but the API returned range "'Oct 2026'!A1"/);
    });
});
