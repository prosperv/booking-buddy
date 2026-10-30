import { Locator, Page, type Response } from "playwright";
import { courtReserveOrgId, courtReserveUrl, courtReserveUpdateMyReservationUrl, saveTimeoutMs } from "./constants";
import { captureFailure } from "./capture";
import { humanClick } from "./interactions";
import { loggerFor } from "./log-context";
import { navigateTo } from "./navigation";
import { delay, pauseForAction } from "./utils";

/**
 * Per-character delay used while typing into the member search. The search is
 * a remote datasource; a single bulk `fill()` may collapse to one input event
 * that the widget's debounce drops. A short per-key pause is more reliable and
 * looks more human. Kept small on purpose — it is not the anti-bot pacing (see
 * `pauseForAction`).
 */
const TYPING_DELAY_MS = 80;

/**
 * How long to wait for the "Reservation Confirmed" screen after a save. The
 * screen is only shown when the detail page was reached directly (empty
 * `document.referrer`); otherwise the site navigates away and no confirmation
 * appears. Kept short so the no-confirmation path doesn't stall.
 */
const CONFIRMATION_TIMEOUT_MS = 3000;

/**
 * How long to wait for a just-confirmed add to show up in the modal's pending
 * roster before declaring the add unconfirmed. The member row is appended
 * client-side by the site's confirm handler, which can be slightly async.
 */
const ADD_CONFIRM_TIMEOUT_MS = 5000;

/**
 * Collapses whitespace, drops the trailing "?" characters the site appends to
 * some names (e.g. "Kento Momota ??"), and casefolds. Used to compare the
 * current roster against the requested player and to match dropdown options.
 */
export function normalizePlayerName(name: string): string {
    return name.replace(/\?+$/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The site only searches once at least 3 letters are typed. Returns an error
 * message when the query is too short, or `null` when it is acceptable.
 */
export function searchNameError(name: string): string | null {
    const letters = name.replace(/[^a-zA-Z]/g, "");
    return letters.length < 3
        ? `Search needs at least 3 letters, got ${JSON.stringify(name)}`
        : null;
}

/**
 * One entry in the member-search dropdown, as rendered.
 *
 * In the new CourtReserve UI the dropdown options carry the member id directly
 * in their `data-testid` (`reservation-additional-player-option-<id>`), so ids
 * are always available when a search returns results.
 */
export type MemberOption = {
    /** The name as rendered in the dropdown, which is what gets clicked and logged. */
    displayName: string;
    /** CourtReserve `MemberId`, parsed from the option's `data-testid`. */
    memberId?: number;
};

export type PlayerMatch =
    | { status: "exact"; name: string; index: number }
    | { status: "unique"; name: string; index: number }
    | { status: "by-id"; name: string; index: number }
    | { status: "ambiguous"; candidates: string[] }
    | { status: "id-not-found"; candidates: string[] }
    | { status: "not-found"; candidates: string[] };

/**
 * Renders a candidate list for a failure, carrying the member id when one is
 * known so the caller can put one in `nameMap` and be done.
 */
function describeCandidates(options: MemberOption[], matches?: MemberOption[]): string[] {
    const chosen = matches ?? options;
    return chosen.map((o) =>
        o.memberId === undefined ? o.displayName : `${o.displayName} (id ${o.memberId})`,
    );
}

/**
 * Resolves a search query against the dropdown options.
 */
export function matchPlayerOption(options: MemberOption[], query: string, memberId?: number): PlayerMatch {
    if (memberId !== undefined) {
        const byId = options.filter((o) => o.memberId === memberId);
        if (byId.length === 1) {
            return { status: "by-id", name: byId[0].displayName, index: options.indexOf(byId[0]) };
        }
        return { status: "id-not-found", candidates: describeCandidates(options) };
    }

    const q = normalizePlayerName(query);
    const indexed = options.map((o, index) => ({
        raw: o.displayName.trim(),
        index,
        norm: normalizePlayerName(o.displayName),
    }));

    const exact = indexed.filter((o) => o.norm === q);
    if (exact.length === 1) {
        return { status: "exact", name: exact[0].raw, index: exact[0].index };
    }
    if (exact.length > 1) {
        return { status: "ambiguous", candidates: describeCandidates(options, exact.map((o) => options[o.index])) };
    }

    const sub = indexed.filter((o) => o.norm.includes(q));
    if (sub.length === 1) {
        return { status: "unique", name: sub[0].raw, index: sub[0].index };
    }
    if (sub.length > 1) {
        return { status: "ambiguous", candidates: describeCandidates(options, sub.map((o) => options[o.index])) };
    }

    return { status: "not-found", candidates: describeCandidates(options) };
}

export type RosterPlayerMatch =
    | { status: "exact"; name: string; index: number }
    | { status: "not-found"; candidates: string[] };

/**
 * Resolves a player against the edit modal's pending roster. Removal matches
 * on normalized equality only.
 */
export function matchRosterPlayer(roster: string[], query: string): RosterPlayerMatch {
    const q = normalizePlayerName(query);
    const match = roster.findIndex((raw) => normalizePlayerName(raw) === q);
    if (match === -1) {
        return { status: "not-found", candidates: roster };
    }
    return { status: "exact", name: roster[match].trim(), index: match };
}

/**
 * URL of a single reservation's detail page.
 */
export function reservationDetailUrl(bookingId: string): string {
    return `${courtReserveUrl}Online/MyProfile/Reservation/${courtReserveOrgId}/${bookingId}`;
}

export async function openReservationDetail(page: Page, bookingId: string): Promise<void> {
    await navigateTo(
        page,
        reservationDetailUrl(bookingId),
        "CourtReserve Reservation Detail",
        '[data-testid="btn-update-reservation"]',
    );
    loggerFor(page).info("navigate to reservation detail", { event: "navigate", bookingId });
    try {
        await page.getByTestId("btn-update-reservation").waitFor({ state: "visible" });
    } catch (err) {
        const snapshot = await captureFailure(page);
        loggerFor(page).error(`reservation detail did not load: ${err instanceof Error ? err.message : err}`, {
            event: "detail-load-failed",
            bookingId,
            message: err instanceof Error ? err.message : String(err),
            snapshot,
        });
        throw err;
    }
}

/**
 * Clicks "Edit Reservation" and waits for the AJAX modal to attach.
 */
export async function openEditReservationModal(page: Page): Promise<Locator> {
    const editReservationButton = page.getByTestId("btn-update-reservation");
    loggerFor(page).info("click Edit Reservation", { event: "click", target: "Edit Reservation" });
    await humanClick(editReservationButton);

    const modal = page.getByTestId("reservation-edit-modal");
    try {
        await modal.waitFor({ state: "visible" });
    } catch (err) {
        const snapshot = await captureFailure(page);
        loggerFor(page).error(`edit modal did not open: ${err instanceof Error ? err.message : err}`, {
            event: "modal-open-failed",
            message: err instanceof Error ? err.message : String(err),
            snapshot,
        });
        throw err;
    }
    return modal;
}

/**
 * Player names from the edit modal's pending roster.
 */
export async function readModalPlayers(modal: Locator): Promise<string[]> {
    const rows = modal.locator('[data-testid^="reservation-player-row-"]');
    const count = await rows.count();
    const players: string[] = [];
    for (let i = 0; i < count; i++) {
        const cell = rows.nth(i).locator("td").nth(1);
        const text = (await cell.innerText()).replace(/\s+/g, " ").trim();
        players.push(text);
    }
    loggerFor(modal.page()).debug("roster read", {
        event: "roster-read",
        source: "modal",
        count: players.length,
        players,
    });
    return players;
}

export type RemoveMemberOutcome =
    | { status: "removed"; name: string }
    | { status: "not-found"; name: string }
    | { status: "not-removable"; name: string };

/**
 * Removes one player from the edit modal's pending roster.
 */
export async function removeMemberFromModal(modal: Locator, name: string): Promise<RemoveMemberOutcome> {
    const roster = await readModalPlayers(modal);
    const match = matchRosterPlayer(roster, name);

    if (match.status === "not-found") {
        return { status: "not-found", name };
    }

    const row = modal.locator('[data-testid^="reservation-player-row-"]').nth(match.index);
    const removeButton = row.locator('button[data-testid^="reservation-player-remove-"]');
    if ((await removeButton.count()) === 0) {
        return { status: "not-removable", name: match.name };
    }

    loggerFor(modal.page()).info("click remove member", {
        event: "click",
        target: "remove member",
        name: match.name,
    });
    await humanClick(removeButton);
    return { status: "removed", name: match.name };
}

/**
 * Player names from the reservation detail page's persisted roster.
 */
export async function readDetailPlayers(page: Page): Promise<string[]> {
    const names = await page
        .locator('[data-testid="player-full-name"]')
        .allTextContents();
    const players = names.map((n) => n.replace(/\s+/g, " ").trim());
    loggerFor(page).debug("roster read", {
        event: "roster-read",
        source: "detail",
        count: players.length,
        players,
    });
    return players;
}

export async function typePlayerSearch(modal: Locator, name: string): Promise<void> {
    loggerFor(modal.page()).info("typed search", { event: "typed-search", name });
    const input = modal.locator('[data-testid="reservation-additional-player-search"] input');
    await input.click();
    await input.press("ControlOrMeta+A");
    await input.press("Delete");
    await input.pressSequentially(name, { delay: TYPING_DELAY_MS });
}

/**
 * Empties the member-search box.
 */
export async function clearMemberSearch(modal: Locator): Promise<void> {
    try {
        const input = modal.locator('[data-testid="reservation-additional-player-search"] input');
        await input.press("ControlOrMeta+A", { timeout: 1000 });
        await input.press("Delete", { timeout: 1000 });
        await input.press("Tab", { timeout: 1000 });
        loggerFor(modal.page()).debug("cleared member search", { event: "search-cleared" });
    } catch {
        // Nothing to clear: carry on.
    }
}

/**
 * Waits until the member-search results appear, then returns the visible
 * option names (with ids parsed from their testids).
 */
export async function readPlayerOptions(page: Page): Promise<MemberOption[]> {
    const results = page.locator('[data-testid="reservation-additional-player-results"]');
    try {
        await results.waitFor({ state: "visible", timeout: 10000 });
    } catch (err) {
        // Results may already be absent; fall through to empty list.
    }

    const optionLocators = page.locator('[data-testid^="reservation-additional-player-option-"]');
    const count = await optionLocators.count();
    const options: MemberOption[] = [];
    for (let i = 0; i < count; i++) {
        const el = optionLocators.nth(i);
        const testId = (await el.getAttribute("data-testid")) ?? "";
        const idMatch = testId.match(/reservation-additional-player-option-(\d+)/);
        const memberId = idMatch ? Number(idMatch[1]) : undefined;
        const displayName = (await el.innerText()).replace(/\s+/g, " ").trim();
        options.push(memberId === undefined ? { displayName } : { displayName, memberId });
    }

    const logger = loggerFor(page);
    if (options.length === 0) {
        logger.debug("member-search results", { event: "member-search", count: 0, options: [] });
    } else {
        logger.debug("member-search results", {
            event: "member-search",
            count: options.length,
            idsResolved: true,
            options: options.map((o) => (o.memberId === undefined ? o.displayName : `${o.displayName} (${o.memberId})`)),
        });
    }
    return options;
}

export async function selectPlayerOption(page: Page, index: number): Promise<void> {
    const option = page.locator('[data-testid^="reservation-additional-player-option-"]').nth(index);
    loggerFor(page).info("click player option", { event: "click", target: "player option", index });
    await humanClick(option);
}

/**
 * Polls the modal's pending roster until `name` appears.
 */
export async function verifyPlayerAdded(
    modal: Locator,
    name: string,
    timeoutMs = ADD_CONFIRM_TIMEOUT_MS,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (matchRosterPlayer(await readModalPlayers(modal), name).status === "exact") {
            loggerFor(modal.page()).debug("player verified", {
                event: "player-verified",
                name,
                added: true,
            });
            return true;
        }
        await delay(200);
    }
    loggerFor(modal.page()).debug("player verified", {
        event: "player-verified",
        name,
        added: false,
    });
    return false;
}

/**
 * Clicks "Yes" on the "Are you sure?" confirmation dialog.
 */
export async function confirmAddPlayer(page: Page): Promise<void> {
    const dialog = page.locator(".ant-modal-confirm");
    try {
        await dialog.waitFor({ state: "visible", timeout: 10000 });
    } catch (err) {
        const snapshot = await captureFailure(page);
        loggerFor(page).error(`confirmation dialog did not appear: ${err instanceof Error ? err.message : err}`, {
            event: "confirm-dialog-timeout",
            message: err instanceof Error ? err.message : String(err),
            snapshot,
        });
        throw err;
    }
    loggerFor(page).info("click Yes on confirmation", { event: "click", target: "confirm add" });
    await humanClick(dialog.locator("button.ant-btn-primary"));
}

/**
 * Dismisses the "Reservation Confirmed" screen if one appears after a save.
 */
export async function closeReservationConfirmation(page: Page): Promise<void> {
    const confirmation = page.getByTestId("reservation-confirm");
    try {
        await confirmation.waitFor({ state: "visible", timeout: CONFIRMATION_TIMEOUT_MS });
    } catch {
        return;
    }
    loggerFor(page).info("click Close on confirmation", { event: "click", target: "dismiss confirmation" });
    await humanClick(confirmation.getByTestId("Close"));
}

/**
 * Saves the reservation.
 */
export async function saveReservation(page: Page): Promise<boolean> {
    const responsePromise = page.waitForResponse(
        (response) =>
            response.url().includes(courtReserveUpdateMyReservationUrl) &&
            response.request().method() === "POST",
        { timeout: saveTimeoutMs },
    );

    loggerFor(page).info("click Save", { event: "click", target: "Save" });
    await humanClick(page.getByTestId("reservation-mobile-submit-btn"));

    let response: Response;
    try {
        response = await responsePromise;
    } catch (err) {
        const snapshot = await captureFailure(page);
        loggerFor(page).warn("save was not confirmed: no response seen before the timeout", {
            event: "save-unconfirmed",
            message: err instanceof Error ? err.message : String(err),
            snapshot,
        });
        return false;
    }
    if (!response.ok()) {
        const snapshot = await captureFailure(page);
        loggerFor(page).error("save failed", {
            event: "save-failed",
            status: response.status(),
            statusText: response.statusText(),
            url: response.url(),
            snapshot,
        });
        throw new Error(`Saving the reservation failed: ${response.status()} ${response.statusText()}`);
    }

    loggerFor(page).info("reservation saved", {
        event: "save",
        status: response.status(),
        url: response.url(),
    });

    await closeReservationConfirmation(page);
    return true;
}

export async function closeModal(page: Page): Promise<void> {
    loggerFor(page).info("click Close", { event: "click", target: "Close" });
    await humanClick(page.getByTestId("reservation-mobile-back-btn"));
    await pauseForAction();
}
