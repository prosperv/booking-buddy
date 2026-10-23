import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Browser, Page } from "playwright";
import { getBookingsFound, collectBookingSessions, editBooking } from "../../src/booking";
import { connectSharedBrowser, loadFixture } from "./setup";

describe("functional: booking scraping", () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
        browser = await connectSharedBrowser();
        page = await browser.newPage();
    });

    afterAll(async () => {
        await page.close();
        await browser.close();
    });

    describe("getBookingsFound", () => {
        it("returns 1 for one-booking-two-people page", async () => {
            await loadFixture(page, "one-booking-two-people.html");
            await expect(getBookingsFound(page)).resolves.toBe(1);
        });
    });

    describe("collectBookingSessions", () => {
        it("returns an empty array for a page with no booking cards", async () => {
            await loadFixture(page, "no-booking.html");
            const sessions = await collectBookingSessions(page);
            expect(sessions).toHaveLength(0);
        });

        it("returns one booking session with correct date and court", async () => {
            await loadFixture(page, "one-booking-two-people.html");
            const sessions = await collectBookingSessions(page);

            expect(sessions).toHaveLength(1);
            expect(sessions[0].bookingId).toBe("58800347");
            expect(sessions[0].dayOfWeek).toBe("Tue");
            expect(sessions[0].courtNumber).toBe(10);
            expect(sessions[0].courtLocation).toBe("Mukilteo");
            expect(sessions[0].startTime).toBeInstanceOf(Date);
            expect(sessions[0].endTime).toBeInstanceOf(Date);
        });

        it("parses the start and end times correctly", async () => {
            await loadFixture(page, "one-booking-two-people.html");
            const sessions = await collectBookingSessions(page);

            expect(sessions[0].startTime.getHours()).toBe(21);
            expect(sessions[0].startTime.getMinutes()).toBe(0);
            expect(sessions[0].endTime.getHours()).toBe(22);
            expect(sessions[0].endTime.getMinutes()).toBe(0);
        });

        it("parses the two players from the booking", async () => {
            await loadFixture(page, "one-booking-two-people.html");
            const sessions = await collectBookingSessions(page);

            expect(sessions[0].players).toHaveLength(2);
            expect(sessions[0].players[0]).toBe("Lin Dan");
            expect(sessions[0].players[1]).toContain("Viktor Axelsen");
        });

        it("skips bookings owned by someone else", async () => {
            await loadFixture(page, "booking-by-other-people.html");
            const sessions = await collectBookingSessions(page);

            expect(sessions).toHaveLength(2);
            expect(sessions[0].dayOfWeek).toBe("Tue");
            expect(sessions[0].courtLocation).toBe("Mukilteo");
            expect(sessions[0].courtNumber).toBe(10);
            expect(sessions[1].dayOfWeek).toBe("Sat");
            expect(sessions[1].courtLocation).toBe("Mukilteo");
            expect(sessions[1].courtNumber).toBe(1);
        });

        // Built inline rather than from test/data: there is no pruned capture of
        // a multi-court card, and the shape that matters is the court row, which
        // the site renders as one comma-separated run per reservation.
        const MULTI_COURT_CARD = `
            <div data-testid="booking-list-active">
              <div data-testid="booking-card-wrapper-999001">
                <div data-testid="details-btn">Edit Reservation</div>
                <div data-testid="row-date-and-times">Mon, Oct 19th, 6:30 PM - 8:30 PM</div>
                <div data-testid="row-courts">Mukilteo 8, Mukilteo 9, Mukilteo 10, Mukilteo 11, Mukilteo 12</div>
                <div data-testid="row-members">Bryan Cheong, Brandon Luu</div>
              </div>
            </div>`;

        it("keeps a multi-court booking's location a real location", async () => {
            await page.setContent(MULTI_COURT_CARD);

            const sessions = await collectBookingSessions(page);

            expect(sessions).toHaveLength(1);
            expect(sessions[0].courtLocation).toBe("Mukilteo");
        });

        it("reports every court on a multi-court booking", async () => {
            await page.setContent(MULTI_COURT_CARD);

            const sessions = await collectBookingSessions(page);

            expect(sessions[0].courtNumbers).toEqual([8, 9, 10, 11, 12]);
            expect(sessions[0].courtNumber).toBe(8);
        });

        it("reports a single-court booking as a one-court span", async () => {
            await loadFixture(page, "one-booking-two-people.html");

            const sessions = await collectBookingSessions(page);

            expect(sessions[0].courtNumbers).toEqual([10]);
        });
    });
});
