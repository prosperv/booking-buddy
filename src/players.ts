import { Locator, Page } from "playwright";
import { courtReserveOrgId, courtReserveUrl, courtReserveUpdateMyReservationUrl } from "./constants";
import { humanClick } from "./interactions";
import { navigateTo } from "./navigation";
import { pauseForAction } from "./utils";

/**
 * Per-character delay used while typing into the Kendo ComboBox. The member
 * search is a remote datasource; a single bulk `fill()` may collapse to one
 * input event that the widget's debounce drops. A short per-key pause is more
 * reliable and looks more human. Kept small on purpose — it is not the
 * anti-bot pacing (see `pauseForAction`).
 */
const TYPING_DELAY_MS = 80;

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

export type PlayerMatch =
    | { status: "exact"; name: string; index: number }
    | { status: "unique"; name: string; index: number }
    | { status: "ambiguous"; candidates: string[] }
    | { status: "not-found"; candidates: string[] };

/**
 * Resolves a search query against the dropdown options. An exact
 * (case-insensitive, junk-stripped) match always wins over a substring match,
 * so searching "Lee Zii Jia" picks "Lee Zii Jia" rather than "Lee Zii Jiaa".
 */
export function matchPlayerOption(options: string[], query: string): PlayerMatch {
    const q = normalizePlayerName(query);
    const indexed = options.map((raw, index) => ({
        raw: raw.trim(),
        index,
        norm: normalizePlayerName(raw),
    }));

    const exact = indexed.filter((o) => o.norm === q);
    if (exact.length === 1) {
        return { status: "exact", name: exact[0].raw, index: exact[0].index };
    }
    if (exact.length > 1) {
        return { status: "ambiguous", candidates: exact.map((o) => o.raw) };
    }

    const sub = indexed.filter((o) => o.norm.includes(q));
    if (sub.length === 1) {
        return { status: "unique", name: sub[0].raw, index: sub[0].index };
    }
    if (sub.length > 1) {
        return { status: "ambiguous", candidates: sub.map((o) => o.raw) };
    }

    return { status: "not-found", candidates: options.map((o) => o.trim()) };
}

export type RosterPlayerMatch =
    | { status: "exact"; name: string; index: number }
    | { status: "not-found"; candidates: string[] };

/**
 * Resolves a player against the edit modal's pending roster. Unlike the member
 * search, removal matches on normalized equality only — a substring match
 * would risk removing "Lee Zii Jia" when the caller asked for "Lee Zii Jiaa".
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
 * URL of a single reservation's detail page. The edit-reservation modal is
 * opened from here, so a `bookingId` is all that is needed to reach it.
 */
export function reservationDetailUrl(bookingId: string): string {
    return `${courtReserveUrl}Online/MyProfile/Reservation/${courtReserveOrgId}/${bookingId}`;
}

export async function openReservationDetail(page: Page, bookingId: string): Promise<void> {
    await navigateTo(page, reservationDetailUrl(bookingId), "CourtReserve Reservation Detail");
    await page.getByTestId("btn-update-reservation").waitFor({ state: "visible" });
}

/**
 * Clicks "Edit Reservation" and waits for the AJAX modal to attach. Returns a
 * locator scoped to the modal so later steps never leak onto the page behind
 * it (both surfaces carry a `players-table`, but with different inner testids).
 */
export async function openEditReservationModal(page: Page): Promise<Locator> {
    const editReservationButton = page.getByTestId("btn-update-reservation");
    await humanClick(editReservationButton);

    const modal = page.getByTestId("update-reservation-modal");
    await modal.waitFor({ state: "visible" });
    return modal;
}

/**
 * Player names from the edit modal's pending roster (`player-fullname`).
 */
export async function readModalPlayers(modal: Locator): Promise<string[]> {
    return modal
        .locator('[data-testid="member-table"] [data-testid="player-fullname"]')
        .allTextContents()
        .then((names) => names.map((n) => n.replace(/\s+/g, " ").trim()));
}

export type RemoveMemberOutcome =
    | { status: "removed"; name: string }
    | { status: "not-found"; name: string }
    | { status: "not-removable"; name: string };

/**
 * Removes one player from the edit modal's pending roster by clicking that
 * row's `remove-member-btn`. There is no confirmation dialog (unlike adding) —
 * the row is dropped client-side and persisted by a later `saveReservation`.
 * The reservation owner has no remove button, so trying to remove them yields
 * `not-removable` rather than throwing.
 */
export async function removeMemberFromModal(modal: Locator, name: string): Promise<RemoveMemberOutcome> {
    const roster = await readModalPlayers(modal);
    const match = matchRosterPlayer(roster, name);

    if (match.status === "not-found") {
        return { status: "not-found", name };
    }

    const row = modal.locator("tr.k-master-row").nth(match.index);
    const removeButton = row.getByTestId("remove-member-btn");
    if ((await removeButton.count()) === 0) {
        return { status: "not-removable", name: match.name };
    }

    await humanClick(removeButton);
    return { status: "removed", name: match.name };
}

/**
 * Player names from the reservation detail page's persisted roster
 * (`player-name`). Read after save to confirm what actually persisted.
 */
export async function readDetailPlayers(page: Page): Promise<string[]> {
    return page
        .locator('[data-testid="players-table"] [data-testid="player-name"]')
        .allTextContents()
        .then((names) => names.map((n) => n.replace(/\s+/g, " ").trim()));
}

export async function typePlayerSearch(modal: Locator, name: string): Promise<void> {
    await modal
        .locator('input[name="OwnersDropdown_input"]')
        .pressSequentially(name, { delay: TYPING_DELAY_MS });
}

/**
 * Waits until the member-search dropdown shows either options or an explicit
 * "no data" state, then returns the visible option names in order.
 */
export async function readPlayerOptions(page: Page): Promise<string[]> {
    await page.waitForFunction(() => {
        const items = document.querySelectorAll("#OwnersDropdown_listbox li.k-list-item");
        const noData = document.querySelector("#OwnersDropdown-list .k-no-data");
        return items.length > 0 || (noData !== null && getComputedStyle(noData).display !== "none");
    });

    return page
        .locator("#OwnersDropdown_listbox li.k-list-item")
        .evaluateAll((els) => els.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()));
}

export async function selectPlayerOption(page: Page, index: number): Promise<void> {
    const option = page.locator("#OwnersDropdown_listbox li.k-list-item").nth(index);
    await humanClick(option);
}

/**
 * Clicks "Yes" on the "Are you sure?" confirmation dialog. The player is not
 * persisted here — only added to the modal's pending roster. The caller is
 * responsible for verifying the roster changed; the dialog may close
 * asynchronously on the live site.
 */
export async function confirmAddPlayer(page: Page): Promise<void> {
    const dialog = page.locator(".swal2-container");
    await dialog.waitFor({ state: "visible" });
    await humanClick(dialog.locator("button.swal2-confirm"));
}

/**
 * Dismisses the "Reservation Confirmed" screen shown after a successful save.
 * The site does not detach the edit modal on save — it swaps the form for this
 * confirmation view inside the same modal — so the save is only complete once
 * this is acknowledged via its Close button.
 */
export async function closeReservationConfirmation(page: Page): Promise<void> {
    const confirmation = page.getByTestId("reservation-confirm");
    await confirmation.waitFor({ state: "visible" });
    await humanClick(confirmation.getByTestId("Close"));
}

/**
 * Saves the reservation (persists the pending roster) and waits for the update
 * POST to succeed. The response body is opaque, so only the HTTP status is
 * checked; on success the edit modal is replaced by a "Reservation Confirmed"
 * screen, which is then dismissed. The caller re-reads the detail page to
 * confirm what persisted.
 */
export async function saveReservation(page: Page): Promise<void> {
    const responsePromise = page.waitForResponse(
        (response) =>
            response.url().includes(courtReserveUpdateMyReservationUrl) &&
            response.request().method() === "POST",
    );

    await humanClick(page.getByTestId("Save"));

    const response = await responsePromise;
    if (!response.ok()) {
        throw new Error(`Saving the reservation failed: ${response.status()} ${response.statusText()}`);
    }

    await closeReservationConfirmation(page);
}

export async function closeModal(page: Page): Promise<void> {
    await humanClick(page.getByTestId("Close"));
    await pauseForAction();
}
