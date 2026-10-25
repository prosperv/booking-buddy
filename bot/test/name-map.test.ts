import { describe, expect, it } from "vitest";
import { mappedName, playerIdentity, resolveMapping, type NameMap } from "../name-map";

/** Keys normalized and values as written, as `validateConfig` stores them. */
const MAP: NameMap = {
    "riley poe": "Lee Zii Jia",
    "riley poo": "Lee Zii Jiaa",
};

/** The club's two members who share a name, pinned by id. */
const ID_MAP: NameMap = {
    "lee chong wei": 6227635,
};

describe("resolveMapping", () => {
    it("returns the member name for a name mapping", () => {
        expect(resolveMapping(MAP, "Riley Poe")).toEqual({ name: "Lee Zii Jia" });
    });

    it("carries the id for an id mapping", () => {
        expect(resolveMapping(ID_MAP, "Lee Chong Wei")).toEqual({
            name: "Lee Chong Wei",
            memberId: 6227635,
        });
    });

    it("keeps the roster name as the query for an id mapping", () => {
        // The member search is a case-insensitive substring match, so the roster
        // name is what brings both same-named members back to choose between.
        // Inventing a query would break that.
        expect(resolveMapping(ID_MAP, "Lee Chong Wei").name).toBe("Lee Chong Wei");
    });

    it("leaves an unmapped name untouched", () => {
        expect(resolveMapping(MAP, "Kento Momota")).toEqual({ name: "Kento Momota" });
    });

    it("is the identity function when no map is configured", () => {
        expect(resolveMapping(undefined, "Riley Poe")).toEqual({ name: "Riley Poe" });
    });
});

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

    // An id mapping selects a member; it is not another spelling of the name, so
    // there is nothing to alias to. Treating the id as a name would normalize a
    // number and make the roster entry and the court entry look like strangers.
    it("ends the chain at an id rather than aliasing to it", () => {
        expect(playerIdentity(ID_MAP, "Lee Chong Wei")).toBe("lee chong wei");
    });

    it("does not throw on an id value", () => {
        expect(() => playerIdentity(ID_MAP, "Lee Chong Wei")).not.toThrow();
    });

    it("keeps a court already holding the other spelling as the same person", () => {
        // Booking cards carry no member ids, so identity has to stay name-based.
        // Normalizing "LEE CHONG WEI" the same as the roster's "Lee Chong Wei"
        // is what stops the bot adding a second Phuong to a court that already
        // has one. The id picks which one gets added; it does not change this.
        expect(playerIdentity(ID_MAP, "LEE CHONG WEI")).toBe(
            playerIdentity(ID_MAP, "Lee Chong Wei"),
        );
    });

    it("does not let an id entry alias two different roster names together", () => {
        const two: NameMap = { "lee chong wei": 6227635, "lee chong wei jr": 6227636 };
        expect(playerIdentity(two, "Lee Chong Wei")).not.toBe(
            playerIdentity(two, "Lee Chong Wei Jr"),
        );
    });
});