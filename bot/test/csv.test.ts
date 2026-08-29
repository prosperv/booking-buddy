import { describe, expect, it } from "vitest";
import { parseRosterCsv } from "../csv";

describe("parseRosterCsv", () => {
    it("parses one name per line", () => {
        expect(parseRosterCsv("Kento Momota\nViktor Axelsen\nChen Long\n")).toEqual([
            "Kento Momota",
            "Viktor Axelsen",
            "Chen Long",
        ]);
    });

    it("skips a leading name header row", () => {
        expect(parseRosterCsv("name\nKento Momota\nChen Long\n")).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("trims whitespace and drops blank lines", () => {
        expect(parseRosterCsv("  Kento Momota  \n\n\tChen Long\t\n")).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("drops duplicates case-insensitively, keeping the first", () => {
        expect(parseRosterCsv("Kento Momota\nkento momota\nChen Long\n")).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("takes only the first column", () => {
        expect(parseRosterCsv("Kento Momota,123\nChen Long,456\n")).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("strips surrounding quotes", () => {
        expect(parseRosterCsv('"Kento Momota"\n"Chen Long"\n')).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("returns an empty array for empty or blank input", () => {
        expect(parseRosterCsv("")).toEqual([]);
        expect(parseRosterCsv("\n\n")).toEqual([]);
    });
});
