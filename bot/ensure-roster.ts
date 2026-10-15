import { CourtReserveClient, type Logger } from "../src";
import { loadConfig, enabledJobs, type BotConfig, type JobConfig } from "./config";
import { formatDateKey, type Roster, type RosterSet } from "./csv";
import { loadRoster, logRosterRead } from "./roster";
import { mappedName, type NameMap } from "./name-map";
import { groupBookingsIntoSessions, planSession, type SessionGroup, type SessionPlan } from "./session";

/**
 * Counters for everything a run touched or decided not to touch. The run's exit
 * code is reserved for config/data problems, so a run that added nobody — because
 * the session had no booking, or every player failed to search — still exits 0.
 * These are what make that visible: `run-end` emits them as one summary line.
 */
type RunTally = {
    /** Sessions a roster was matched to and planned. */
    sessions: number;
    /** Courts actually saved (never incremented in a dry run). */
    courtsEdited: number;
    added: number;
    removed: number;
    /**
     * Players the swap step skipped, in either direction: an add target that was
     * already seated, or a removal target that wasn't there. Both are no-ops.
     */
    skipped: number;
    /** Players the add/remove step could not resolve. */
    failed: number;
    /** A selected roster whose session has no booking yet. */
    noBooking: number;
    /** Jobs whose every roster date has passed. */
    noUpcoming: number;
    /** Empty rosters, which are authoritative and clear the courts. */
    emptyRoster: number;
    /** Rosters left for a later run because they aren't the next session. */
    deferred: number;
};

function emptyTally(): RunTally {
    return {
        sessions: 0,
        courtsEdited: 0,
        added: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        noBooking: 0,
        noUpcoming: 0,
        emptyRoster: 0,
        deferred: 0,
    };
}

/**
 * Whether a tally describes a run that needs a human. A deferred roster is
 * deliberately not one of these — it is the normal steady state of walking
 * forward through a month.
 */
function tallyNeedsAttention(tally: RunTally): boolean {
    return tally.failed > 0 || tally.noBooking > 0 || tally.noUpcoming > 0 || tally.emptyRoster > 0;
}

/**
 * Renders the tally as one human-readable clause list for the `run-end` line.
 * The attention-worthy counts are appended only when non-zero, so a clean run
 * stays a single short sentence.
 */
function tallySummary(tally: RunTally): string {
    const parts = [
        `${tally.sessions} session(s)`,
        `${tally.courtsEdited} court(s) edited`,
        `${tally.added} added`,
        `${tally.removed} removed`,
        `${tally.skipped} skipped`,
        `${tally.failed} failed`,
    ];
    if (tally.noBooking > 0) parts.push(`${tally.noBooking} session(s) with no booking`);
    if (tally.noUpcoming > 0) parts.push(`${tally.noUpcoming} job(s) with no upcoming session`);
    if (tally.emptyRoster > 0) parts.push(`${tally.emptyRoster} empty roster(s), courts cleared`);
    return parts.join(", ");
}

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

/**
 * Names the roster carries that the config maps to a different CourtReserve
 * member name. Logged before planning so a run that adds "Lee Zii Jia" can be
 * traced back to the roster's "Riley Poe" instead of looking like the wrong
 * person was booked on.
 */
function logNameMappings(logger: Logger, job: JobConfig, nameMap: NameMap | undefined, roster: Roster): void {
    const applied = roster.players
        .map((name) => ({ from: name, to: mappedName(nameMap, name) }))
        .filter(({ from, to }) => to !== from);
    if (applied.length === 0) return;

    logger.info(
        `[job "${job.name}"] ${applied.length} roster name(s) mapped to a CourtReserve member name: ${applied
            .map(({ from, to }) => `${from} -> ${to}`)
            .join(", ")}`,
        {
            event: "name-mapped",
            job: job.name,
            date: formatDateKey(roster.date),
            tab: roster.tab,
            mappings: applied,
        },
    );
}

function logSession(logger: Logger, session: SessionGroup, plan: SessionPlan, capacity: number): void {
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
        logger.warn(
            `  no space: ${plan.overflow
                .map((p) => `${p.name} (court ${p.court}, ${p.seated}/${capacity})`)
                .join(", ")}`,
            {
                event: "overflow",
                capacity,
                players: plan.overflow,
            },
        );
    }
    if (plan.waitlisted.length > 0) {
        // A court that is not booked yet holds one fewer player than `capacity`:
        // its own organizer occupies a seat without playing.
        const courtsNeeded = Math.ceil(plan.waitlisted.length / Math.max(1, capacity - 1));
        logger.warn(`  waitlisted: ${plan.waitlisted.join(", ")} — book ${courtsNeeded} more court(s)`, {
            event: "waitlist",
            names: plan.waitlisted,
            courts: courtsNeeded,
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
 * them; player-level outcomes never affect it. Because those outcomes can't
 * fail the run, `run-end` also logs a tally of everything the run did and
 * declined to do (see `RunTally`), at `warn` when any of it needs a human.
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

    // The exit code only reports config/data problems, so this tally is how a
    // run that did nothing (or could not add a player) still says so out loud.
    const tally = emptyTally();

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
        // `init()` belongs inside the `try` that owns the `finally`, not beside
        // it: it launches the browser before it can fail, so a failure here has
        // to close that browser too. Returning with it still open pinned the
        // process to a live Chromium — `main()` set its exit code and returned,
        // but the event loop never drained, so the unit sat idle until systemd
        // SIGTERMed it at TimeoutStartSec and the next timer fire queued up
        // behind it. `close()` is idempotent and tolerates a half-built client,
        // so this covers a partial init as well as a completed one.
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

        // A session can also drop mid-run, so this re-authenticates with the
        // configured credentials rather than only reporting the stale state.
        // A failed login throws; abort here so it is reported the same way as a
        // missing one instead of escaping as an unhandled rejection.
        try {
            if (!(await client.ensureLoggedIn())) {
                logger.error("ensure-roster: not logged in — aborting.", { event: "not-logged-in" });
                return false;
            }
        } catch (err) {
            logger.error(`ensure-roster: credential login failed: ${err instanceof Error ? err.message : err}`, {
                event: "not-logged-in",
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            });
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
                    tally.deferred += 1;
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
                    tally.noUpcoming += 1;
                    logger.info(`[job "${job.name}"]: no upcoming roster session — nothing to do`, {
                        event: "no-upcoming-roster",
                        job: job.name,
                        rosters: rosterSet.rosters.length,
                    });
                    continue;
                }

                const session = findSessionFor(sessions, selected);
                if (!session) {
                    tally.noBooking += 1;
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
                    tally.emptyRoster += 1;
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

                logNameMappings(logger, job, config.nameMap, selected);

                const plan = planSession(
                    session,
                    selected.players,
                    job.session.courtCapacity,
                    job.session.organizer,
                    config.nameMap,
                );
                logSession(logger, session, plan, job.session.courtCapacity);
                tally.sessions += 1;

                if (options.dryRun) continue;

                for (const court of plan.courts) {
                    if (court.add.length === 0 && court.remove.length === 0) continue;
                    const result = await client.swapPlayersOnBooking(
                        court.booking,
                        court.remove.map((name) => ({ name })),
                        court.add.map((name) => ({ name })),
                    );
                    tally.courtsEdited += 1;
                    tally.removed += result.removed.length;
                    tally.added += result.added.length;
                    tally.skipped += result.skipped.length;
                    tally.failed += result.failed.length;
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

    const level = tallyNeedsAttention(tally) ? "warn" : "info";
    logger[level](`ensure-roster done (ok=${ok}) — ${tallySummary(tally)}`, {
        event: "run-end",
        ok,
        ...tally,
    });
    return ok;
}
