import path from "node:path";
import { CourtReserveClient } from "../src";
import { loadConfig, enabledJobs, type JobConfig } from "./config";
import { loadRosterFile } from "./csv";
import { groupBookingsIntoSessions, planSession, type SessionGroup, type SessionPlan } from "./session";

export type RunOptions = {
    dryRun: boolean;
    job?: string;
};

function rosterPath(configPath: string, job: JobConfig): string {
    return path.resolve(path.dirname(configPath), job.session.rosterFile);
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
 * Ensures each enabled job's roster is reflected in its matching bookings: a
 * job's `match` identifies a session's bookings, which are then grouped by
 * date/time/location and reconciled court-by-court. Names in the roster but on
 * no court are added; names on a court but no longer in the roster are removed
 * (the organizer is never removed). Returns false if any job failed at the
 * config/data level (missing CSV); a false return is intended to become a
 * non-zero exit code so systemd surfaces it, while player-level outcomes
 * (not-found, ambiguous, overflow) never affect it.
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
                const roster = loadRosterFile(rosterPath(configPath, job));
                const { location, ...filters } = job.match ?? {};
                const bookings = await client.getCurrentBookings(filters);
                const sessions = groupBookingsIntoSessions(bookings, location);

                console.log(
                    `[job "${job.name}"] roster: ${roster.length} player(s), ${bookings.length} booking(s) in ${sessions.length} session(s)`,
                );

                for (const session of sessions) {
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
