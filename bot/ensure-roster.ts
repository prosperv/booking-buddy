import path from "node:path";
import { CourtReserveClient } from "../src";
import { loadConfig, enabledJobs, type JobConfig } from "./config";
import { loadRosterFile, formatDateKey, type Roster } from "./csv";
import { groupBookingsIntoSessions, planSession, type SessionGroup, type SessionPlan } from "./session";

export type RunOptions = {
    dryRun: boolean;
    job?: string;
};

function rosterPath(configPath: string, job: JobConfig): string {
    return path.resolve(path.dirname(configPath), job.session.rosterFile);
}

function sessionDate(session: SessionGroup): Date {
    return session.courts[0].startTime;
}

/**
 * A roster's own date (and start time, when the signups file carries one)
 * identify the session it belongs to. Matching is by month/day always, and by
 * start time only when the roster specifies it — so a day with multiple
 * sessions disambiguates correctly.
 */
function findSessionFor(sessions: SessionGroup[], roster: Roster): SessionGroup | undefined {
    return sessions.find((session) => {
        const date = sessionDate(session);
        const sameDate =
            date.getMonth() + 1 === roster.date.getMonth() + 1 && date.getDate() === roster.date.getDate();
        if (!sameDate) return false;
        if (roster.startTime !== undefined) {
            return session.startTime === roster.startTime;
        }
        return true;
    });
}

function printSession(session: SessionGroup, plan: SessionPlan, dryRun: boolean): void {
    console.log(
        `[session] ${session.date} ${session.startTime} @ ${session.location} (${session.courts.length} court(s))`,
    );

    for (const court of plan.courts) {
        const b = court.booking;
        console.log(`  Court ${b.courtNumber} (${b.bookingId}):`);
        if (court.add.length > 0) {
            console.log(`    ${dryRun ? "would add" : "add"}: ${court.add.map((n) => `"${n}"`).join(", ")}`);
        }
        if (court.remove.length > 0) {
            console.log(`    ${dryRun ? "would remove" : "remove"}: ${court.remove.map((n) => `"${n}"`).join(", ")}`);
        }
        if (court.alreadyPlaced.length > 0) {
            console.log(`    already on court: ${court.alreadyPlaced.map((n) => `"${n}"`).join(", ")}`);
        }
    }

    if (plan.satisfied.length > 0) {
        console.log(`  satisfied (on every court): ${plan.satisfied.map((n) => `"${n}"`).join(", ")}`);
    }
    if (plan.tooShort.length > 0) {
        console.log(`  too short to search: ${plan.tooShort.map((n) => `"${n}"`).join(", ")}`);
    }
    if (plan.overflow.length > 0) {
        console.log(`  no space (overflow): ${plan.overflow.map((n) => `"${n}"`).join(", ")}`);
    }
}

/**
 * Ensures each enabled job's player signups are reflected in its matching
 * bookings. A job's `match` identifies the recurring slot (weekday/startTime),
 * and its roster CSV (auto-detected format) lists player signups per dated
 * event. Bookings are grouped by date/time/location into sessions, and each
 * signup list is reconciled against the session whose date and — when the
 * signups file carries one — start time match. A signup list with no matching
 * booking (courts not booked yet) is reported and skipped. Returns false only
 * for config/data problems (e.g. a missing or empty roster CSV), so systemd
 * can flag them; player-level outcomes never affect it.
 */
export async function runEnsureRoster(configPath: string, options: RunOptions): Promise<boolean> {
    const config = loadConfig(configPath);
    const jobs = enabledJobs(config, options.job);
    const mode = options.dryRun ? "DRY-RUN" : "RUN";

    console.log(`ensure-roster [${mode}] ${jobs.length} job(s)`);

    const client = new CourtReserveClient({
        headless: false});
    await client.init();
    let ok = true;
    try {
        if (!(await client.isLoggedIn())) {
            console.error("ensure-roster: not logged in — aborting.");
            return false;
        }

        for (const job of jobs) {
            try {
                const rosterSet = loadRosterFile(rosterPath(configPath, job));
                if (rosterSet.rosters.length === 0) {
                    throw new Error(`no rosters found in roster for job "${job.name}"`);
                }

                const { location, ...filters } = job.match ?? {};
                const bookings = await client.getCurrentBookings(filters);
                const sessions = groupBookingsIntoSessions(bookings, location);

                console.log(
                    `[job "${job.name}"] ${rosterSet.rosters.length} roster(s), ${bookings.length} booking(s) in ${sessions.length} session(s)`,
                );

                for (const roster of rosterSet.rosters) {
                    const session = findSessionFor(sessions, roster);
                    if (!session) {
                        console.log(
                            `[job "${job.name}"] ${formatDateKey(roster.date)}${
                                roster.startTime ? ` ${roster.startTime}` : ""
                            }: ${roster.players.length} player(s) but no booking found — skipping`,
                        );
                        continue;
                    }

                    const plan = planSession(session, roster.players, job.session.courtCapacity, job.session.organizer);
                    printSession(session, plan, options.dryRun);

                    if (options.dryRun) continue;

                    for (const court of plan.courts) {
                        if (court.add.length === 0 && court.remove.length === 0) continue;
                        const result = await client.swapPlayersOnBooking(
                            court.booking,
                            court.remove.map((name) => ({ name })),
                            court.add.map((name) => ({ name })),
                        );
                        console.log(
                            `    saved=${result.saved} removed=${result.removed.length} added=${result.added.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
                        );
                        for (const failed of result.failed) {
                            console.log(`    FAILED ${JSON.stringify(failed)}`);
                        }
                    }
                }
            } catch (err) {
                ok = false;
                console.error(`[job "${job.name}"] error: ${err instanceof Error ? err.message : err}`);
            }
        }
    } finally {
        await client.close();
    }

    return ok;
}
