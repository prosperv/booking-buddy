import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BrowserContext, Page, chromium } from "playwright";
import { getBookingsFound, collectBookingSessions, editBooking } from "../../src/booking";
import { loadFixture } from "./setup";

describe("functional: booking scraping", () => {
    let context: BrowserContext;
    let page: Page;

    beforeAll(async () => {
        context = await chromium.launch({ headless: true });
        page = await context.newPage();
    });

    afterAll(async () => {
        await page.close();
        await context.close();
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
    });

});
