import { Locator, Page } from "playwright";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { pauseForAction } from "./utils";
import { BookingFilters, BookingSession } from "./types";

dayjs.extend(customParseFormat);

export async function getBookingsFound(page: Page): Promise<number> {
    const text = await page.getByText("Booking Found").innerText();
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : 0;
}

export async function convertBookingCardToBookingSession(
    bookingCard: Locator,
): Promise<BookingSession> {
    const datetimeText = (await bookingCard.getByTestId("row-date-and-times").textContent()) ?? "";
    const cleaned = datetimeText.replace(/(\d+)(st|nd|rd|th)/, "$1");
    const [weekday, monthDay, times] = cleaned.split(",");
    const datePart = `${weekday.trim()}, ${monthDay.trim()}`;
    const [startTime, endTime] = times.trim().split(" - ");
    const startString = `${datePart}, ${startTime}`;
    const endString = `${datePart}, ${endTime}`;
    const start = dayjs(startString, "ddd, MMM D, h:mm A");
    const end = dayjs(endString, "ddd, MMM D, h:mm A");
    const locationAndCourt = (await bookingCard.getByTestId("row-courts").textContent()) ?? "";
    const courtNumber = Number(locationAndCourt.split(" ").pop() ?? "0");
    const location = locationAndCourt.split(" ").slice(0, -1).join(" ");
    const playersText = (await bookingCard.getByTestId("row-members").textContent()) ?? "";
    const players = playersText ? playersText.split(",").map((player) => player.trim()) : [];

    return {
        dayOfWeek: weekday.trim(),
        startTime: start.toDate(),
        endTime: end.toDate(),
        courtNumber,
        courtLocation: location,
        players,
        page: bookingCard.page(),
    };
}

export async function collectBookingSessions(page: Page): Promise<BookingSession[]> {
    const bookingCard = page.getByTestId("booking-card");
    const count = await bookingCard.count();
    const bookingSessions: BookingSession[] = [];

    for (let i = 0; i < count; i += 1) {
        bookingSessions.push(await convertBookingCardToBookingSession(bookingCard.nth(i)));
    }

    return bookingSessions;
}

export function filterBookings(bookings: BookingSession[], filters?: BookingFilters): BookingSession[] {
    if (!filters) return bookings;

    return bookings.filter((b) => {
        if (filters.weekday && b.dayOfWeek.toLowerCase() !== filters.weekday.toLowerCase()) {
            return false;
        }
        if (filters.date) {
            const filterDate = typeof filters.date === "string" ? new Date(filters.date) : filters.date;
            const bDate = new Date(b.startTime);
            if (
                bDate.getFullYear() !== filterDate.getFullYear() ||
                bDate.getMonth() !== filterDate.getMonth() ||
                bDate.getDate() !== filterDate.getDate()
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
    await editReservationButton.scrollIntoViewIfNeeded();
    await editReservationButton.hover();

    const box = await editReservationButton.boundingBox();
    if (!box) {
        throw new Error("Could not determine edit button position.");
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 10,
    });
    await pauseForAction();
    await page.mouse.down();
    await page.mouse.up();
}
