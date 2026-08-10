import { BrowserContext, Page } from "playwright";
import { ClientOptions, Booking, BookingFilters, BookingSession, PlayerInput, PlayerIdentifier } from "./types";
import { launchPersistentContext, closeBrowserContext } from "./browser";
import { manualLogin, restoreAuth } from "./auth";
import { navigateTo } from "./navigation";
import { authPath, courtReserveMyReservationsUrl, headless } from "./constants";
import { fileExists } from "./utils";
import { collectBookingSessions, getBookingsFound, filterBookings } from "./booking";

export class CourtReserveClient {
    private context?: BrowserContext;
    private page?: Page;
    private options: Required<ClientOptions>;

    constructor(options?: ClientOptions) {
        this.options = {
            headless: options?.headless ?? headless,
            authPath: options?.authPath ?? authPath,
            profileDir: options?.profileDir ?? "./my-profile",
            manualLogin: options?.manualLogin ?? false,
            debugPause: options?.debugPause ?? false,
        };
    }

    async init(): Promise<void> {
        this.context = await launchPersistentContext(this.options.headless);

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

    async addPlayerToBooking(booking: Booking, player: PlayerInput): Promise<void> {
        throw new Error("Not yet implemented — needs CourtReserve edit-page reverse-engineering.");
    }

    async removePlayerFromBooking(booking: Booking, player: PlayerIdentifier): Promise<void> {
        throw new Error("Not yet implemented — needs CourtReserve edit-page reverse-engineering.");
    }
}
