import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BrowserContext, Page, chromium } from "playwright";
import { readReservedSlots, readFreeCells, calendarDateTitle } from "../../src/reserve";
import { loadFixture } from "./setup";

describe("functional: reservation scraping", () => {
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

    describe("readFreeCells", () => {
        it("reads all reserveBtn slots from the schedule", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");
            const cells = await readFreeCells(page);
            expect(cells).toHaveLength(312);
        });

        it("parses court labels and times correctly", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");
            const cells = await readFreeCells(page);

            const first = cells[0];
            expect(first.courtLabel).toBe("Mukilteo 1");
            expect(first.courtLocation).toBe("Mukilteo");
            expect(first.courtNumber).toBe(1);
            expect(first.startTime).toBeInstanceOf(Date);
            expect(first.endTime).toBeInstanceOf(Date);
        });

        it("covers all 12 courts", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");
            const cells = await readFreeCells(page);

            const courts = new Set(cells.map((c) => c.courtLabel));
            expect(courts.size).toBe(12);
            expect(courts.has("Mukilteo 1")).toBe(true);
            expect(courts.has("Mukilteo 12")).toBe(true);
        });
    });

    describe("readReservedSlots", () => {
        it("reads booked reservation events", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");
            const slots = await readReservedSlots(page);
            expect(slots.length).toBeGreaterThan(0);
        });

        it("parses court, times, and players", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");
            const slots = await readReservedSlots(page);

            const slot = slots[0];
            expect(slot.courtLocation).toBe("Mukilteo");
            expect(slot.courtNumber).toBeGreaterThan(0);
            expect(slot.startTime).toBeInstanceOf(Date);
            expect(slot.endTime).toBeInstanceOf(Date);
            expect(slot.players.length).toBeGreaterThan(0);
        });
    });

    describe("calendar navigation (calendar-open fixture)", () => {
        it("locates the open calendar widget", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            const calendar = page.locator('[data-role="calendar"]');
            expect(await calendar.count()).toBe(1);
            expect(await calendar.isVisible()).toBe(true);
        });

        it("reads the current month from the k-nav-fast label", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            const monthLabel = await page.locator('[data-role="calendar"] .k-nav-fast').textContent();
            expect(monthLabel?.trim()).toBe("September 2026");
        });

        it("exposes prev/next with correct disabled state", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            const calendar = page.locator('[data-role="calendar"]');
            expect(await calendar.locator(".k-nav-prev").getAttribute("aria-disabled")).toBe("false");
            expect(await calendar.locator(".k-nav-next").getAttribute("aria-disabled")).toBe("true");
        });

        it("matches a date cell via the code's computed title", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            // Compute the title the same way navigateCalendarToDate does, then
            // confirm a cell bearing exactly that title exists in the captured
            // markup. This fails if CourtReserve changes its title format.
            const title = calendarDateTitle(new Date(2026, 8, 18));
            const cell = page.locator(
                `[data-role="calendar"] table.k-calendar-table a.k-link[title="${title}"]`,
            );
            expect(await cell.count()).toBe(1);
            expect((await cell.textContent())?.trim()).toBe("18");
        });

        it("keeps the date cell scoped away from the footer today link", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            // The footer "today" link also carries a `title`; the calendar-table
            // scope must exclude it so the date-cell selector stays unambiguous.
            const footerToday = page.locator('[data-role="calendar"] .k-footer .k-nav-today');
            expect(await footerToday.count()).toBe(1);
            expect(await page.locator('[data-role="calendar"] table.k-calendar-table a.k-link').count())
                .toBeGreaterThan(1);
        });
    });

    describe("create-reservation modal", () => {
        it("has all expected form fields", async () => {
            await loadFixture(page, "reserving-courts/create-reservation-modal.html");

            expect(await page.locator('[data-testid="create-reservation"]').count()).toBe(1);
            expect(await page.locator('[data-testid="start-time"]').count()).toBe(1);
            expect(await page.locator('[data-testid="end-time"]').count()).toBe(1);
            expect(await page.locator('[data-testid="Duration"]').count()).toBe(1);
            expect(await page.locator('[data-testid="CourtIds"]').count()).toBe(1);
            expect(await page.locator('[data-testid="OwnersDropdown"]').count()).toBe(1);
            expect(await page.locator('[data-testid="DisclosureAgree"]').count()).toBe(1);
            expect(await page.locator('[data-testid="save-btn"]').count()).toBe(1);
            expect(await page.locator('[data-testid="close-btn-modal-header"]').count()).toBe(1);
        });

        it("has the member table for player roster", async () => {
            await loadFixture(page, "reserving-courts/create-reservation-modal.html");

            expect(await page.locator('[data-testid="member-table"]').count()).toBe(1);
            expect(await page.locator('[data-testid="player-fullname"]').count()).toBe(1);
        });
    });

    describe("process-payment page", () => {
        it("has pay button and total value", async () => {
            await loadFixture(page, "reserving-courts/process-payment.html");

            expect(await page.getByTestId("pay-btn").count()).toBe(1);
            const total = await page.getByTestId("total-value").textContent();
            expect(total?.trim()).toBe("$39.82");
        });
    });
});
