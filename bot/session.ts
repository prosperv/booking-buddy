import type { Booking } from "../src";
import { normalizePlayerName, searchNameError } from "../src/players";

export type SessionGroup = {
    date: string;
    startTime: string;
    location: string;
    courts: Booking[];
};

export type CourtAssignment = {
    booking: Booking;
    add: string[];
    remove: string[];
    alreadyPlaced: string[];
};

export type SessionPlan = {
    courts: CourtAssignment[];
    satisfied: string[];
    tooShort: string[];
    overflow: string[];
};

function dateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function timeKey(date: Date): string {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Groups bookings into sessions by (date, startTime, location). When a
 * `location` is supplied, only bookings at that location are considered
 * (case-insensitive). Within each session the courts are sorted by court
 * number, and the sessions themselves are ordered chronologically.
 */
export function groupBookingsIntoSessions(bookings: Booking[], location?: string): SessionGroup[] {
    const filtered = location
        ? bookings.filter((b) => b.courtLocation.toLowerCase() === location.toLowerCase())
        : bookings;

    const map = new Map<string, Booking[]>();
    for (const b of filtered) {
        const key = `${dateKey(b.startTime)}|${timeKey(b.startTime)}|${b.courtLocation.toLowerCase()}`;
        const list = map.get(key) ?? [];
        list.push(b);
        map.set(key, list);
    }

    const groups: SessionGroup[] = [];
    for (const list of map.values()) {
        list.sort((a, b) => a.courtNumber - b.courtNumber);
        const first = list[0];
        groups.push({
            date: dateKey(first.startTime),
            startTime: timeKey(first.startTime),
            location: first.courtLocation,
            courts: list,
        });
    }
    groups.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    return groups;
}

/**
 * Plans how to reconcile a roster against a session's courts, without touching
 * the browser. The roster is authoritative: names on no court are distributed
 * into free slots (roster order preserved, courts filled in court-number
 * order), while names already on a court that are no longer in the roster are
 * marked for removal — except the organizer (and any name that appears on every
 * court), who is never removed.
 *
 * Each roster name is classified by how many of the session's courts it already
 * appears on: on every court it is the organizer (or equivalent) and is
 * reported as satisfied; on some-but-not-all courts it is left in place so a
 * re-run never churns an earlier assignment; on none it becomes a candidate for
 * a free slot. Names too short for the member search are flagged rather than
 * assigned, and candidates that exceed the session's total free slots land in
 * `overflow`.
 *
 * A removal frees a slot: free capacity is computed from the player count
 * minus the names being removed, so a dropped player's court can absorb a
 * replacement in the same run.
 */
export function planSession(
    group: SessionGroup,
    roster: string[],
    capacity: number,
    organizer?: string,
): SessionPlan {
    const { courts } = group;
    const courtPlayers = courts.map((b) => b.players.map((p) => normalizePlayerName(p)));
    const rosterNorm = new Set(roster.map((n) => normalizePlayerName(n)));
    const organizerNorm = organizer ? normalizePlayerName(organizer) : null;

    // Names that appear on every court are the organizer (or equivalent) and
    // must never be removed, even when they are absent from the roster. This
    // only applies to multi-court sessions; on a single court the "on every
    // court" heuristic is degenerate (every player qualifies), so the organizer
    // config alone decides there.
    const courtCount = new Map<string, number>();
    for (const players of courtPlayers) {
        for (const name of new Set(players)) {
            courtCount.set(name, (courtCount.get(name) ?? 0) + 1);
        }
    }
    // Identify names that appear on every court aka the organizer.
    const onEveryCourt = new Set(
        [...courtCount].filter(([, count]) => count === courts.length).map(([name]) => name),
    );

    const removeByCourt = courts.map((booking) => {
        const remove: string[] = [];
        const seen = new Set<string>();
        for (const p of booking.players) {
            const norm = normalizePlayerName(p);
            if (seen.has(norm)) continue;
            seen.add(norm);
            if (rosterNorm.has(norm)) continue;
            if (organizerNorm !== null && norm === organizerNorm) continue;
            if (courts.length > 1 && onEveryCourt.has(norm)) continue;
            remove.push(p);
        }
        return remove;
    });

    const satisfied: string[] = [];
    const alreadyPlacedByCourt: string[][] = courts.map(() => []);
    const candidates: string[] = [];
    const tooShort: string[] = [];

    for (const name of roster) {
        const normalized = normalizePlayerName(name);
        const onCourts: number[] = [];
        courtPlayers.forEach((players, i) => {
            if (players.includes(normalized)) onCourts.push(i);
        });

        if (onCourts.length === courts.length) {
            satisfied.push(name);
        } else if (onCourts.length > 0) {
            for (const i of onCourts) alreadyPlacedByCourt[i].push(name);
        } else if (searchNameError(name)) {
            tooShort.push(name);
        } else {
            candidates.push(name);
        }
    }

    const freeSlots = courts.map((b, i) => Math.max(0, capacity - (b.players.length - removeByCourt[i].length)));
    const addByCourt: string[][] = courts.map(() => []);

    let cursor = 0;
    for (let i = 0; i < courts.length; i++) {
        let remaining = freeSlots[i];
        while (remaining > 0 && cursor < candidates.length) {
            addByCourt[i].push(candidates[cursor]);
            cursor += 1;
            remaining -= 1;
        }
    }

    return {
        courts: courts.map((booking, i) => ({
            booking,
            add: addByCourt[i],
            remove: removeByCourt[i],
            alreadyPlaced: alreadyPlacedByCourt[i],
        })),
        satisfied,
        tooShort,
        overflow: candidates.slice(cursor),
    };
}
