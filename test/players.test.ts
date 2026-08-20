import { describe, expect, it } from "vitest";
import {
    matchPlayerOption,
    matchRosterPlayer,
    normalizePlayerName,
    reservationDetailUrl,
    searchNameError,
} from "../src/players";

describe("normalizePlayerName", () => {
    it("collapses internal whitespace", () => {
        expect(normalizePlayerName("Viktor   Axelsen")).toBe("viktor axelsen");
    });

    it("strips trailing question marks the site appends", () => {
        expect(normalizePlayerName("Kento Momota ??")).toBe("kento momota");
        expect(normalizePlayerName("Lee Zii Jia ?")).toBe("lee zii jia");
    });

    it("does not strip interior question marks", () => {
        expect(normalizePlayerName("A?B")).toBe("a?b");
    });

    it("casefolds", () => {
        expect(normalizePlayerName("Lee Zii Jiaa")).toBe("lee zii jiaa");
    });
});

describe("searchNameError", () => {
    it("accepts a query with at least 3 letters", () => {
        expect(searchNameError("Lee Zii")).toBeNull();
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
    const options = ["Lee Zii Chau", "Lee Zii Jia", "Lee Zii Jiaa", "Chen Long"];

    it("returns an exact match even when it is a prefix of another name", () => {
        expect(matchPlayerOption(options, "Lee Zii Jia")).toEqual({
            status: "exact",
            name: "Lee Zii Jia",
            index: 1,
        });
    });

    it("returns an exact match case-insensitively with junk stripped", () => {
        expect(matchPlayerOption(options, "lee zii jiaa ??").status).toBe("exact");
    });

    it("returns a unique substring match", () => {
        expect(matchPlayerOption(options, "Chen")).toEqual({
            status: "unique",
            name: "Chen Long",
            index: 3,
        });
    });

    it("returns ambiguous with candidates when multiple options match", () => {
        expect(matchPlayerOption(options, "Lee Zii")).toEqual({
            status: "ambiguous",
            candidates: ["Lee Zii Chau", "Lee Zii Jia", "Lee Zii Jiaa"],
        });
    });

    it("returns not-found with candidates when nothing matches", () => {
        expect(matchPlayerOption(options, "Zed")).toEqual({
            status: "not-found",
            candidates: ["Lee Zii Chau", "Lee Zii Jia", "Lee Zii Jiaa", "Chen Long"],
        });
    });

    it("returns not-found for an empty option list", () => {
        expect(matchPlayerOption([], "Lee Zii")).toEqual({
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

describe("matchRosterPlayer", () => {
    const roster = ["Viktor Axelsen", "Kento Momota ??", "Chen Long ??", "Lee Zii Jia", "Chou Tien-chen"];

    it("returns an exact normalized match with its index", () => {
        expect(matchRosterPlayer(roster, "Kento Momota")).toEqual({
            status: "exact",
            name: "Kento Momota ??",
            index: 1,
        });
    });

    it("matches case-insensitively and strips trailing question marks", () => {
        expect(matchRosterPlayer(roster, "kento momota ??").status).toBe("exact");
    });

    it("matches the first occurrence by index", () => {
        expect(matchRosterPlayer(roster, "Viktor Axelsen")).toEqual({
            status: "exact",
            name: "Viktor Axelsen",
            index: 0,
        });
    });

    it("does not match a substring of another player", () => {
        expect(matchRosterPlayer(roster, "Lee")).toEqual({
            status: "not-found",
            candidates: roster,
        });
    });

    it("returns not-found with candidates when nothing matches", () => {
        expect(matchRosterPlayer(roster, "Zed")).toEqual({
            status: "not-found",
            candidates: roster,
        });
    });

    it("returns not-found for an empty roster", () => {
        expect(matchRosterPlayer([], "Kento Momota")).toEqual({
            status: "not-found",
            candidates: [],
        });
    });
});
