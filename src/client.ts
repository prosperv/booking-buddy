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
    ReserveCourtOptions,
    ReserveCourtResult,
    ReservedSlot,
    SwapPlayerResult,
} from "./types";
import { CourtLocation } from "./constants";
import { launchPersistentContext, closeBrowserContext } from "./browser";
import { manualLogin, restoreAuth } from "./auth";
import { navigateTo } from "./navigation";
import { authPath, courtReserveMyReservationsUrl, headless, profileDir } from "./constants";
import { fileExists, pauseForAction } from "./utils";
import { collectBookingSessions, filterBookings } from "./booking";
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
} from "./players";
import {
    checkWaiver,
    combineDateTime,
    findCandidateCourts,
    openCreateModal,
    openSchedule,
    parseCourtLabel,
    payReservation,
    readFreeCells,
    readReservedSlots,
    saveNewReservation,
    selectDuration,
} from "./reserve";

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
async function runRemoveLoop(modal: Locator, players: PlayerInput[], result: RemoveLoopResult): Promise<void> {
    for (const { name } of players) {
        const outcome = await removeMemberFromModal(modal, name);
        await pauseForAction();

        if (outcome.status === "removed") {
            result.removed.push(outcome.name);
        } else if (outcome.status === "not-found") {
            result.skipped.push({ name, reason: "not-in-roster" });
        } else {
            result.failed.push({ name: outcome.name, reason: "not-removable" });
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
): Promise<void> {
    for (const { name } of players) {
        if (roster.some((existing) => normalizePlayerName(existing) === normalizePlayerName(name))) {
            result.skipped.push({ name, reason: "already-added" });
            continue;
        }

        const tooShort = searchNameError(name);
        if (tooShort) {
            result.failed.push({ name, reason: "query-too-short" });
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
            await modal
                .locator('[data-testid="player-fullname"]')
                .filter({ hasText: match.name })
                .first()
                .waitFor({ state: "attached" });

            result.added.push(match.name);
            roster.push(match.name);
        } else if (match.status === "ambiguous") {
            result.failed.push({ name, reason: "ambiguous", candidates: match.candidates });
        } else {
            result.failed.push({ name, reason: "not-found", candidates: match.candidates });
        }
    }
}

export class CourtReserveClient {
    private context?: BrowserContext;
    private page?: Page;
    private options: Required<ClientOptions>;

    constructor(options?: ClientOptions) {
        this.options = {
            headless: options?.headless ?? headless,
            authPath: options?.authPath ?? authPath,
            profileDir: options?.profileDir ?? profileDir,
            manualLogin: options?.manualLogin ?? false,
            debugPause: options?.debugPause ?? false,
        };
    }

    async init(): Promise<void> {
        this.context = await launchPersistentContext(this.options.headless, this.options.profileDir);

        const hasSavedAuth = await fileExists(this.options.authPath);
        if (this.options.manualLogin || !hasSavedAuth) {
            await manualLogin(this.context, this.options.authPath);
        } else {
            await restoreAuth(this.context, this.options.authPath);
        }

        this.page = await this.context.newPage();
        await navigateTo(this.page, courtReserveMyReservationsUrl, "CourtReserve My Reservations");

        if (this.options.debugPause) {
            await this.page.pause();
        }
    }

    async close(): Promise<void> {
        if (this.context) {
            await closeBrowserContext(this.context);
            this.context = undefined;
            this.page = undefined;
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

            const changed = await run(page, modal);

            if (changed) {
                await saveReservation(page);
                await openReservationDetail(page, booking.bookingId);
                return { saved: true, players: await readDetailPlayers(page) };
            }

            await closeModal(page);
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
            await runAddLoop(page, modal, players, roster, result);
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
            await runRemoveLoop(modal, players, result);
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
            await runRemoveLoop(modal, playersToRemove, removeLoop);

            // Seed the add loop from the post-removal roster. Using the opening
            // snapshot here would report a just-removed player as already-added.
            const roster = await readModalPlayers(modal);
            await runAddLoop(page, modal, playersToAdd, roster, addLoop);

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

    async getReservedSlots(location: CourtLocation, date: string | Date): Promise<ReservedSlot[]> {
        if (!this.context) {
            throw new Error("Client not initialized. Call init() first.");
        }

        const page = await this.context.newPage();
        try {
            await openSchedule(page, location, date);
            return await readReservedSlots(page);
        } finally {
            await page.close().catch(() => undefined);
        }
    }

    async attemptReserveCourt(options: ReserveCourtOptions): Promise<ReserveCourtResult> {
        if (!this.context) {
            throw new Error("Client not initialized. Call init() first.");
        }

        const page = await this.context.newPage();
        try {
            const start = combineDateTime(options.date, options.startTime);

            await openSchedule(page, options.location, options.date);
            const freeCells = await readFreeCells(page);

            const candidates = findCandidateCourts(
                freeCells,
                options.preferCourts ?? [],
                start,
                options.durationMinutes,
            );

            if (candidates.length === 0) {
                throw new Error(
                    `No courts available for ${options.startTime} (${options.durationMinutes} min) on ${options.date}`,
                );
            }

            // Try courts in order (preferred first, then fallback)
            let lastError: Error | undefined;
            for (const courtLabel of candidates) {
                try {
                    const btn = page.locator('[data-testid="reserveBtn"]', {
                        has: page.locator(`[data-courtlabel="${courtLabel}"]`),
                    }).filter({ hasText: `Reserve ` }).first();

                    // More precise: find the button with matching courtlabel and start time
                    const allBtns = page.locator(`button[data-testid="reserveBtn"][courtlabel="${courtLabel}"]`);
                    const btnCount = await allBtns.count();
                    let targetBtn = allBtns.first();
                    for (let i = 0; i < btnCount; i++) {
                        const b = allBtns.nth(i);
                        const startAttr = await b.getAttribute("start");
                        if (startAttr && new Date(startAttr).getTime() === start.getTime()) {
                            targetBtn = b;
                            break;
                        }
                    }

                    const modal = await openCreateModal(page, targetBtn);
                    await selectDuration(page, options.durationMinutes);

                    // Add players
                    const addResult = { added: [] as string[], skipped: [] as PlayerAddOutcome[], failed: [] as PlayerAddOutcome[] };
                    const rosterNames = await modal
                        .locator('[data-testid="member-table"] [data-testid="player-fullname"]')
                        .allTextContents()
                        .then((names) => names.map((n) => n.replace(/\s+/g, " ").trim()));
                    const roster = [...rosterNames];

                    for (const { name } of options.players) {
                        if (roster.some((existing) => normalizePlayerName(existing) === normalizePlayerName(name))) {
                            addResult.skipped.push({ name, reason: "already-added" });
                            continue;
                        }

                        const tooShort = searchNameError(name);
                        if (tooShort) {
                            addResult.failed.push({ name, reason: "query-too-short" });
                            continue;
                        }

                        await typePlayerSearch(modal, name);
                        await pauseForAction();

                        const playerOptions = await readPlayerOptions(page);
                        const match = matchPlayerOption(playerOptions, name);

                        if (match.status === "exact" || match.status === "unique") {
                            await selectPlayerOption(page, match.index);
                            await pauseForAction();
                            await confirmAddPlayer(page);
                            await modal
                                .locator('[data-testid="player-fullname"]')
                                .filter({ hasText: match.name })
                                .first()
                                .waitFor({ state: "attached" });

                            addResult.added.push(match.name);
                            roster.push(match.name);
                        } else if (match.status === "ambiguous") {
                            addResult.failed.push({ name, reason: "ambiguous", candidates: match.candidates });
                        } else {
                            addResult.failed.push({ name, reason: "not-found", candidates: match.candidates });
                        }
                    }

                    await checkWaiver(modal);
                    await saveNewReservation(page);
                    const totalDue = await payReservation(page);

                    const { courtLocation, courtNumber } = parseCourtLabel(courtLabel);
                    const endTime = new Date(start.getTime() + options.durationMinutes * 60_000);

                    return {
                        reserved: true,
                        paid: true,
                        courtLabel,
                        courtNumber,
                        startTime: start,
                        endTime,
                        totalDue,
                        players: roster,
                        added: addResult.added,
                        skipped: addResult.skipped,
                        failed: addResult.failed,
                    };
                } catch (err) {
                    lastError = err instanceof Error ? err : new Error(String(err));
                    // Try next court
                    continue;
                }
            }

            throw lastError ?? new Error("No courts could be reserved");
        } finally {
            await page.close().catch(() => undefined);
        }
    }
}
