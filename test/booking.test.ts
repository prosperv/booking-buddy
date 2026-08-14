import { describe, expect, it } from "vitest";
import { buildBooking, filterBookings, parseBookingCount } from "../src/booking";
import type { Booking } from "../src/types";

/**
 * These tests rely on the TZ pinned to America/Los_Angeles in vitest.config.ts.
 * Several date paths below are UTC-offset sensitive and would pass for the
 * wrong reason on a UTC runner.
 */

function makeBooking(overrides: Partial<Booking> = {}): Booking {
    return {
        dayOfWeek: "Mon",
        startTime: new Date(2026, 7, 10, 18, 0),
        endTime: new Date(2026, 7, 10, 20, 0),
        courtNumber: 3,
        courtLocation: "Bellevue Court",
        players: ["Prosper Van"],
        ...overrides,
    };
}

describe("parseBookingCount", () => {
    it("reads the count out of the label", () => {
        expect(parseBookingCount("1 Booking Found")).toBe(1);
        expect(parseBookingCount("12 Bookings Found")).toBe(12);
    });

    it("returns 0 when the text has no digits", () => {
        expect(parseBookingCount("No bookings found")).toBe(0);
        expect(parseBookingCount("")).toBe(0);
    });

    it("takes the first digit run anywhere in the text", () => {
        expect(parseBookingCount("Showing 2 of 5 Bookings Found")).toBe(2);
    });
});

describe("buildBooking", () => {
    it("assembles a booking from the three raw row strings", () => {
        const booking = buildBooking(
            "Tue, Sep 8th,  9:00 PM - 10:00 PM",
            "Mukilteo 10",
            "Prosper Van, Peter Nguyen",
        );

        expect(booking.dayOfWeek).toBe("Tue");
        expect(booking.startTime.getHours()).toBe(21);
        expect(booking.endTime.getHours()).toBe(22);
        expect(booking.courtNumber).toBe(10);
        expect(booking.courtLocation).toBe("Mukilteo");
        expect(booking.players).toEqual(["Prosper Van", "Peter Nguyen"]);
    });

    it("does not include a page handle", () => {
        const booking = buildBooking("Tue, Sep 8th,  9:00 PM - 10:00 PM", "Mukilteo 10", "A");

        expect(booking).not.toHaveProperty("page");
    });
});

describe("filterBookings", () => {
    it("returns the input untouched when filters are omitted", () => {
        const bookings = [makeBooking()];

        expect(filterBookings(bookings)).toBe(bookings);
    });

    it("returns every booking for an empty filter object", () => {
        const bookings = [makeBooking(), makeBooking({ dayOfWeek: "Tue" })];

        expect(filterBookings(bookings, {})).toHaveLength(2);
    });

    it("returns an empty array when given no bookings", () => {
        expect(filterBookings([], { weekday: "Mon" })).toEqual([]);
    });

    describe("weekday", () => {
        it("matches case-insensitively", () => {
            const bookings = [makeBooking({ dayOfWeek: "Mon" })];

            expect(filterBookings(bookings, { weekday: "mon" })).toHaveLength(1);
            expect(filterBookings(bookings, { weekday: "MON" })).toHaveLength(1);
        });

        it("excludes non-matching weekdays", () => {
            const bookings = [makeBooking({ dayOfWeek: "Mon" })];

            expect(filterBookings(bookings, { weekday: "Tue" })).toHaveLength(0);
        });

        it("requires the site's abbreviated form, so full names match nothing", () => {
            // Documents a sharp edge: the site renders "Mon", so "Monday" silently
            // filters everything out rather than erroring.
            const bookings = [makeBooking({ dayOfWeek: "Mon" })];

            expect(filterBookings(bookings, { weekday: "Monday" })).toHaveLength(0);
        });
    });

    describe("date", () => {
        it("matches a Date object on the same calendar day", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { date: new Date(2026, 7, 10, 9, 30) })).toHaveLength(1);
        });

        it("excludes a Date object on a different day", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { date: new Date(2026, 7, 11) })).toHaveLength(0);
        });

        it("matches a locale-style date string", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { date: "Aug 10 2026" })).toHaveLength(1);
        });

        it("matches an ISO yyyy-mm-dd string", () => {
            // Regression test for the UTC-parsing off-by-one-day bug:
            // `new Date("2026-08-10")` is UTC midnight, which is Aug 9 in
            // US Pacific, so this used to return 0 matches.
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { date: "2026-08-10" })).toHaveLength(1);
        });

        it("excludes an ISO string for a different day", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { date: "2026-08-11" })).toHaveLength(0);
        });

        it("matches a full ISO timestamp on the same local day", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { date: "2026-08-10T18:00:00" })).toHaveLength(1);
        });

        it("throws on an unparseable date string", () => {
            const bookings = [makeBooking()];

            expect(() => filterBookings(bookings, { date: "nonsense" })).toThrow(/Invalid date/i);
        });
    });

    describe("startTime", () => {
        it("matches zero-padded 24-hour time", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { startTime: "18:00" })).toHaveLength(1);
        });

        it("zero-pads single-digit hours and minutes before comparing", () => {
            const bookings = [makeBooking({ startTime: new Date(2026, 7, 10, 9, 5) })];

            expect(filterBookings(bookings, { startTime: "09:05" })).toHaveLength(1);
        });

        it("excludes non-matching times", () => {
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { startTime: "19:00" })).toHaveLength(0);
        });

        it("does not accept 12-hour or unpadded formats", () => {
            // Documents a sharp edge: only zero-padded 24h "HH:mm" works.
            const bookings = [makeBooking()];

            expect(filterBookings(bookings, { startTime: "6:00 PM" })).toHaveLength(0);
            expect(filterBookings(bookings, { startTime: "18:0" })).toHaveLength(0);
        });
    });

    describe("combined filters", () => {
        it("ANDs all three filters together", () => {
            const bookings = [
                makeBooking({ dayOfWeek: "Mon", startTime: new Date(2026, 7, 10, 18, 0) }),
                makeBooking({ dayOfWeek: "Tue", startTime: new Date(2026, 7, 11, 18, 0) }),
                makeBooking({ dayOfWeek: "Mon", startTime: new Date(2026, 7, 10, 20, 0) }),
            ];

            const result = filterBookings(bookings, {
                weekday: "Mon",
                date: "2026-08-10",
                startTime: "18:00",
            });

            expect(result).toHaveLength(1);
            expect(result[0].startTime.getHours()).toBe(18);
        });

        it("excludes a booking that matches only some filters", () => {
            const bookings = [makeBooking({ dayOfWeek: "Mon" })];

            expect(filterBookings(bookings, { weekday: "Mon", startTime: "07:00" })).toHaveLength(0);
        });
    });
});
