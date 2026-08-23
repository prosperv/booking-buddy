import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BrowserContext, Page, chromium } from "playwright";
import { getBookingsFound, collectBookingSessions } from "../../src/booking";
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
        it("extracts the count from the 'Booking Found' label", async () => {
            await loadFixture(page, "one-booking-two-people.html");

            // Derive the expected count from the raw label text, so the assertion
            // checks the code's extraction rather than re-stating a hardcoded number.
            const label = await page.getByText("Booking Found").innerText();
            const expected = Number((/\d+/.exec(label) ?? ["0"])[0]);
            expect(await getBookingsFound(page)).toBe(expected);
        });
    });

    describe("collectBookingSessions", () => {
        it("returns no sessions when there are no editable cards", async () => {
            await loadFixture(page, "no-booking.html");
            expect(await collectBookingSessions(page)).toHaveLength(0);
        });

        it("returns sessions only for editable cards", async () => {
            await loadFixture(page, "booking-by-other-people.html");

            // Count editable cards independently via the details-btn text, so the
            // non-editable-card filter is verified against the DOM, not a hardcoded 2.
            const cards = page.locator('[data-testid^="booking-card-wrapper-"]');
            const total = await cards.count();
            let editable = 0;
            for (let i = 0; i < total; i++) {
                const text = (await cards.nth(i).getByTestId("details-btn").textContent()) ?? "";
                if (/edit/i.test(text)) editable++;
            }
            // Guard: the fixture must actually exercise both branches.
            expect(editable).toBeGreaterThan(0);
            expect(editable).toBeLessThan(total);

            const sessions = await collectBookingSessions(page);
            expect(sessions).toHaveLength(editable);
        });

        it("builds a session from a card's raw fields", async () => {
            await loadFixture(page, "one-booking-two-people.html");

            const card = page.locator('[data-testid^="booking-card-wrapper-"]').first();
            const wrapper = (await card.getAttribute("data-testid")) ?? "";
            const datetime = (await card.getByTestId("row-date-and-times").textContent()) ?? "";
            const court = (await card.getByTestId("row-courts").textContent()) ?? "";
            const members = (await card.getByTestId("row-members").textContent()) ?? "";

            const sessions = await collectBookingSessions(page);
            expect(sessions).toHaveLength(1);
            const s = sessions[0];

            // Each field must be derived from the card's raw text — this verifies
            // the wiring (which testid feeds which field) without re-parsing the
            // same strings the unit tests already cover.
            expect(s.bookingId).toBe(wrapper.replace("booking-card-wrapper-", ""));
            expect(s.dayOfWeek).toBe(datetime.split(",")[0].trim());
            expect(s.courtNumber).toBe(Number(court.split(" ").pop()));
            expect(s.players).toHaveLength(members.split(",").length);
            expect(s.startTime).toBeInstanceOf(Date);
            expect(s.endTime).toBeInstanceOf(Date);
            expect(s.endTime.getTime()).toBeGreaterThan(s.startTime.getTime());
        });
    });
});
