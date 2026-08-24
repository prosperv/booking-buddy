import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BrowserContext, Page, chromium } from "playwright";
import { readReservedSlots, readFreeCells, calendarDateTitle, readScheduleDate } from "../../src/reserve";
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
        it("reads one cell per reserve button on the schedule", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            // Counted via an independent selector (the button class), not the
            // code's testid, so a stale testid in the code surfaces as a mismatch.
            const buttonCount = await page.locator("button.slot-btn").count();
            expect(buttonCount).toBeGreaterThan(0);

            const cells = await readFreeCells(page);
            expect(cells).toHaveLength(buttonCount);
        });

        it("parses a button's start, end, and courtlabel attributes into a cell", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            const firstButton = page.locator("button.slot-btn").first();
            const rawStart = await firstButton.getAttribute("start");
            const rawEnd = await firstButton.getAttribute("end");
            const rawCourt = await firstButton.getAttribute("courtlabel");

            const cells = await readFreeCells(page);
            const match = cells.find(
                (c) => c.courtLabel === rawCourt && c.startTime.getTime() === new Date(rawStart!).getTime(),
            );

            expect(match).toBeDefined();
            expect(match!.endTime.getTime()).toBe(new Date(rawEnd!).getTime());
        });

        it("gives every cell a court and an ordered time range", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            const cells = await readFreeCells(page);
            for (const cell of cells) {
                expect(cell.courtLocation.length).toBeGreaterThan(0);
                expect(cell.courtNumber).toBeGreaterThan(0);
                expect(cell.endTime.getTime()).toBeGreaterThan(cell.startTime.getTime());
            }
        });
    });

    describe("readReservedSlots", () => {
        it("reads one slot per reservation event on the schedule", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            const eventCount = await page.locator('[data-testid="reservation-action"]').count();
            expect(eventCount).toBeGreaterThan(0);

            const slots = await readReservedSlots(page);
            expect(slots).toHaveLength(eventCount);
        });

        it("parses members only for events that actually list them", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            // Some events render a reservation-members element and some do not;
            // readReservedSlots must tolerate the absence rather than throw.
            const events = page.locator('[data-testid="reservation-action"]');
            const eventCount = await events.count();
            let eventsWithMembers = 0;
            for (let i = 0; i < eventCount; i++) {
                if ((await events.nth(i).locator('[data-testid="reservation-members"]').count()) > 0) {
                    eventsWithMembers++;
                }
            }
            expect(eventsWithMembers).toBeGreaterThan(0);
            expect(eventsWithMembers).toBeLessThan(eventCount);

            const slots = await readReservedSlots(page);
            expect(slots.filter((s) => s.players.length > 0)).toHaveLength(eventsWithMembers);
        });

        it("gives every slot a court and an ordered time range", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            const slots = await readReservedSlots(page);
            for (const slot of slots) {
                expect(slot.courtLocation.length).toBeGreaterThan(0);
                expect(slot.courtNumber).toBeGreaterThan(0);
                expect(slot.endTime.getTime()).toBeGreaterThan(slot.startTime.getTime());
            }
        });
    });

    describe("readScheduleDate", () => {
        it("reads the scheduler's current date from the toolbar", async () => {
            await loadFixture(page, "reserving-courts/schedule.html");

            const date = await readScheduleDate(page);
            expect(date).not.toBeNull();
            expect(date!.year()).toBe(2026);
            expect(date!.month()).toBe(8); // September
            expect(date!.date()).toBe(12);
        });
    });

    describe("calendar navigation", () => {
        it("targets the calendar widget the code navigates", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            const calendar = page.locator('[data-role="calendar"]');
            expect(await calendar.count()).toBe(1);
        });

        it("reads the month label and disabled state the code relies on", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            // navigateCalendarToDate parses .k-nav-fast as "MMMM YYYY" and checks
            // aria-disabled before paging months; both must be present in the markup.
            const calendar = page.locator('[data-role="calendar"]');
            const month = (await calendar.locator(".k-nav-fast").textContent())?.trim();
            expect(month).toMatch(/^[A-Za-z]+ \d{4}$/);

            expect(await calendar.locator(".k-nav-prev").getAttribute("aria-disabled")).not.toBeNull();
            expect(await calendar.locator(".k-nav-next").getAttribute("aria-disabled")).not.toBeNull();
        });

        it("matches a date cell via the code's computed title", async () => {
            await loadFixture(page, "reserving-courts/calendar-open.html");

            // Compute the title the way navigateCalendarToDate does, then confirm a
            // cell bearing exactly that title exists in the captured markup. Fails
            // if CourtReserve changes its date-cell title format.
            const title = calendarDateTitle(new Date(2026, 8, 18));
            const cell = page.locator(
                `[data-role="calendar"] table.k-calendar-table a.k-link[title="${title}"]`,
            );
            expect(await cell.count()).toBe(1);
            expect((await cell.textContent())?.trim()).toBe("18");
        });
    });
});
