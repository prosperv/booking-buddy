import path from "node:path";
import { CourtReserveClient } from "../src";
import { loadConfig, enabledJobs, type JobConfig } from "./config";
import { loadRosterFile, findRoster, type RosterColumn } from "./csv";
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

function hasSessionFor(sessions: SessionGroup[], column: RosterColumn): boolean {
    return sessions.some((session) => {
        const date = sessionDate(session);
        return date.getMonth() + 1 === column.month && date.getDate() === column.day;
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
 * Ensures each enabled job's date-column roster is reflected in its matching
 * bookings. A job's `match` identifies the recurring slot (weekday/startTime),
 * and its roster CSV lists, per date, the players signed up for that session.
 * Bookings are grouped by date/time/location and reconciled court-by-court for
 * each date that has a roster column. A session whose date has no roster
 * column (booked but no signups yet) is left untouched, and a roster date with
 * no matching booking (signups but courts not booked yet) is reported. Returns
 * false only for config/data problems (e.g. a missing or empty roster CSV), so
 * systemd can flag them; player-level outcomes never affect it.
 */
export async function runEnsureRoster(configPath: string, options: RunOptions): Promise<boolean> {
    const config = loadConfig(configPath);
    const jobs = enabledJobs(config, options.job);
    const mode = options.dryRun ? "DRY-RUN" : "RUN";

    console.log(`ensure-roster [${mode}] ${jobs.length} job(s)`);

    const client = new CourtReserveClient();
    await client.init();
    let ok = true;
    try {
        for (const job of jobs) {
            try {
                const columns = loadRosterFile(rosterPath(configPath, job));
                if (columns.length === 0) {
                    throw new Error(`no date columns found in roster for job "${job.name}"`);
                }

                const { location, ...filters } = job.match ?? {};
                const bookings = await client.getCurrentBookings(filters);
                const sessions = groupBookingsIntoSessions(bookings, location);

                console.log(
                    `[job "${job.name}"] ${columns.length} date column(s), ${bookings.length} booking(s) in ${sessions.length} session(s)`,
                );

                for (const session of sessions) {
                    const roster = findRoster(columns, sessionDate(session));
                    if (!roster) {
                        console.log(
                            `[session] ${session.date} ${session.startTime} @ ${session.location}: no roster for this date — skipping`,
                        );
                        continue;
                    }

                    const plan = planSession(session, roster, job.session.courtCapacity, job.session.organizer);
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

                for (const column of columns) {
                    if (!hasSessionFor(sessions, column)) {
                        console.log(
                            `[job "${job.name}"] ${column.label}: ${column.players.length} player(s) but no booking found — skipping`,
                        );
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
