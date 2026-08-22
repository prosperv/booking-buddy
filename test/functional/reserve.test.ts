import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BrowserContext, Page, chromium } from "playwright";
import { readReservedSlots, readFreeCells } from "../../src/reserve";
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
