import type { Booking } from "../src";
import { searchNameError } from "../src/players";
import { playerIdentity, mappedName, type NameMap } from "./name-map";

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

/**
 * A roster name that should have been added to a court but could not be, because
 * every court in the session is at capacity. The court is the one the name is
 * attributed to for reporting only — no court actually had room, which is why
 * the name was left off.
 */
export type OverflowPlayer = {
    /** The member name that would have been searched (mapped, when a nameMap is supplied). */
    name: string;
    /** Court number the name is attributed to: the fullest court, at most one name per court. */
    court: number;
    bookingId: string;
    /** Player count on that court once the plan is applied — why it had no room. */
    seated: number;
};

export type SessionPlan = {
    courts: CourtAssignment[];
    satisfied: string[];
    tooShort: string[];
    overflow: OverflowPlayer[];
    /** Names with no court to be attributed to: overflow beyond one per court. */
    waitlisted: string[];
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
 * assigned, and candidates that exceed the session's total free slots are split
 * two ways: `overflow` carries the first court's worth of them — at most one
 * name per court, attributed to the fullest court first — and `waitlisted`
 * carries the rest, which have no court to be attributed to. Both are
 * hypothetical: no court had room, so none of these names were added.
 *
 * A removal frees a slot: free capacity is computed from the player count
 * minus the names being removed, so a dropped player's court can absorb a
 * replacement in the same run.
 *
 * NOTE: the organizer is protected (never removed) but never *added*. It is
 * assumed the organizer is already on every court (they booked them), which is
 * why they are only skipped. If a session's courts ever exist without the
 * organizer on them, the organizer falls into the ordinary "candidate" branch
 * and would be placed on a single court, not every court — book the organizer
 * onto each court first, or the split will be wrong.
 *
 * When a `nameMap` is supplied, every name — on the courts, in the roster, and
 * the organizer — is reduced to a `playerIdentity` before being compared, so a
 * roster's `Riley Poe` and a court's `Lee Zii Jia` are recognised as the same
 * player and neither is added twice or removed. Only the name that is actually
 * searched is mapped, and that is the name reported in `add`/`overflow`.
 */
export function planSession(
    group: SessionGroup,
    roster: string[],
    capacity: number,
    organizer?: string,
    nameMap?: NameMap,
): SessionPlan {
    const { courts } = group;
    const courtPlayers = courts.map((b) => b.players.map((p) => playerIdentity(nameMap, p)));
    const rosterIdentities = new Set(roster.map((n) => playerIdentity(nameMap, n)));
    // The organizer (or any name on every court) is protected from removal, but
    // is not auto-added — see the NOTE in the planSession doc above.
    const organizerNorm = organizer ? playerIdentity(nameMap, organizer) : null;

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
            const identity = playerIdentity(nameMap, p);
            if (seen.has(identity)) continue;
            seen.add(identity);
            if (rosterIdentities.has(identity)) continue;
            if (organizerNorm !== null && identity === organizerNorm) continue;
            if (courts.length > 1 && onEveryCourt.has(identity)) continue;
            remove.push(p);
        }
        return remove;
    });

    const satisfied: string[] = [];
    const alreadyPlacedByCourt: string[][] = courts.map(() => []);
    const candidates: string[] = [];
    const tooShort: string[] = [];

    for (const name of roster) {
        const identity = playerIdentity(nameMap, name);
        // The mapped name is what actually gets typed into the member search,
        // so it is what the plan carries and what the search has to be able to
        // match — a short roster name mapping to a searchable one is addable.
        const toAdd = mappedName(nameMap, name);
        const onCourts: number[] = [];
        courtPlayers.forEach((players, i) => {
            if (players.includes(identity)) onCourts.push(i);
        });

        if (onCourts.length === courts.length) {
            satisfied.push(name);
        } else if (onCourts.length > 0) {
            for (const i of onCourts) alreadyPlacedByCourt[i].push(name);
        } else if (searchNameError(toAdd)) {
            tooShort.push(name);
        } else {
            candidates.push(toAdd);
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

    // Names the session has no room for, attributed to the courts for reporting:
    // at most one per court, fullest court first, so the report reads as "each
    // court is one player short" and an over-capacity court leads (it is the one
    // actually blocking). Everything past one per court is `waitlisted` — it
    // needs a court that is not booked yet.
    const postPlayers = courts.map((b, i) => b.players.length - removeByCourt[i].length + addByCourt[i].length);
    const byFullness = courts
        .map((_, i) => i)
        .sort((a, b) => postPlayers[b] - postPlayers[a] || courts[a].courtNumber - courts[b].courtNumber);
    const leftover = candidates.slice(cursor);
    const overflow: OverflowPlayer[] = leftover.slice(0, byFullness.length).map((name, j) => {
        const i = byFullness[j];
        return {
            name,
            court: courts[i].courtNumber,
            bookingId: courts[i].bookingId,
            seated: postPlayers[i],
        };
    });

    return {
        courts: courts.map((booking, i) => ({
            booking,
            add: addByCourt[i],
            remove: removeByCourt[i],
            alreadyPlaced: alreadyPlacedByCourt[i],
        })),
        satisfied,
        tooShort,
        overflow,
        waitlisted: leftover.slice(byFullness.length),
    };
}
