import { describe, expect, it } from "vitest";
import {
    matchPlayerOption,
    normalizePlayerName,
    reservationDetailUrl,
    searchNameError,
} from "../src/players";

describe("normalizePlayerName", () => {
    it("collapses internal whitespace", () => {
        expect(normalizePlayerName("Prosper   Van")).toBe("prosper van");
    });

    it("strips trailing question marks the site appends", () => {
        expect(normalizePlayerName("Peter Nguyen ??")).toBe("peter nguyen");
        expect(normalizePlayerName("Viktor Axelsen ?")).toBe("viktor axelsen");
    });

    it("does not strip interior question marks", () => {
        expect(normalizePlayerName("A?B")).toBe("a?b");
    });

    it("casefolds", () => {
        expect(normalizePlayerName("Brandon Luu")).toBe("brandon luu");
    });
});

describe("searchNameError", () => {
    it("accepts a query with at least 3 letters", () => {
        expect(searchNameError("Brandon")).toBeNull();
        expect(searchNameError("Lin")).toBeNull();
    });

    it("rejects a query with fewer than 3 letters", () => {
        expect(searchNameError("Ab")).toMatch(/3 letters/);
        expect(searchNameError("")).toMatch(/3 letters/);
    });

    it("counts only letters, not digits or symbols", () => {
        expect(searchNameError("A1")).toMatch(/3 letters/);
        expect(searchNameError("A12bc")).toBeNull();
    });
});

describe("matchPlayerOption", () => {
    const options = ["Brandon Chau", "Brandon Lu", "Brandon Luu", "Chen Long"];

    it("returns an exact match even when it is a prefix of another name", () => {
        expect(matchPlayerOption(options, "Brandon Lu")).toEqual({
            status: "exact",
            name: "Brandon Lu",
            index: 1,
        });
    });

    it("returns an exact match case-insensitively with junk stripped", () => {
        expect(matchPlayerOption(options, "brandon luu ??").status).toBe("exact");
    });

    it("returns a unique substring match", () => {
        expect(matchPlayerOption(options, "Chen")).toEqual({
            status: "unique",
            name: "Chen Long",
            index: 3,
        });
    });

    it("returns ambiguous with candidates when multiple options match", () => {
        expect(matchPlayerOption(options, "Brandon")).toEqual({
            status: "ambiguous",
            candidates: ["Brandon Chau", "Brandon Lu", "Brandon Luu"],
        });
    });

    it("returns not-found with candidates when nothing matches", () => {
        expect(matchPlayerOption(options, "Zed")).toEqual({
            status: "not-found",
            candidates: ["Brandon Chau", "Brandon Lu", "Brandon Luu", "Chen Long"],
        });
    });

    it("returns not-found for an empty option list", () => {
        expect(matchPlayerOption([], "Brandon")).toEqual({
            status: "not-found",
            candidates: [],
        });
    });
});

describe("reservationDetailUrl", () => {
    it("builds the detail URL from a booking id", () => {
        expect(reservationDetailUrl("58800347")).toBe(
            "https://app.courtreserve.com/Online/MyProfile/Reservation/7031/58800347",
        );
    });
});
