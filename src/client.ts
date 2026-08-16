import { BrowserContext, Page } from "playwright";
import {
    AddPlayersResult,
    Booking,
    BookingFilters,
    BookingSession,
    ClientOptions,
    PlayerInput,
    PlayerIdentifier,
} from "./types";
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
    saveReservation,
    searchNameError,
    selectPlayerOption,
    typePlayerSearch,
} from "./players";

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

    async addPlayerToBooking(booking: Booking, player: PlayerInput): Promise<AddPlayersResult> {
        return this.addPlayersToBooking(booking, [player]);
    }

    /**
     * Adds players to a booking through the edit-reservation modal. Runs on a
     * throwaway page so `this.page` (the bookings list) is left untouched for
     * later `getCurrentBookings()` calls.
     *
     * Per-player problems (already added, not found, ambiguous, too short a
     * search) are reported in the result rather than thrown. Structural
     * failures — no session, missing bookingId, page/modal not loading, or a
     * failed save — still throw.
     */
    async addPlayersToBooking(booking: Booking, players: PlayerInput[]): Promise<AddPlayersResult> {
        if (!booking.bookingId) {
            throw new Error("Booking is missing bookingId; cannot navigate to its detail page.");
        }
        if (!this.context) {
            throw new Error("Client not initialized. Call init() first.");
        }

        const result: AddPlayersResult = {
            players: [],
            added: [],
            skipped: [],
            failed: [],
            saved: false,
        };

        const page = await this.context.newPage();
        try {
            await openReservationDetail(page, booking.bookingId);
            const modal = await openEditReservationModal(page);
            await pauseForAction();

            const roster = await readModalPlayers(modal);

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

            if (result.added.length > 0) {
                await saveReservation(page);
                result.saved = true;
                result.players = await readDetailPlayers(page);
            } else {
                await closeModal(page);
                result.players = booking.players;
            }
        } finally {
            await page.close().catch(() => undefined);
        }

        return result;
    }

    async removePlayerFromBooking(booking: Booking, player: PlayerIdentifier): Promise<void> {
        throw new Error("Not yet implemented — needs CourtReserve edit-page reverse-engineering.");
    }
}
