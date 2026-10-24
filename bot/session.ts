import type { Booking } from "../src";
import { searchNameError } from "../src/players";
import { courtCount } from "../src/booking";
import { playerIdentity, resolveMapping, type NameMap, type NameMapping } from "./name-map";

export type SessionGroup = {
    date: string;
    startTime: string;
    location: string;
    courts: Booking[];
};

export type CourtAssignment = {
    booking: Booking;
    /**
     * Names to add, as resolved against `nameMap`: `name` is what gets typed
     * into the member search, and `memberId` (when the config pins one) picks
     * which of the returned members to take. `name` is a plain string so this is
     * exactly `PlayerInput` for the add path.
     */
    add: NameMapping[];
    remove: string[];
    alreadyPlaced: string[];
};

/**
 * A roster name that should have been added to a reservation but could not be,
 * because that reservation has no room — its organizer's locked seat is the
 * reason the name could not be absorbed. The reservation is the one the name
 * is attributed to for reporting only — no seat actually had room, which is why
 * the name was left off.
 */
export type OverflowPlayer = {
    /** The member name that would have been searched (mapped, when a nameMap is supplied). */
    name: string;
    /** Court number of the reservation the name is attributed to (its lowest court). */
    court: number;
    bookingId: string;
    /** Player count on that reservation once the plan is applied — why it had no room. */
    seated: number;
    /** That reservation's own capacity, so a multi-court reservation is not full at 6. */
    capacity: number;
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
 * two ways: `overflow` carries one name per reservation, attributed to the
 * fullest reservation first, and `waitlisted` carries the rest, which have no
 * reservation to be attributed to. Both are hypothetical: no seat had room, so
 * none of these names were added.
 *
 * Free capacity is N x courtCapacity per reservation (a reservation covering N
 * courts holds N courts' worth), minus the names being removed, so a dropped
 * player's seat can absorb a replacement in the same run.
 *
 * `overflow` is bounded by the seats locked to reservation organizers: one per
 * reservation, or one fewer when the organizer is playing (they occupy one of
 * those seats productively). `waitlisted` takes everything past that.
 *
 * NOTE: the organizer is protected (never removed) but never *added*. It is
 * assumed the organizer is already on every reservation (they booked them),
 * which is why they are only skipped. If a session's reservations ever exist
 * without the organizer on them, the organizer falls into the ordinary
 * "candidate" branch and would be placed on a single reservation, not every one
 * — book the organizer onto each reservation first, or the split will be wrong.
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

    // A reservation covering N courts holds N times the per-court capacity.
    // The organizer occupies exactly one of those seats (one flat member list
    // per reservation), so a full multi-court reservation has N x capacity - 1
    // seats available to the roster when the organizer is not playing.
    const capacities = courts.map((b) => courtCount(b) * capacity);

    // Names that appear on every court are the organizer (or equivalent) and
    // must never be removed, even when they are absent from the roster. This
    // only applies to multi-court sessions; on a single court the "on every
    // court" heuristic is degenerate (every player qualifies), so the organizer
    // config alone decides there.
    const appearanceCount = new Map<string, number>();
    for (const players of courtPlayers) {
        for (const name of new Set(players)) {
            appearanceCount.set(name, (appearanceCount.get(name) ?? 0) + 1);
        }
    }
    // Identify names that appear on every court aka the organizer.
    const onEveryCourt = new Set(
        [...appearanceCount].filter(([, count]) => count === courts.length).map(([name]) => name),
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
    const candidates: NameMapping[] = [];
    const tooShort: string[] = [];

    for (const name of roster) {
        const identity = playerIdentity(nameMap, name);
        // The mapped name is what actually gets typed into the member search,
        // so it is what the plan carries and what the search has to be able to
        // match — a short roster name mapping to a searchable one is addable.
        // An id mapping carries no name to search for beyond the roster's own,
        // and pins which of the returned members to take.
        const toAdd = resolveMapping(nameMap, name);
        const onCourts: number[] = [];
        courtPlayers.forEach((players, i) => {
            if (players.includes(identity)) onCourts.push(i);
        });

        if (onCourts.length === courts.length) {
            satisfied.push(name);
        } else if (onCourts.length > 0) {
            for (const i of onCourts) alreadyPlacedByCourt[i].push(name);
        } else if (searchNameError(toAdd.name)) {
            tooShort.push(name);
        } else {
            candidates.push(toAdd);
        }
    }

    const freeSlots = courts.map((b, i) => Math.max(0, capacities[i] - (b.players.length - removeByCourt[i].length)));
    const addByCourt: NameMapping[][] = courts.map(() => []);

    let cursor = 0;
    for (let i = 0; i < courts.length; i++) {
        let remaining = freeSlots[i];
        while (remaining > 0 && cursor < candidates.length) {
            addByCourt[i].push(candidates[cursor]);
            cursor += 1;
            remaining -= 1;
        }
    }

    // Names the session has no room for, attributed to the reservations for
    // reporting: one per reservation, fullest first, so the report reads as
    // "this reservation is full because of its locked organizer seat", and an
    // over-capacity reservation leads (it is the one actually blocking).
    // Everything past that is `waitlisted` — it needs a new reservation, not a
    // freed slot.
    //
    // One seat per reservation is locked to whoever booked it and can never be
    // freed by a removal. When the organizer is playing they occupy one of
    // those seats productively; otherwise every reservation loses a seat to an
    // organizer who is not in the game. That is how many names could have been
    // added but for those seats — the overflow budget.
    const organizerPlaying =
        organizerNorm !== null &&
        rosterIdentities.has(organizerNorm) &&
        courtPlayers.some((players) => players.includes(organizerNorm));
    const overflowBudget = Math.max(0, courts.length - (organizerPlaying ? 1 : 0));

    const postPlayers = courts.map((b, i) => b.players.length - removeByCourt[i].length + addByCourt[i].length);
    const byFullness = courts
        .map((_, i) => i)
        .sort((a, b) => postPlayers[b] - postPlayers[a] || courts[a].courtNumber - courts[b].courtNumber);
    const leftover = candidates.slice(cursor);
    const overflow: OverflowPlayer[] = leftover.slice(0, overflowBudget).map((candidate, j) => {
        const i = byFullness[j];
        return {
            name: candidate.name,
            court: courts[i].courtNumber,
            bookingId: courts[i].bookingId,
            seated: postPlayers[i],
            capacity: capacities[i],
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
        waitlisted: leftover.slice(overflowBudget).map((c) => c.name),
    };
}

/**
 * Total physical courts across a session's reservations — the number a run
 * actually books, as opposed to `group.courts.length`, which counts
 * reservations (one of which may span several courts).
 */
export function sessionCourtCount(group: SessionGroup): number {
    return group.courts.reduce((sum, b) => sum + courtCount(b), 0);
}
