import path from "node:path";
import { CourtReserveClient, type Logger } from "../src";
import { loadConfig, enabledJobs, type JobConfig } from "./config";
import { loadRosterFile, formatDateKey, type Roster } from "./csv";
import { groupBookingsIntoSessions, planSession, type SessionGroup, type SessionPlan } from "./session";

export type RunOptions = {
    dryRun: boolean;
    job?: string;
    /**
     * Whether to run a headed (visible) browser. Defaults to `true`
     * (headless), which is what the systemd timer needs; interactive/local
     * runs can pass `false` to watch the run.
     */
    headless?: boolean;
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

function logSession(logger: Logger, session: SessionGroup, plan: SessionPlan): void {
    logger.info(
        `[session] ${session.date} ${session.startTime} @ ${session.location} (${session.courts.length} court(s))`,
        {
            event: "session",
            date: session.date,
            startTime: session.startTime,
            location: session.location,
            courts: session.courts.length,
        },
    );

    for (const court of plan.courts) {
        const b = court.booking;
        logger.info(`  Court ${b.courtNumber} (${b.bookingId})`, {
            event: "court",
            bookingId: b.bookingId,
            court: b.courtNumber,
            add: court.add,
            remove: court.remove,
            alreadyPlaced: court.alreadyPlaced,
        });
    }

    if (plan.satisfied.length > 0) {
        logger.info("  satisfied (on every court)", {
            event: "satisfied",
            names: plan.satisfied,
        });
    }
    if (plan.tooShort.length > 0) {
        logger.warn("  too short to search", {
            event: "too-short",
            names: plan.tooShort,
        });
    }
    if (plan.overflow.length > 0) {
        logger.warn("  no space (overflow)", {
            event: "overflow",
            names: plan.overflow,
        });
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
export async function runEnsureRoster(
    configPath: string,
    options: RunOptions,
    logger: Logger,
): Promise<boolean> {
    const config = loadConfig(configPath);
    const jobs = enabledJobs(config, options.job);
    const mode = options.dryRun ? "DRY-RUN" : "RUN";

    logger.info(`ensure-roster [${mode}] ${jobs.length} job(s)`, {
        event: "run-start",
        mode,
        jobs: jobs.length,
    });

    const client = new CourtReserveClient({ headless: options.headless ?? true });
    await client.init();
    let ok = true;
    try {
        if (!(await client.isLoggedIn())) {
            logger.error("ensure-roster: not logged in — aborting.", { event: "not-logged-in" });
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

                logger.info(
                    `[job "${job.name}"] ${rosterSet.rosters.length} roster(s), ${bookings.length} booking(s) in ${sessions.length} session(s)`,
                    {
                        event: "job-start",
                        job: job.name,
                        rosters: rosterSet.rosters.length,
                        bookings: bookings.length,
                        sessions: sessions.length,
                    },
                );

                for (const roster of rosterSet.rosters) {
                    const session = findSessionFor(sessions, roster);
                    if (!session) {
                        logger.warn(
                            `[job "${job.name}"] ${formatDateKey(roster.date)}${
                                roster.startTime ? ` ${roster.startTime}` : ""
                            }: ${roster.players.length} player(s) but no booking found — skipping`,
                            {
                                event: "no-booking",
                                job: job.name,
                                date: formatDateKey(roster.date),
                                players: roster.players.length,
                            },
                        );
                        continue;
                    }

                    const plan = planSession(session, roster.players, job.session.courtCapacity, job.session.organizer);
                    logSession(logger, session, plan);

                    if (options.dryRun) continue;

                    for (const court of plan.courts) {
                        if (court.add.length === 0 && court.remove.length === 0) continue;
                        const result = await client.swapPlayersOnBooking(
                            court.booking,
                            court.remove.map((name) => ({ name })),
                            court.add.map((name) => ({ name })),
                        );
                        logger.info(
                            `    saved=${result.saved} removed=${result.removed.length} added=${result.added.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
                            {
                                event: "swap",
                                job: job.name,
                                bookingId: court.booking.bookingId,
                                court: court.booking.courtNumber,
                                saved: result.saved,
                                removed: result.removed,
                                added: result.added,
                                skipped: result.skipped,
                                failed: result.failed,
                            },
                        );
                        for (const failed of result.failed) {
                            logger.warn(`    FAILED ${JSON.stringify(failed)}`, {
                                event: "player-failed",
                                job: job.name,
                                bookingId: court.booking.bookingId,
                                court: court.booking.courtNumber,
                                ...failed,
                            });
                        }
                    }
                }
            } catch (err) {
                ok = false;
                logger.error(`[job "${job.name}"] error: ${err instanceof Error ? err.message : err}`, {
                    event: "job-error",
                    job: job.name,
                    message: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                });
            }
        }
    } finally {
        await client.close();
    }

    logger.info(`ensure-roster done (ok=${ok})`, { event: "run-end", ok });
    return ok;
}
