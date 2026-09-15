import { BrowserContext, Locator, Page } from "playwright";
import {
    AddPlayersResult,
    Booking,
    BookingFilters,
    BookingSession,
    ClientOptions,
    PlayerAddOutcome,
    PlayerInput,
    PlayerRemoveOutcome,
    RemovePlayersResult,
    SwapPlayerResult,
} from "./types";
import { launchPersistentContext, closeBrowserContext } from "./browser";
import { manualLogin, restoreAuth, saveAuthIfLoggedIn } from "./auth";
import { navigateTo } from "./navigation";
import { authPath, courtReserveMyReservationsUrl, headless, profileDir } from "./constants";
import { fileExists, pauseForAction } from "./utils";
import { collectBookingSessions, filterBookings } from "./booking";
import { isLoggedIn, loginWithCredentials } from "./login";
import { createLogger, defaultLogFile, resolveLogDir, type Logger } from "./logger";
import {
    closeModal,
    confirmAddPlayer,
    matchPlayerOption,
    normalizePlayerName,
    openEditReservationModal,
    openReservationDetail,
    readDetailPlayers,
    readModalPlayers,
    readPlayerOptions,
    removeMemberFromModal,
    saveReservation,
    searchNameError,
    selectPlayerOption,
    typePlayerSearch,
    verifyPlayerAdded,
} from "./players";

type RemoveLoopResult = {
    removed: string[];
    skipped: PlayerRemoveOutcome[];
    failed: PlayerRemoveOutcome[];
};

/**
 * Removes each requested player from the edit modal's pending roster. Outcomes
 * are accumulated into `result` rather than returned, so the caller can reuse
 * the same accumulator across a remove-then-add swap without tracking return
 * values per player.
 */
async function runRemoveLoop(
    modal: Locator,
    players: PlayerInput[],
    result: RemoveLoopResult,
    logger: Logger,
): Promise<void> {
    for (const { name } of players) {
        const outcome = await removeMemberFromModal(modal, name);
        await pauseForAction();

        if (outcome.status === "removed") {
            result.removed.push(outcome.name);
            logger.info("player removed", { event: "player-removed", name: outcome.name });
        } else if (outcome.status === "not-found") {
            result.skipped.push({ name, reason: "not-in-roster" });
            logger.info("player not in roster", { event: "player-skip", name, reason: "not-in-roster" });
        } else {
            result.failed.push({ name: outcome.name, reason: "not-removable" });
            logger.warn("player not removable", {
                event: "player-failed",
                name: outcome.name,
                reason: "not-removable",
            });
        }
    }
}

type AddLoopResult = {
    added: string[];
    skipped: PlayerAddOutcome[];
    failed: PlayerAddOutcome[];
};

/**
 * Adds each requested player to the edit modal's pending roster via the member
 * search. `roster` is the source of truth for the "already-added" check; it is
 * mutated in place as players are added so duplicates within the request are
 * caught. The caller must seed it with the current (post-removal, for a swap)
 * roster.
 */
async function runAddLoop(
    page: Page,
    modal: Locator,
    players: PlayerInput[],
    roster: string[],
    result: AddLoopResult,
    logger: Logger,
): Promise<void> {
    for (const { name } of players) {
        if (roster.some((existing) => normalizePlayerName(existing) === normalizePlayerName(name))) {
            result.skipped.push({ name, reason: "already-added" });
            logger.info("player already added", { event: "player-skip", name, reason: "already-added" });
            continue;
        }

        const tooShort = searchNameError(name);
        if (tooShort) {
            result.failed.push({ name, reason: "query-too-short" });
            logger.warn("player query too short", {
                event: "player-failed",
                name,
                reason: "query-too-short",
            });
            continue;
        }

        await typePlayerSearch(modal, name);
        await pauseForAction();

        const options = await readPlayerOptions(page);
        const match = matchPlayerOption(options, name);

        if (match.status === "exact" || match.status === "unique") {
            await selectPlayerOption(page, match.index);
            await pauseForAction();
            await confirmAddPlayer(page);

            if (await verifyPlayerAdded(modal, match.name)) {
                result.added.push(match.name);
                roster.push(match.name);
                logger.info("player added", { event: "player-added", name: match.name });
            } else {
                // Report the requested `name` (not the resolved `match.name`) so
                // this failure lines up with the other add-failure outcomes
                // below, which all key off the name the caller asked for.
                result.failed.push({ name, reason: "not-added" });
                logger.warn("player not added", { event: "player-failed", name, reason: "not-added" });
            }
        } else if (match.status === "ambiguous") {
            result.failed.push({ name, reason: "ambiguous", candidates: match.candidates });
            logger.warn("player ambiguous", {
                event: "player-failed",
                name,
                reason: "ambiguous",
                candidates: match.candidates,
            });
        } else {
            result.failed.push({ name, reason: "not-found", candidates: match.candidates });
            logger.warn("player not found", {
                event: "player-failed",
                name,
                reason: "not-found",
                candidates: match.candidates,
            });
        }
    }
}

type ResolvedClientOptions = {
    headless: boolean;
    authPath: string;
    profileDir: string;
    manualLogin: boolean;
    debugPause: boolean;
};

export class CourtReserveClient {
    private context?: BrowserContext;
    private page?: Page;
    private options: ResolvedClientOptions;
    private logger: Logger;
    private initialized = false;
    private closing = false;
    private sigintHandler?: () => void;
    private sigtermHandler?: () => void;
    private beforeExitHandler?: () => void;

    constructor(options?: ClientOptions) {
        this.options = {
            headless: options?.headless ?? headless,
            authPath: options?.authPath ?? authPath,
            profileDir: options?.profileDir ?? profileDir,
            manualLogin: options?.manualLogin ?? false,
            debugPause: options?.debugPause ?? false,
        };
        this.logger = this.buildLogger(options?.logPath, options?.logLevel);
    }

    private buildLogger(logPath: string | false | undefined, logLevel?: string): Logger {
        if (logPath === false) {
            return createLogger({ level: logLevel });
        }
        const dir = resolveLogDir(logPath);
        return createLogger({ filePath: defaultLogFile(dir, "booking-buddy"), level: logLevel });
    }

    async init(): Promise<void> {
        this.initialized = true;
        this.logger.info("client init", {
            event: "init",
            headless: this.options.headless,
            authPath: this.options.authPath,
            profileDir: this.options.profileDir,
        });
        this.context = await launchPersistentContext(this.options.headless, this.options.profileDir);
        this.registerShutdownHandlers();

        const hasSavedAuth = await fileExists(this.options.authPath);
        if (this.options.manualLogin || !hasSavedAuth) {
            this.logger.info("manual login", { event: "manual-login" });
            await manualLogin(this.context, this.options.authPath);
        } else {
            this.logger.info("restoring saved auth", { event: "restore-auth" });
            await restoreAuth(this.context, this.options.authPath);
        }

        this.page = await this.context.newPage();
        await navigateTo(this.page, courtReserveMyReservationsUrl, "CourtReserve My Reservations");
        this.logger.info("client ready", { event: "ready", url: courtReserveMyReservationsUrl });

        if (this.options.debugPause) {
            await this.page.pause();
        }
    }

    async close(): Promise<void> {
        if (this.closing) {
            return;
        }
        this.closing = true;
        this.removeShutdownHandlers();
        try {
            if (this.context) {
                await saveAuthIfLoggedIn(this.context, this.page, this.options.authPath).catch(
                    () => false,
                );
                await closeBrowserContext(this.context);
            }
        } finally {
            this.context = undefined;
            this.page = undefined;
            this.closing = false;
            if (this.initialized) {
                this.logger.info("client closed", { event: "close" });
                this.logger.flush();
            }
        }
    }

    /**
     * Attaches process-level shutdown handlers so a running browser is closed
     * gracefully rather than orphaned. SIGINT/SIGTERM close the context and
     * re-exit with the conventional 128+signal code; `beforeExit` closes the
     * context when the event loop drains naturally.
     */
    private registerShutdownHandlers(): void {
        if (this.sigintHandler || this.sigtermHandler || this.beforeExitHandler) {
            return;
        }

        const gracefulExit = async (code: number) => {
            await this.close();
            process.exit(code);
        };

        this.sigintHandler = () => {
            void gracefulExit(130);
        };
        this.sigtermHandler = () => {
            void gracefulExit(143);
        };
        this.beforeExitHandler = () => {
            if (this.context && !this.closing) {
                void this.close();
            }
        };

        process.once("SIGINT", this.sigintHandler);
        process.once("SIGTERM", this.sigtermHandler);
        process.on("beforeExit", this.beforeExitHandler);
    }

    private removeShutdownHandlers(): void {
        if (this.sigintHandler) {
            process.removeListener("SIGINT", this.sigintHandler);
            this.sigintHandler = undefined;
        }
        if (this.sigtermHandler) {
            process.removeListener("SIGTERM", this.sigtermHandler);
            this.sigtermHandler = undefined;
        }
        if (this.beforeExitHandler) {
            process.removeListener("beforeExit", this.beforeExitHandler);
            this.beforeExitHandler = undefined;
        }
    }

    async getCurrentBookings(filters?: BookingFilters): Promise<Booking[]> {
        if (!this.page) {
            throw new Error("Client not initialized. Call init() first.");
        }

        const bookingSessions = await collectBookingSessions(this.page);
        const filtered = filters ? filterBookings(bookingSessions, filters) : bookingSessions;
        return filtered.map((session) => {
            const { page: _, ...booking } = session;
            return booking;
        });
    }

    /**
     * Whether the current page is on the authenticated bookings list. Callers
     * (e.g. a bot) can use this after `init()` to detect a stale or failed
     * session restore and decide to re-authenticate.
     */
    async isLoggedIn(): Promise<boolean> {
        if (!this.page) {
            throw new Error("Client not initialized. Call init() first.");
        }
        return isLoggedIn(this.page);
    }

    /**
     * Logs in with email/password credentials, then refreshes the saved auth
     * state and re-navigates to the bookings list so subsequent calls work.
     * Credential handling is left to the caller; the client only performs the
     * login.
     */
    async loginWithCredentials(username: string, password: string): Promise<void> {
        if (!this.page || !this.context) {
            throw new Error("Client not initialized. Call init() first.");
        }

        await loginWithCredentials(this.page, username, password);
        await this.context.storageState({ path: this.options.authPath });
        await navigateTo(this.page, courtReserveMyReservationsUrl, "CourtReserve My Reservations");
        this.logger.info("logged in with credentials", { event: "login-credentials" });
    }

    getPlayersFromBooking(booking: Booking): string[] {
        return booking.players;
    }

    /**
     * Opens the edit-reservation modal on a throwaway page and runs `run`
     * inside it. `run` reports whether the pending roster changed; when it did
     * the modal is saved once and the persisted detail roster is returned,
     * otherwise the modal is closed unsaved and `booking.players` is returned.
     * The throwaway page is always closed in `finally`, leaving `this.page` (the
     * bookings list) untouched for later `getCurrentBookings()` calls.
     */
    private async withEditModal(
        booking: Booking,
        run: (page: Page, modal: Locator) => Promise<boolean>,
    ): Promise<{ saved: boolean; players: string[] }> {
        if (!booking.bookingId) {
            throw new Error("Booking is missing bookingId; cannot navigate to its detail page.");
        }
        if (!this.context) {
            throw new Error("Client not initialized. Call init() first.");
        }

        const page = await this.context.newPage();
        try {
            await openReservationDetail(page, booking.bookingId);
            const modal = await openEditReservationModal(page);
            await pauseForAction();
            this.logger.info("edit modal opened", { event: "modal-opened", bookingId: booking.bookingId });

            const changed = await run(page, modal);

            if (changed) {
                await saveReservation(page);
                await openReservationDetail(page, booking.bookingId);
                const players = await readDetailPlayers(page);
                this.logger.info("reservation saved", {
                    event: "modal-saved",
                    bookingId: booking.bookingId,
                    players: players.length,
                });
                return { saved: true, players };
            }

            await closeModal(page);
            this.logger.info("edit modal closed unsaved", {
                event: "modal-closed",
                bookingId: booking.bookingId,
            });
            return { saved: false, players: booking.players };
        } finally {
            await page.close().catch(() => undefined);
        }
    }

    async addPlayerToBooking(booking: Booking, player: PlayerInput): Promise<AddPlayersResult> {
        return this.addPlayersToBooking(booking, [player]);
    }

    /**
     * Adds players to a booking through the edit-reservation modal.
     *
     * Per-player problems (already added, not found, ambiguous, too short a
     * search) are reported in the result rather than thrown. Structural
     * failures — no session, missing bookingId, page/modal not loading, or a
     * failed save — still throw.
     */
    async addPlayersToBooking(booking: Booking, players: PlayerInput[]): Promise<AddPlayersResult> {
        const result: AddPlayersResult = {
            players: [],
            added: [],
            skipped: [],
            failed: [],
            saved: false,
        };

        const { saved, players: finalPlayers } = await this.withEditModal(booking, async (page, modal) => {
            const roster = await readModalPlayers(modal);
            await runAddLoop(page, modal, players, roster, result, this.logger);
            return result.added.length > 0;
        });

        result.saved = saved;
        result.players = finalPlayers;
        return result;
    }

    async removePlayerFromBooking(booking: Booking, player: PlayerInput): Promise<RemovePlayersResult> {
        return this.removePlayersFromBooking(booking, [player]);
    }

    /**
     * Removes players from a booking through the edit-reservation modal.
     *
     * Per-player problems (not in the roster, or not removable — e.g. the
     * reservation owner) are reported in the result rather than thrown.
     * Structural failures — no session, missing bookingId, page/modal not
     * loading, or a failed save — still throw.
     */
    async removePlayersFromBooking(booking: Booking, players: PlayerInput[]): Promise<RemovePlayersResult> {
        const result: RemovePlayersResult = {
            players: [],
            removed: [],
            skipped: [],
            failed: [],
            saved: false,
        };

        const { saved, players: finalPlayers } = await this.withEditModal(booking, async (_page, modal) => {
            await runRemoveLoop(modal, players, result, this.logger);
            return result.removed.length > 0;
        });

        result.saved = saved;
        result.players = finalPlayers;
        return result;
    }

    /**
     * Swaps players on a booking in a single edit-reservation session: removes
     * `playersToRemove`, then adds `playersToAdd`, then saves once.
     *
     * Per-player problems are reported in the result rather than thrown, in the
     * same shape as the add/remove methods. Structural failures — no session,
     * missing bookingId, page/modal not loading, or a failed save — still throw.
     */
    async swapPlayersOnBooking(
        booking: Booking,
        playersToRemove: PlayerInput[],
        playersToAdd: PlayerInput[],
    ): Promise<SwapPlayerResult> {
        const removeLoop: RemoveLoopResult = { removed: [], skipped: [], failed: [] };
        const addLoop: AddLoopResult = { added: [], skipped: [], failed: [] };

        const { saved, players: finalPlayers } = await this.withEditModal(booking, async (page, modal) => {
            await runRemoveLoop(modal, playersToRemove, removeLoop, this.logger);

            // Seed the add loop from the post-removal roster. Using the opening
            // snapshot here would report a just-removed player as already-added.
            const roster = await readModalPlayers(modal);
            await runAddLoop(page, modal, playersToAdd, roster, addLoop, this.logger);

            return removeLoop.removed.length > 0 || addLoop.added.length > 0;
        });

        return {
            players: finalPlayers,
            removed: removeLoop.removed,
            added: addLoop.added,
            skipped: [...removeLoop.skipped, ...addLoop.skipped],
            failed: [...removeLoop.failed, ...addLoop.failed],
            saved,
        };
    }
}
