import { describe, expect, it } from "vitest";
import { mappedName, playerIdentity, type NameMap } from "../name-map";

/** Keys normalized and values as written, as `validateConfig` stores them. */
const MAP: NameMap = {
    "riley poe": "Lee Zii Jia",
    "riley poo": "Lee Zii Jiaa",
};

describe("mappedName", () => {
    it("returns the member name for a mapped roster name, as written", () => {
        expect(mappedName(MAP, "Riley Poe")).toBe("Lee Zii Jia");
    });

    it("leaves an unmapped name untouched", () => {
        expect(mappedName(MAP, "Kento Momota")).toBe("Kento Momota");
    });

    it("is the identity function when no map is configured", () => {
        expect(mappedName(undefined, "Riley Poe")).toBe("Riley Poe");
    });

    it("looks a name up regardless of case and surrounding whitespace", () => {
        expect(mappedName(MAP, "  RILEY   poe ")).toBe("Lee Zii Jia");
    });
});

describe("playerIdentity", () => {
    it("resolves both sides of a mapping to one identity", () => {
        expect(playerIdentity(MAP, "Riley Poe")).toBe("lee zii jia");
        expect(playerIdentity(MAP, "Lee Zii Jia")).toBe("lee zii jia");
    });

    it("keeps unrelated names apart", () => {
        expect(playerIdentity(MAP, "Riley Poo")).not.toBe(playerIdentity(MAP, "Riley Poe"));
    });

    it("is just the normalized name when no map is configured", () => {
        expect(playerIdentity(undefined, "Riley Poe")).toBe("riley poe");
    });

    it("follows a chain to its end, so every link shares one identity", () => {
        const chain: NameMap = { a: "B", b: "C" };
        expect(playerIdentity(chain, "A")).toBe("c");
        expect(playerIdentity(chain, "B")).toBe("c");
        expect(playerIdentity(chain, "C")).toBe("c");
    });

    it("resolves a cycle to the same identity from either side", () => {
        const cycle: NameMap = { a: "B", b: "A" };
        expect(playerIdentity(cycle, "A")).toBe("a");
        expect(playerIdentity(cycle, "B")).toBe("a");
    });

    it("normalizes before matching, as the map's keys are normalized", () => {
        expect(playerIdentity(MAP, "riley POE")).toBe(playerIdentity(MAP, "LEE ZII JIA"));
    });

    it("ignores the trailing '?' the site appends to some names", () => {
        expect(playerIdentity(MAP, "Riley Poe ??")).toBe("lee zii jia");
    });
});