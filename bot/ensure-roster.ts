import { CourtReserveClient, type Logger } from "../src";
import { loadConfig, enabledJobs, type BotConfig, type JobConfig } from "./config";
import { formatDateKey, type Roster, type RosterSet } from "./csv";
import { loadRoster, logRosterRead } from "./roster";
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

/**
 * Picks the one session a run reconciles: the closest one still ahead of
 * `now`, so each run advances to the next session once the previous one has
 * passed instead of re-editing a month of already-finished courts. A job that
 * pins `match.startTime` only considers rosters in that slot, so jobs sharing
 * one sheet (a 6:30 PM and an 8:00 PM group, say) each pick their own session.
 */
function selectNextRoster(
    rosterSet: RosterSet,
    job: JobConfig,
    now: Date,
    logger: Logger,
): Roster | undefined {
    const startTime = job.match?.startTime;
    const next = rosterSet.next(now, startTime !== undefined ? { startTime } : undefined);
    if (next) {
        logger.info(
            `[job "${job.name}"] next session: ${formatDateKey(next.date)}${
                next.startTime ? ` ${next.startTime}` : ""
            }${next.tab ? ` (${next.tab})` : ""} — ${next.players.length} player(s)`,
            {
                event: "roster-selected",
                job: job.name,
                date: formatDateKey(next.date),
                startTime: next.startTime,
                tab: next.tab,
                players: next.players.length,
                of: rosterSet.rosters.length,
            },
        );
    }
    return next;
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
 * and its roster (a CSV file or a Google Sheet, auto-detected format) lists player
 * signups per dated event. Bookings are grouped by date/time/location into
 * sessions, and the roster's **closest upcoming** session — the one after every
 * earlier session has passed — is reconciled against the matching booking, so a
 * run only ever edits the next game. Roster dates for a job's other sessions
 * are logged as deferred. A selected session with no matching booking (courts
 * not booked yet) is reported and skipped. Returns false only for
 * config/data problems (e.g. a missing or empty roster), so systemd can flag
 * them; player-level outcomes never affect it.
 */
export async function runEnsureRoster(
    configPath: string,
    options: RunOptions,
    logger: Logger,
): Promise<boolean> {
    let config: BotConfig;
    let jobs: JobConfig[];
    try {
        config = loadConfig(configPath);
        jobs = enabledJobs(config, options.job);
    } catch (err) {
        logger.error(`ensure-roster: config error: ${err instanceof Error ? err.message : err}`, {
            event: "config-error",
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        return false;
    }

    const mode = options.dryRun ? "DRY-RUN" : "RUN";

    logger.info(`ensure-roster [${mode}] ${jobs.length} job(s)`, {
        event: "run-start",
        mode,
        jobs: jobs.length,
    });

    // One instant for the whole run, so the month tabs that get read and the
    // "next session" that gets picked can never disagree across a midnight.
    const now = new Date();

    // Load every job's roster up front so a missing file or a sheet auth/network
    // failure fails fast without opening a browser. Failed jobs are skipped.
    let ok = true;
    const loaded: { job: JobConfig; rosterSet: RosterSet }[] = [];
    for (const job of jobs) {
        try {
            const rosterSet = await loadRoster(config, job, configPath, now);
            if (rosterSet.rosters.length === 0) {
                throw new Error(`no rosters found in roster for job "${job.name}"`);
            }
            logRosterRead(logger, job, rosterSet);
            loaded.push({ job, rosterSet });
        } catch (err) {
            ok = false;
            logger.error(`[job "${job.name}"] roster error: ${err instanceof Error ? err.message : err}`, {
                event: "roster-error",
                job: job.name,
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            });
        }
    }
    if (loaded.length === 0) {
        logger.error("ensure-roster: no rosters loaded — aborting.", { event: "no-rosters" });
        return false;
    }

    const client = new CourtReserveClient({ headless: options.headless ?? true });
    try {
        await client.init();
    } catch (err) {
        logger.error(`ensure-roster: client init failed: ${err instanceof Error ? err.message : err}`, {
            event: "init-failed",
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        return false;
    }
    try {
        if (!(await client.isLoggedIn())) {
            logger.error("ensure-roster: not logged in — aborting.", { event: "not-logged-in" });
            return false;
        }

        for (const { job, rosterSet } of loaded) {
            try {
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

                const selected = selectNextRoster(rosterSet, job, now, logger);

                for (const roster of rosterSet.rosters) {
                    if (roster === selected) continue;
                    logger.debug(
                        `[job "${job.name}"] ${formatDateKey(roster.date)}${
                            roster.startTime ? ` ${roster.startTime}` : ""
                        }: deferred — not the next session`,
                        {
                            event: "roster-deferred",
                            job: job.name,
                            date: formatDateKey(roster.date),
                            tab: roster.tab,
                        },
                    );
                }

                if (!selected) {
                    logger.info(`[job "${job.name}"]: no upcoming roster session — nothing to do`, {
                        event: "no-upcoming-roster",
                        job: job.name,
                        rosters: rosterSet.rosters.length,
                    });
                    continue;
                }

                const session = findSessionFor(sessions, selected);
                if (!session) {
                    logger.warn(
                        `[job "${job.name}"] ${formatDateKey(selected.date)}${
                            selected.startTime ? ` ${selected.startTime}` : ""
                        }: ${selected.players.length} player(s) but no booking found — skipping`,
                        {
                            event: "no-booking",
                            job: job.name,
                            date: formatDateKey(selected.date),
                            tab: selected.tab,
                            players: selected.players.length,
                        },
                    );
                    continue;
                }

                if (selected.players.length === 0) {
                    logger.warn(
                        `[job "${job.name}"] ${formatDateKey(selected.date)}: roster is empty — the sheet has no names yet, so the courts will be cleared`,
                        {
                            event: "empty-roster",
                            job: job.name,
                            date: formatDateKey(selected.date),
                            tab: selected.tab,
                        },
                    );
                }

                const plan = planSession(session, selected.players, job.session.courtCapacity, job.session.organizer);
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
