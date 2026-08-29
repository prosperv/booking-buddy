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
    });

    it("reports overflow when the roster exceeds total free slots", () => {
        const session = group([
            booking({ id: "1", court: 1, start, players: [organizer] }),
            booking({ id: "2", court: 2, start, players: [organizer] }),
        ]);

        const plan = planSession(session, NAMES.slice(0, 11), 6, organizer);
        expect(plan.courts.map((c) => c.add)).toEqual([NAMES.slice(0, 5), NAMES.slice(5, 10)]);
        expect(plan.overflow).toEqual([NAMES[10]]);
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
