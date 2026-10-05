import { describe, expect, it } from "vitest";
import type { Booking } from "../../src";
import { groupBookingsIntoSessions, planSession } from "../session";

const NAMES = [
    "Viktor Axelsen",
    "Chen Long",
    "Chou Tien-chen",
    "Lee Zii Jia",
    "Lee Zii Jiaa",
    "Lee Zii Chau",
    "Lee Zii Duong",
    "Lee Zii Gunaman",
    "Lee Zii Ho",
    "Lee Zii Nakata",
    "Lee Zii Phan",
    "Lee Zii Wu",
];

function booking(opts: {
    id: string;
    court: number;
    start: Date;
    players: string[];
    location?: string;
}): Booking {
    return {
        bookingId: opts.id,
        dayOfWeek: "Tue",
        startTime: opts.start,
        endTime: new Date(opts.start.getTime() + 90 * 60_000),
        courtNumber: opts.court,
        courtLocation: opts.location ?? "Bellevue",
        players: opts.players,
    };
}

const start = new Date(2026, 8, 1, 18, 0); // Tue Sep 1 2026, 18:00 local

describe("groupBookingsIntoSessions", () => {
    it("groups same date/time/location into one session, sorted by court number", () => {
        const groups = groupBookingsIntoSessions([
            booking({ id: "2", court: 2, start, players: [] }),
            booking({ id: "1", court: 1, start, players: [] }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].courts.map((b) => b.courtNumber)).toEqual([1, 2]);
    });

    it("splits sessions by date", () => {
        const later = new Date(2026, 8, 8, 18, 0);
        const groups = groupBookingsIntoSessions([
            booking({ id: "1", court: 1, start, players: [] }),
            booking({ id: "2", court: 1, start: later, players: [] }),
        ]);
        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.date)).toEqual(["2026-09-01", "2026-09-08"]);
    });

    it("splits sessions by start time", () => {
        const groups = groupBookingsIntoSessions([
            booking({ id: "1", court: 1, start, players: [] }),
            booking({ id: "2", court: 1, start: new Date(2026, 8, 1, 19, 0), players: [] }),
        ]);
        expect(groups).toHaveLength(2);
    });

    it("splits sessions by location", () => {
        const groups = groupBookingsIntoSessions([
            booking({ id: "1", court: 1, start, players: [], location: "Bellevue" }),
            booking({ id: "2", court: 1, start, players: [], location: "Mukilteo" }),
        ]);
        expect(groups).toHaveLength(2);
    });

    it("filters by location case-insensitively", () => {
        const groups = groupBookingsIntoSessions(
            [
                booking({ id: "1", court: 1, start, players: [], location: "Bellevue" }),
                booking({ id: "2", court: 2, start, players: [], location: "Bellevue" }),
                booking({ id: "3", court: 1, start, players: [], location: "Mukilteo" }),
            ],
            "bellevue",
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].courts.map((b) => b.bookingId)).toEqual(["1", "2"]);
    });
});

describe("planSession", () => {
    const organizer = "Kento Momota";

    function group(courts: Booking[]) {
        return { date: "2026-09-01", startTime: "18:00", location: "Bellevue", courts };
    }

    it("fills courts in court-number order, preserving roster order", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
            booking({ id: "3", court: 3, start, players: [organizer] }),
        ]);

        const plan = planSession(session, NAMES.slice(0, 10), 6, organizer);
        expect(plan.courts.map((c) => c.add)).toEqual([NAMES.slice(0, 5), NAMES.slice(5, 10), []]);
        expect(plan.courts.map((c) => c.remove)).toEqual([[], [], []]);
        expect(plan.overflow).toEqual([]);
        expect(plan.waitlisted).toEqual([]);
    });

    it("reports overflow when the roster exceeds total free slots", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, NAMES.slice(0, 11), 6, organizer);
        expect(plan.courts.map((c) => c.add)).toEqual([NAMES.slice(0, 5), NAMES.slice(5, 10)]);
        // Both courts end up 6/6, so the fullness tie breaks on court number.
        expect(plan.overflow).toEqual([{ name: NAMES[10], court: 1, bookingId: "1", seated: 6 }]);
        expect(plan.waitlisted).toEqual([]);
    });

    it("attributes overflow to the fullest court first, at most one name per court", () => {
        // Court 1 is over capacity (7 players on a 6-person court) and blocks;
        // courts 2 and 3 fill to 6/6 during this run.
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, ...NAMES.slice(0, 6)] }),
            booking({ id: "2", court: 2, start, players: [organizer, NAMES[0]] }),
            booking({ id: "3", court: 3, start, players: [organizer] }),
        ]);

        // The names already on a court stay put, so only the fresh ones are
        // candidates: 9 of the 16 get one of the 9 free slots on courts 2 and 3,
        // leaving 7 with nowhere to go.
        const fresh = [...NAMES.slice(6), ...Array.from({ length: 11 }, (_, i) => `Extra Player ${i}`)];
        const plan = planSession(session, [...NAMES.slice(0, 6), ...fresh], 6, organizer);

        expect(plan.courts.map((c) => c.add.length)).toEqual([0, 4, 5]);
        // One name per court, fullest first: the over-capacity court leads, and
        // the two 6/6 courts fall back to court number.
        expect(plan.overflow).toEqual([
            { name: fresh[9], court: 1, bookingId: "1", seated: 7 },
            { name: fresh[10], court: 2, bookingId: "2", seated: 6 },
            { name: fresh[11], court: 3, bookingId: "3", seated: 6 },
        ]);
        // Everything past one per court has no court to be attributed to.
        expect(plan.waitlisted).toEqual(fresh.slice(12));
    });

    it("waitlists names that overflow past one per court", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
            booking({ id: "3", court: 3, start, players: [organizer] }),
        ]);

        // 20 names into 15 free slots: one per court overflows, four waitlist.
        const roster = [...NAMES, ...Array.from({ length: 9 }, (_, i) => `Extra Player ${i}`)];
        const plan = planSession(session, roster, 6, organizer);
        expect(plan.overflow).toEqual([
            { name: roster[15], court: 1, bookingId: "1", seated: 6 },
            { name: roster[16], court: 2, bookingId: "2", seated: 6 },
            { name: roster[17], court: 3, bookingId: "3", seated: 6 },
        ]);
        expect(plan.waitlisted).toEqual(roster.slice(18));
    });

    it("treats a name on every court as satisfied (organizer)", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, [organizer, "Viktor Axelsen"], 6, organizer);
        expect(plan.satisfied).toEqual([organizer]);
        expect(plan.courts[0].add).toEqual(["Viktor Axelsen"]);
        expect(plan.courts[0].alreadyPlaced).toEqual([]);
    });

    it("leaves a roster name already on one court in place", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, "Viktor Axelsen"] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, ["Viktor Axelsen", "Chen Long", "Chou Tien-chen"], 6, organizer);
        expect(plan.courts[0].alreadyPlaced).toEqual(["Viktor Axelsen"]);
        expect(plan.courts[0].add).toEqual(["Chen Long", "Chou Tien-chen"]);
        expect(plan.courts[0].remove).toEqual([]);
        expect(plan.courts[1].add).toEqual([]);
    });

    it("flags names too short to search", () => {
        const session = group([booking({ id: "1", court: 1, start, players: [organizer] })]);

        const plan = planSession(session, ["Al", "Chen Long"], 6, organizer);
        expect(plan.tooShort).toEqual(["Al"]);
        expect(plan.courts[0].add).toEqual(["Chen Long"]);
    });

    it("removes a name no longer in the roster", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, "Viktor Axelsen"] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, ["Chen Long"], 6, organizer);
        expect(plan.courts[0].remove).toEqual(["Viktor Axelsen"]);
        expect(plan.courts[0].add).toEqual(["Chen Long"]);
    });

    it("never removes the organizer, even on a single court", () => {
        const session = group([booking({ id: "1", court: 1, start, players: [organizer, "Viktor Axelsen"] })]);

        const plan = planSession(session, ["Chen Long"], 6, organizer);
        expect(plan.courts[0].remove).toEqual(["Viktor Axelsen"]);
        expect(plan.courts[0].add).toEqual(["Chen Long"]);
    });

    it("a removal frees a slot for a replacement in the same run", () => {
        const session = group([
            booking({
                id: "1",
                court: 1,
                start,
                players: [organizer, "Viktor Axelsen", "Chen Long", "Chou Tien-chen", "Lee Zii Jia", "Lee Zii Jiaa"],
            }),
        ]);

        const plan = planSession(
            session,
            ["Chen Long", "Chou Tien-chen", "Lee Zii Jia", "Lee Zii Jiaa", "Lee Zii Chau"],
            6,
            organizer,
        );
        expect(plan.courts[0].remove).toEqual(["Viktor Axelsen"]);
        expect(plan.courts[0].add).toEqual(["Lee Zii Chau"]);
        expect(plan.overflow).toEqual([]);
        expect(plan.waitlisted).toEqual([]);
    });

    it("protects a name on every court in a multi-court session even without organizer config", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, ["Viktor Axelsen"], 6);
        expect(plan.courts.map((c) => c.remove)).toEqual([[], []]);
        expect(plan.courts[0].add).toEqual(["Viktor Axelsen"]);
    });

    it("never adds or removes an organizer who booked the courts but is not playing", () => {
        // The organizer holds every court's reservation but is not on the roster,
        // so they are neither added nor removed — and their seat still counts
        // against capacity, leaving capacity - 1 playable slots per court.
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const roster = NAMES.slice(0, 10);
        const plan = planSession(session, roster, 6, organizer);
        expect(plan.courts.map((c) => c.add)).toEqual([roster.slice(0, 5), roster.slice(5, 10)]);
        expect(plan.courts.map((c) => c.remove)).toEqual([[], []]);
        expect(plan.satisfied).toEqual([]);
        expect(plan.overflow).toEqual([]);
        expect(plan.waitlisted).toEqual([]);
    });

    it("reports the organizer as a blocked seat when they are not playing and the roster is full", () => {
        // The organizer's seat is a real slot even though they are not playing, so
        // only 2 x (capacity - 1) = 10 of these 15 names can be added: one per
        // court overflows, three waitlist.
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const roster = [...NAMES, ...Array.from({ length: 3 }, (_, i) => `Extra Player ${i}`)];
        const plan = planSession(session, roster, 6, organizer);
        expect(plan.courts.map((c) => c.add).map((a) => a.length)).toEqual([5, 5]);
        expect(plan.overflow).toEqual([
            { name: roster[10], court: 1, bookingId: "1", seated: 6 },
            { name: roster[11], court: 2, bookingId: "2", seated: 6 },
        ]);
        expect(plan.waitlisted).toEqual(roster.slice(12));
    });

    it("leaves everything alone when the roster already matches", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, "Viktor Axelsen"] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, [organizer, "Viktor Axelsen"], 6, organizer);
        expect(plan.satisfied).toEqual([organizer]);
        expect(plan.courts[0].alreadyPlaced).toEqual(["Viktor Axelsen"]);
        expect(plan.courts.map((c) => c.add)).toEqual([[], []]);
        expect(plan.courts.map((c) => c.remove)).toEqual([[], []]);
    });
});

describe("planSession with a name map", () => {
    const organizer = "Kento Momota";
    /** Keys normalized and values as written, as `validateConfig` stores them. */
    const nameMap = { "riley poe": "Lee Zii Jia", "riley poo": "Lee Zii Jiaa" };

    function group(courts: Booking[]) {
        return { date: "2026-09-01", startTime: "18:00", location: "Bellevue", courts };
    }

    it("adds the mapped member name, since that is what the search matches", () => {
        const session = group([booking({ id: "1", court: 1, start, players: [organizer] })]);

        const plan = planSession(session, ["Riley Poe", "Chen Long"], 6, organizer, nameMap);
        expect(plan.courts[0].add).toEqual(["Lee Zii Jia", "Chen Long"]);
    });

    it("does not re-add a name the court already holds under its mapped name", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, "Lee Zii Jia"] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, ["Riley Poe", "Chen Long"], 6, organizer, nameMap);
        expect(plan.courts[0].alreadyPlaced).toEqual(["Riley Poe"]);
        expect(plan.courts.map((c) => c.add)).toEqual([["Chen Long"], []]);
        expect(plan.courts.map((c) => c.remove)).toEqual([[], []]);
    });

    it("does not remove a court player still on the roster under their roster name", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, "Riley Poe"] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, ["Riley Poe"], 6, organizer, nameMap);
        expect(plan.courts[0].alreadyPlaced).toEqual(["Riley Poe"]);
        expect(plan.courts.map((c) => c.remove)).toEqual([[], []]);
        expect(plan.courts.map((c) => c.add)).toEqual([[], []]);
    });

    it("keeps two roster names that map to different members apart", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer, "Lee Zii Jia"] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        // "Riley Poo" is not the court's "Lee Zii Jia", so it is a candidate
        // and goes in as its own member name.
        const plan = planSession(session, ["Riley Poo"], 6, organizer, nameMap);
        expect(plan.courts[0].alreadyPlaced).toEqual([]);
        expect(plan.courts.map((c) => c.add)).toEqual([["Lee Zii Jiaa"], []]);
    });

    it("protects a mapped organizer who is not in the roster", () => {
        const session = group([booking({ id: "1", court: 1, start, players: ["Lee Zii Jia"] })]);

        const plan = planSession(session, ["Chen Long"], 6, "Riley Poe", nameMap);
        expect(plan.courts[0].remove).toEqual([]);
        expect(plan.courts[0].add).toEqual(["Chen Long"]);
    });

    it("tests searchability on the mapped name, not the roster name", () => {
        const session = group([booking({ id: "1", court: 1, start, players: [organizer] })]);

        const plan = planSession(session, ["Al"], 6, organizer, { al: "Lee Zii Jia" });
        expect(plan.tooShort).toEqual([]);
        expect(plan.courts[0].add).toEqual(["Lee Zii Jia"]);
    });

    it("reports an unplaced name by its mapped name", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const full = [
            "Chen Long",
            "Chou Tien-chen",
            "Lee Zii Duong",
            "Lee Zii Gunaman",
            "Lee Zii Ho",
            "Lee Zii Nakata",
            "Lee Zii Phan",
            "Lee Zii Wu",
            "Lee Zii Yi",
            "Viktor Axelsen",
        ];
        const plan = planSession(session, [...full, "Riley Poe"], 6, organizer, nameMap);
        expect(plan.courts.map((c) => c.add)).toEqual([[full[0], full[1], full[2], full[3], full[4]], full.slice(5)]);
        expect(plan.overflow).toEqual([{ name: "Lee Zii Jia", court: 1, bookingId: "1", seated: 6 }]);
        expect(plan.waitlisted).toEqual([]);
    });
});
