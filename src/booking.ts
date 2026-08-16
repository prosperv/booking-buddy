import { Locator, Page } from "playwright";
import { humanClick } from "./interactions";
import { parseDatetime, parseCourt, parsePlayers, parseBookingId } from "./parsers";
import { Booking, BookingFilters, BookingSession } from "./types";

/**
 * Pulls the leading integer out of CourtReserve's "N Booking Found" label.
 * Pure half of `getBookingsFound`, split out so it can be unit tested.
 */
export function parseBookingCount(text: string): number {
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : 0;
}

export async function getBookingsFound(page: Page): Promise<number> {
    const text = await page.getByText("Booking Found").innerText();
    return parseBookingCount(text);
}

/**
 * Assembles a `Booking` from the three raw row strings scraped off a card.
 * Pure half of `convertBookingCardToBookingSession`, split out so the
 * parser wiring can be unit tested without a browser.
 */
export function buildBooking(
    datetimeText: string,
    locationAndCourt: string,
    playersText: string,
    bookingId: string,
): Booking {
    const { dayOfWeek, startTime, endTime } = parseDatetime(datetimeText);
    const { courtNumber, courtLocation } = parseCourt(locationAndCourt);
    const players = parsePlayers(playersText);

    return { bookingId, dayOfWeek, startTime, endTime, courtNumber, courtLocation, players };
}

export async function convertBookingCardToBookingSession(
    bookingCard: Locator,
): Promise<BookingSession> {
    const wrapperTestId = (await bookingCard.getAttribute("data-testid")) ?? "";
    const datetimeText = (await bookingCard.getByTestId("row-date-and-times").textContent()) ?? "";
    const locationAndCourt = (await bookingCard.getByTestId("row-courts").textContent()) ?? "";
    const playersText = (await bookingCard.getByTestId("row-members").textContent()) ?? "";

    return {
        ...buildBooking(
            datetimeText,
            locationAndCourt,
            playersText,
            parseBookingId(wrapperTestId),
        ),
        page: bookingCard.page(),
    };
}

export async function collectBookingSessions(page: Page): Promise<BookingSession[]> {
    const bookingCard = page.getByTestId(/^booking-card-wrapper-\d+$/);
    const count = await bookingCard.count();
    const bookingSessions: BookingSession[] = [];

    for (let i = 0; i < count; i += 1) {
        bookingSessions.push(await convertBookingCardToBookingSession(bookingCard.nth(i)));
    }

    return bookingSessions;
}

/**
 * Normalizes a `BookingFilters.date` into a local-time Date.
 *
 * A bare `yyyy-mm-dd` string is parsed as LOCAL midnight rather than letting
 * `new Date()` treat it as UTC midnight, which would land on the previous day
 * in any negative-offset timezone (the club is US Pacific) and silently filter
 * out every booking. Throws on unparseable input instead of returning nothing.
 */
export function parseFilterDate(date: string | Date): Date {
    if (date instanceof Date) {
        if (Number.isNaN(date.getTime())) {
            throw new Error("Invalid date filter: received an invalid Date object.");
        }
        return date;
    }

    const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    const parsed = isoDateOnly
        ? new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]))
        : new Date(date);

    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date filter: ${JSON.stringify(date)} could not be parsed.`);
    }

    return parsed;
}

/**
 * Generic over `Booking` so it can be tested with plain booking objects,
 * while callers still get `BookingSession[]` back when they pass sessions in.
 */
export function filterBookings<T extends Booking>(bookings: T[], filters?: BookingFilters): T[] {
    if (!filters) return bookings;

    const filterDate = filters.date === undefined ? undefined : parseFilterDate(filters.date);

    return bookings.filter((b) => {
        if (filters.weekday && b.dayOfWeek.toLowerCase() !== filters.weekday.toLowerCase()) {
            return false;
        }
        if (filterDate) {
            if (
                b.startTime.getFullYear() !== filterDate.getFullYear() ||
                b.startTime.getMonth() !== filterDate.getMonth() ||
                b.startTime.getDate() !== filterDate.getDate()
            ) {
                return false;
            }
        }
        if (filters.startTime) {
            const bStart = `${String(b.startTime.getHours()).padStart(2, "0")}:${String(b.startTime.getMinutes()).padStart(2, "0")}`;
            if (bStart !== filters.startTime) {
                return false;
            }
        }
        return true;
    });
}

export async function editBooking(page: Page): Promise<void> {
    const editReservationButton = page.getByTestId("details-btn");
    await humanClick(editReservationButton);
}
