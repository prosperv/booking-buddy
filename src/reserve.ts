import { Locator, Page } from "playwright";
import {
    CourtLocation,
    courtLocations,
    courtReserveOrgId,
    scheduleUrl,
} from "./constants";
import { humanClick } from "./interactions";
import { navigateTo } from "./navigation";
import { normalizePlayerName, searchNameError, matchPlayerOption, readPlayerOptions, selectPlayerOption, confirmAddPlayer } from "./players";
import { pauseForAction } from "./utils";
import { PlayerInput, PlayerAddOutcome, ReservedSlot, ReserveDurationMinutes } from "./types";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type FreeCell = {
    courtLabel: string;
    courtLocation: string;
    courtNumber: number;
    startTime: Date;
    endTime: Date;
};

// ---------------------------------------------------------------------------
// Pure functions (unit-testable)
// ---------------------------------------------------------------------------

const DURATION_LABELS: Record<ReserveDurationMinutes, string> = {
    60: "1 hour",
    90: "1 hour & 30 minutes",
    120: "2 hours",
    150: "2 hours & 30 minutes",
    180: "3 hours",
};

export function durationLabel(minutes: number): string {
    const label = DURATION_LABELS[minutes as ReserveDurationMinutes];
    if (!label) {
        throw new Error(
            `Invalid duration ${minutes} minutes. Must be one of: ${Object.keys(DURATION_LABELS).join(", ")}`,
        );
    }
    return label;
}

export function parseSlotStart(attr: string): Date {
    const d = new Date(attr.trim());
    if (Number.isNaN(d.getTime())) {
        throw new Error(`Could not parse slot start attribute: ${JSON.stringify(attr)}`);
    }
    return d;
}

export function parseCourtLabel(label: string): { courtLocation: string; courtNumber: number } {
    const parts = label.trim().split(/\s+/);
    const num = Number(parts.pop());
    if (Number.isNaN(num)) {
        throw new Error(`Could not parse court number from label: ${JSON.stringify(label)}`);
    }
    return { courtLocation: parts.join(" "), courtNumber: num };
}

export function combineDateTime(date: string | Date, time: string): Date {
    let d: Date;
    if (typeof date === "string") {
        const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
        d = isoDateOnly
            ? new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]))
            : new Date(date);
    } else {
        d = date;
    }
    if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid date: ${JSON.stringify(date)}`);
    }
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
        throw new Error(`Invalid time format "${time}". Expected "HH:mm".`);
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(match[1]), Number(match[2]));
}

export function findCandidateCourts(
    freeCells: FreeCell[],
    preferCourts: number[],
    start: Date,
    durationMinutes: number,
): string[] {
    const endMs = start.getTime() + durationMinutes * 60_000;
    const cellCount = durationMinutes / 30;

    // Group free cells by court label
    const courtMap = new Map<string, Map<number, boolean>>();
    for (const cell of freeCells) {
        if (!courtMap.has(cell.courtLabel)) courtMap.set(cell.courtLabel, new Map());
        courtMap.get(cell.courtLabel)!.set(cell.startTime.getTime(), true);
    }

    // A court is a candidate if every 30-min cell in [start, end) is free
    const candidates: string[] = [];
    for (const [courtLabel, starts] of courtMap) {
        let allFree = true;
        for (let i = 0; i < cellCount; i++) {
            const cellStart = start.getTime() + i * 30 * 60_000;
            if (!starts.has(cellStart)) {
                allFree = false;
                break;
            }
        }
        if (allFree) candidates.push(courtLabel);
    }

    // Sort: preferred courts first (in order), then remaining
    if (preferCourts.length === 0) return candidates;

    const preferred: string[] = [];
    const remaining: string[] = [];
    for (const court of candidates) {
        const { courtNumber } = parseCourtLabel(court);
        if (preferCourts.includes(courtNumber)) {
            preferred.push(court);
        } else {
            remaining.push(court);
        }
    }

    // Preserve the caller's preference order for preferred courts
    preferred.sort((a, b) => {
        const aNum = parseCourtLabel(a).courtNumber;
        const bNum = parseCourtLabel(b).courtNumber;
        return preferCourts.indexOf(aNum) - preferCourts.indexOf(bNum);
    });

    return [...preferred, ...remaining];
}

// ---------------------------------------------------------------------------
// Page functions
// ---------------------------------------------------------------------------

export async function openSchedule(page: Page, location: CourtLocation, date: string | Date): Promise<void> {
    await navigateTo(page, scheduleUrl(location), `CourtReserve Schedule (${location})`);
    await page.locator('[data-role="scheduler"]').waitFor({ state: "visible" });
    await navigateScheduleToDate(page, typeof date === "string" ? new Date(date) : date);
}

export async function navigateScheduleToDate(page: Page, date: Date): Promise<void> {
    const target = dayjs(date);

    // Click the current-date link to open the Kendo calendar popup
    await humanClick(page.locator('[data-testid="link-0"]'));
    await navigateCalendarToDate(page, target);
}

/**
 * Operates on an already-open Kendo calendar popup: pages through months
 * until the target month is showing, then clicks the target date cell.
 * Split out of `navigateScheduleToDate` so the month/date logic can be
 * exercised against a fixture that already has the calendar rendered open.
 */
export async function navigateCalendarToDate(page: Page, target: dayjs.Dayjs): Promise<void> {
    const calendar = page.locator('[data-role="calendar"]');
    await calendar.waitFor({ state: "visible" });

    // Page through months until the target month is showing. The calendar
    // only renders the current month (plus trailing/leading other-month
    // cells), so the month label is the source of truth.
    const monthLabel = calendar.locator(".k-nav-fast");
    for (let i = 0; i < 36; i++) {
        const currentText = (await monthLabel.textContent()) ?? "";
        const current = dayjs(currentText.trim(), "MMMM YYYY");
        if (current.month() === target.month() && current.year() === target.year()) break;

        if (current.isBefore(target)) {
            const next = calendar.locator(".k-nav-next");
            // "Next" is disabled once the booking window's far edge is reached.
            if ((await next.getAttribute("aria-disabled")) === "true") break;
            await humanClick(next);
        } else {
            const prev = calendar.locator(".k-nav-prev");
            if ((await prev.getAttribute("aria-disabled")) === "true") break;
            await humanClick(prev);
        }
        await pauseForAction();
    }

    // Click the target date cell. Scoped to the calendar table so the footer
    // "today" link (which also carries a `title`) can't be matched.
    const title = target.format("dddd, MMMM D, YYYY");
    const dateCell = calendar.locator(`table.k-calendar-table a.k-link[title="${title}"]`);
    await humanClick(dateCell);

    // Wait for the calendar to close and the scheduler to reload the day.
    await calendar.waitFor({ state: "hidden" });
    await pauseForAction();
}

export async function readReservedSlots(page: Page): Promise<ReservedSlot[]> {
    // Try the toolbar date first (works on live site with Kendo JS).
    // Fall back to the first reserveBtn's start attribute (works in test fixtures).
    let dateStr: string;
    const dateText = (await page.locator(".k-lg-date-format").textContent()) ?? "";
    const viewDate = dayjs(dateText.trim(), "dddd, MMMM D, YYYY");
    if (viewDate.isValid()) {
        dateStr = viewDate.format("YYYY-MM-DD");
    } else {
        const firstBtn = page.locator('[data-testid="reserveBtn"]').first();
        const startAttr = (await firstBtn.getAttribute("start")) ?? "";
        dateStr = dayjs(startAttr.trim()).format("YYYY-MM-DD");
    }

    const events = page.locator('[data-testid="reservation-action"]');
    const count = await events.count();
    const slots: ReservedSlot[] = [];

    for (let i = 0; i < count; i++) {
        const event = events.nth(i);
        const courtLabel = (await event.getAttribute("data-courtlabel")) ?? "";
        const timesText = (await event.locator('[data-testid="reservation-times"]').textContent()) ?? "";
        const membersCount = await event.locator('[data-testid="reservation-members"]').count();
        const membersText = membersCount > 0
            ? (await event.locator('[data-testid="reservation-members"]').textContent()) ?? ""
            : "";

        const [startStr, endStr] = timesText.split(" - ").map((s) => s.trim());
        const startTime = dayjs(`${dateStr} ${startStr}`, "YYYY-MM-DD h:mm A").toDate();
        const endTime = dayjs(`${dateStr} ${endStr}`, "YYYY-MM-DD h:mm A").toDate();

        const { courtLocation, courtNumber } = parseCourtLabel(courtLabel);
        const players = membersText
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);

        slots.push({ courtLocation, courtNumber, startTime, endTime, players });
    }

    return slots;
}

export async function readFreeCells(page: Page): Promise<FreeCell[]> {
    const buttons = page.locator('[data-testid="reserveBtn"]');
    const count = await buttons.count();
    const cells: FreeCell[] = [];

    for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const startAttr = (await btn.getAttribute("start")) ?? "";
        const endAttr = (await btn.getAttribute("end")) ?? "";
        const courtLabel =
            (await btn.getAttribute("courtlabel")) ?? (await btn.getAttribute("data-courtlabel")) ?? "";

        const startTime = parseSlotStart(startAttr);
        const endTime = parseSlotStart(endAttr);
        const { courtLocation, courtNumber } = parseCourtLabel(courtLabel);

        cells.push({ courtLabel, courtLocation, courtNumber, startTime, endTime });
    }

    return cells;
}

export async function openCreateModal(page: Page, reserveBtn: Locator): Promise<Locator> {
    await humanClick(reserveBtn);
    const modal = page.locator('[data-testid="create-reservation"]');
    await modal.waitFor({ state: "visible" });
    return modal;
}

export async function selectDuration(page: Page, minutes: number): Promise<void> {
    const label = durationLabel(minutes);

    // Click the Duration DropDownList's arrow button to open it
    const durationPicker = page.locator('[data-testid="Duration"]').locator("xpath=ancestor::span[contains(@class, 'k-picker')]");
    await humanClick(durationPicker);

    const listbox = page.locator("#Duration_listbox");
    await listbox.waitFor({ state: "visible" });

    await humanClick(listbox.locator("li.k-list-item").filter({ hasText: label }));
    await pauseForAction();
}

export async function checkWaiver(modal: Locator): Promise<void> {
    const checkbox = modal.locator('[data-testid="DisclosureAgree"]');
    await humanClick(checkbox);
    await pauseForAction();
}

export async function saveNewReservation(page: Page): Promise<void> {
    const responsePromise = page.waitForResponse(
        (response) =>
            response.url().includes(`ReservationsApi/CreateReservation/${courtReserveOrgId}`) &&
            response.request().method() === "POST",
    );

    await humanClick(page.getByTestId("save-btn"));

    const response = await responsePromise;
    if (!response.ok()) {
        throw new Error(`Creating the reservation failed: ${response.status()} ${response.statusText()}`);
    }
}

export async function payReservation(page: Page): Promise<string> {
    const payBtn = page.getByTestId("pay-btn");
    await payBtn.waitFor({ state: "visible", timeout: 15_000 });

    const totalDue = ((await page.getByTestId("total-value").textContent()) ?? "").trim();

    const responsePromise = page.waitForResponse(
        (response) =>
            response.url().includes("Online/Payments/ProcessPayment") &&
            response.request().method() === "POST",
    );

    await humanClick(payBtn);

    const response = await responsePromise;
    if (!response.ok()) {
        throw new Error(`Payment failed: ${response.status()} ${response.statusText()}`);
    }

    return totalDue;
}
