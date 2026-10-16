import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

/**
 * Parses a booking card's date row, e.g. `Mon, Oct 19th, 6:30 PM - 8:30 PM`.
 *
 * The row carries no year, so `dayjs` fills in the reference date's. The
 * bookings list is always upcoming, so a month/day that has already gone by
 * against the reference belongs to *next* year: parsed as the current year it
 * lands in the past and every filter that compares dates silently misses it.
 * Only month/day is compared, never the time of day, so a booking later today
 * stays today rather than jumping a whole year.
 *
 * `reference` is a parameter so the rollover is testable without fake timers;
 * it defaults to now, which is what a real scrape needs.
 */
export function parseDatetime(datetimeText: string, reference: Date = new Date()): {
    dayOfWeek: string;
    startTime: Date;
    endTime: Date;
} {
    const cleaned = datetimeText.replace(/(\d+)(st|nd|rd|th)/, "$1");
    const [weekday, monthDay, times] = cleaned.split(",");
    const [startTime, endTime] = times.trim().split(" - ");
    const datePart = `${monthDay.trim()}`;
    let start = dayjs(`${datePart}, ${startTime}`, "MMM D, h:mm A");
    let end = dayjs(`${datePart}, ${endTime}`, "MMM D, h:mm A");

    const monthDayKey = (d: dayjs.Dayjs): number => d.month() * 100 + d.date();
    if (monthDayKey(start) < monthDayKey(dayjs(reference))) {
        start = start.add(1, "year");
        end = end.add(1, "year");
    }

    return {
        dayOfWeek: weekday.trim(),
        startTime: start.toDate(),
        endTime: end.toDate(),
    };
}

/**
 * Parses a booking card's court row into its location and the court number the
 * card is keyed on.
 *
 * Courts booked together are one card whose row lists every court
 * (`Mukilteo 8, Mukilteo 9, Mukilteo 10, Mukilteo 11, Mukilteo 12`). Splitting
 * that on spaces — which is right for the single-court `Mukilteo 10` shape —
 * yields the whole run as the "location" and only the last court as the number,
 * so the booking then fails every location comparison and drops out of its
 * session without a word. Splitting on the comma first keeps the location a
 * real location and keeps the whole span available via `courtNumbers`.
 *
 * `courtNumber` is the lowest court in the span so a multi-court reservation
 * still sorts where its earliest court belongs.
 */
export function parseCourt(locationAndCourt: string): {
    courtNumber: number;
    courtLocation: string;
    /** Every court in the card, in site order. Length > 1 means a multi-court reservation. */
    courtNumbers: number[];
} {
    const segments = locationAndCourt
        .split(",")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
        return { courtNumber: 0, courtLocation: "", courtNumbers: [] };
    }

    const [first] = segments;
    const courtNumbers = segments.map((segment) => Number(segment.split(" ").pop() ?? "0"));
    const courtNumber = Math.min(...courtNumbers);

    return { courtNumber, courtLocation: first.split(" ").slice(0, -1).join(" "), courtNumbers };
}

export function parsePlayers(playersText: string): string[] {
    if (!playersText) return [];
    return playersText.split(",").map((p) => p.trim());
}

export function parseBookingId(wrapperTestId: string): string {
    const match = /^booking-card-wrapper-(\d+)$/.exec(wrapperTestId.trim());
    if (!match) {
        throw new Error(
            `Could not parse booking id from wrapper testid: ${JSON.stringify(wrapperTestId)}`,
        );
    }
    return match[1];
}
