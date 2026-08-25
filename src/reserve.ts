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

/**
 * Normalizes a date input into a local-time `Date`.
 *
 * A bare `yyyy-mm-dd` string is parsed as LOCAL midnight rather than letting
 * `new Date()` treat it as UTC midnight, which would land on the previous day
 * in any negative-offset timezone (the club is US Pacific) and silently shift
 * the target day. A full timestamp string is parsed as-is, and a `Date` object
 * is returned untouched. Throws on unparseable input.
 */
export function parseDate(date: string | Date): Date {
    if (date instanceof Date) {
        if (Number.isNaN(date.getTime())) {
            throw new Error("Invalid date: received an invalid Date object.");
        }
        return date;
    }

    const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    const parsed = isoDateOnly
        ? new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]))
        : new Date(date);

    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date: ${JSON.stringify(date)} could not be parsed.`);
    }
    return parsed;
}

export function combineDateTime(date: string | Date, time: string): Date {
    const d = parseDate(date);
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
        throw new Error(`Invalid time format "${time}". Expected "HH:mm".`);
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(match[1]), Number(match[2]));
}

/**
 * Rejects reservation starts that are not strictly in the future. `now` is
 * injectable so the boundary can be unit-tested without real time; it defaults
 * to the current instant. A start equal to now is rejected — a court can't be
 * reserved for a time that has already begun.
 */
export function assertFutureStart(start: Date, now: Date = new Date()): void {
    if (Number.isNaN(start.getTime())) {
        throw new Error("Reservation start is not a valid date.");
    }
    if (start.getTime() <= now.getTime()) {
        throw new Error(`Reservation start ${start.toString()} must be in the future.`);
    }
}

/**
 * The `title` attribute CourtReserve puts on each calendar date cell, e.g.
 * `Friday, September 18, 2026`. This is the only stable key for a date cell:
 * `data-value` uses a zero-indexed month and the cell's text is just the day
 * number. Extracted so the format is unit-tested against the captured markup.
 */
export function calendarDateTitle(date: Date): string {
    return dayjs(date).format("dddd, MMMM D, YYYY");
}

/**
 * Parses the scheduler toolbar's date text into a dayjs. The site renders
 * "Saturday, September 12, 2026" (full) or "Sat, Sep 12" (short); dayjs's
 * customParseFormat cannot parse the day-of-week tokens, so the leading
 * weekday is stripped first. Returns null when the text is unparseable.
 */
export function parseScheduleDateText(text: string): dayjs.Dayjs | null {
    const withoutDay = text.trim().replace(/^[A-Za-z]+,\s*/, "");
    const withYear = dayjs(withoutDay, "MMMM D, YYYY");
    if (withYear.isValid()) return withYear;
    const short = dayjs(withoutDay, "MMM D");
    return short.isValid() ? short : null;
}

const HALF_HOUR_MS = 30 * 60_000;

/**
 * Counts the consecutive free cells in the run adjacent to a reserved window's
 * edge: walking backward from `start - 30min` or forward from `end`. A missing
 * cell terminates the run whether it is another session/block or outside the
 * venue's open hours — which is exactly the boundary the no-orphan rule needs.
 */
function countFreeRun(starts: Map<number, boolean>, edge: number, step: 1 | -1): number {
    let count = 0;
    let t = edge;
    while (starts.has(t)) {
        count += 1;
        t += step * HALF_HOUR_MS;
    }
    return count;
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

    // A court is a candidate if every 30-min cell in [start, end) is free AND
    // neither edge would strand a lone 30-min leftover: with durations starting
    // at 1h, a single stranded half-hour could never be booked by anyone.
    // The leftover run counts sessions/blocks and open/close edges alike,
    // since both appear as absent cells.
    const candidates: string[] = [];
    for (const [courtLabel, starts] of courtMap) {
        let allFree = true;
        for (let i = 0; i < cellCount; i++) {
            const cellStart = start.getTime() + i * HALF_HOUR_MS;
            if (!starts.has(cellStart)) {
                allFree = false;
                break;
            }
        }
        if (!allFree) continue;

        if (countFreeRun(starts, start.getTime() - HALF_HOUR_MS, -1) === 1) continue;
        if (countFreeRun(starts, endMs, 1) === 1) continue;

        candidates.push(courtLabel);
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
    await navigateScheduleToDate(page, parseDate(date));
}

/**
 * Reads the date the scheduler is currently displaying, from the toolbar's
 * current-date link (`k-lg-date-format` text, e.g. "Saturday, September 12,
 * 2026"), falling back to the short form (`k-sm-date-format`). Returns null
 * when neither parses so callers can fall through to calendar navigation.
 */
export async function readScheduleDate(page: Page): Promise<dayjs.Dayjs | null> {
    const link = page.locator('[data-testid="link-0"]');

    const fullText = (await link.locator(".k-lg-date-format").textContent()) ?? "";
    const fromFull = parseScheduleDateText(fullText);
    if (fromFull) return fromFull;

    const shortText = (await link.locator(".k-sm-date-format").textContent()) ?? "";
    return parseScheduleDateText(shortText);
}

export async function navigateScheduleToDate(page: Page, date: Date): Promise<void> {
    const target = dayjs(date);

    // If the scheduler is already showing the target day, don't open the
    // calendar — clicking the already-selected date cell would not navigate
    // and close the popup, stalling on the wait for it to hide.
    const current = await readScheduleDate(page);
    if (current && current.isSame(target, "day")) {
        return;
    }

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
    let reachedTargetMonth = false;
    for (let i = 0; i < 36; i++) {
        const currentText = (await monthLabel.textContent()) ?? "";
        const current = dayjs(currentText.trim(), "MMMM YYYY");
        if (current.month() === target.month() && current.year() === target.year()) {
            reachedTargetMonth = true;
            break;
        }

        if (current.isBefore(target)) {
            const next = calendar.locator(".k-nav-next");
            // "Next" is disabled once the booking window's far edge is reached:
            // the target date is beyond the furthest date the club allows.
            if ((await next.getAttribute("aria-disabled")) === "true") {
                throw new Error(
                    `Reservation date ${target.format("MMMM D, YYYY")} is beyond the bookable window.`,
                );
            }
            await humanClick(next);
        } else {
            const prev = calendar.locator(".k-nav-prev");
            // "Prev" is disabled at the earliest viewable month; a future target
            // should never hit this, but surface it clearly rather than stalling.
            if ((await prev.getAttribute("aria-disabled")) === "true") {
                throw new Error(
                    `Could not navigate the calendar back to ${target.format("MMMM D, YYYY")}.`,
                );
            }
            await humanClick(prev);
        }
        await pauseForAction();
    }

    if (!reachedTargetMonth) {
        throw new Error(`Could not navigate the calendar to ${target.format("MMMM YYYY")}.`);
    }

    // Click the target date cell. Scoped to the calendar table so the footer
    // "today" link (which also carries a `title`) can't be matched.
    const dateCell = calendar.locator(
        `table.k-calendar-table a.k-link[title="${calendarDateTitle(target.toDate())}"]`,
    );
    await humanClick(dateCell);

    // Wait for the calendar to close and the scheduler to reload the day.
    await calendar.waitFor({ state: "hidden" });
    await pauseForAction();
}

export async function readReservedSlots(page: Page): Promise<ReservedSlot[]> {
    // Try the toolbar date first; fall back to the first reserveBtn's start
    // attribute when the toolbar text is empty or unparseable.
    let dateStr: string;
    const dateText = (await page.locator(".k-lg-date-format").textContent()) ?? "";
    const viewDate = parseScheduleDateText(dateText);
    if (viewDate) {
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
    // The scheduler renders a reserve button for every 30-min cell, but cells
    // that are not bookable carry an extra "hide" class (covered by a member
    // reservation or a "Reserved" block). Only the buttons without "hide" are
    // genuinely free to book.
    const buttons = page.locator('button[data-testid="reserveBtn"]:not(.hide)');
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
    const durationPicker = page.locator('[data-testid="Duration"]').locator("xpath=ancestor::span[contains(@class, 'k-picker')]");

    // The widget's current value renders in .k-input-value-text (e.g. "1
    // hour", the modal default). When it already matches the target duration,
    // skip opening the popup at all — one less JS-gated Kendo interaction,
    // and less time spent against the modal's hold timer.
    const currentValue = ((await durationPicker.locator(".k-input-value-text").textContent()) ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (currentValue === label) return;

    // Click the Duration DropDownList's arrow button to open it
    await humanClick(durationPicker);

    const listbox = page.locator("#Duration_listbox");
    await listbox.waitFor({ state: "visible" });

    const durationOption = listbox.locator("li.k-list-item").filter({ hasText: label });
    await humanClick(durationOption);
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
