import { Locator, Page, type Response } from "playwright";
import { courtReserveOrgId, courtReserveUrl, courtReserveUpdateMyReservationUrl, saveTimeoutMs } from "./constants";
import { captureFailure } from "./capture";
import { humanClick } from "./interactions";
import { loggerFor } from "./log-context";
import { memberSearchRecords } from "./member-search";
import { navigateTo } from "./navigation";
import { delay, pauseForAction } from "./utils";

/**
 * Per-character delay used while typing into the Kendo ComboBox. The member
 * search is a remote datasource; a single bulk `fill()` may collapse to one
 * input event that the widget's debounce drops. A short per-key pause is more
 * reliable and looks more human. Kept small on purpose — it is not the
 * anti-bot pacing (see `pauseForAction`).
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
 * `memberId` is the CourtReserve id behind the name, read from the member
 * search the page already made (see `src/member-search.ts`). It is optional
 * because the payload is optional: when it is missing — the endpoint changed, or
 * the page made no search — every option simply has no id and matching falls
 * back to names.
 */
export type MemberOption = {
    /** The name as rendered in the dropdown, which is what gets clicked and logged. */
    displayName: string;
    /** CourtReserve `MemberId`, when the search payload could be paired with the rendered options. */
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
 * known so the caller can put one in `nameMap` and be done. This is the
 * intended way to find an id: run the bot, read the ambiguity, copy the number.
 */
function describeCandidates(options: MemberOption[], matches?: MemberOption[]): string[] {
    const chosen = matches ?? options;
    return chosen.map((o) =>
        o.memberId === undefined ? o.displayName : `${o.displayName} (id ${o.memberId})`,
    );
}

/**
 * Resolves a search query against the dropdown options. An exact
 * (case-insensitive, junk-stripped) match always wins over a substring match,
 * so searching "Lee Zii Jia" picks "Lee Zii Jia" rather than "Lee Zii Jiaa".
 *
 * A `memberId` short-circuits all of that. The club has members whose names are
 * identical on CourtReserve, and against those no amount of string matching can
 * tell the search results apart — the case-insensitive server match returns both
 * every time. An id is the one thing that identifies a person, so when the
 * caller supplies it, that is the answer, and a name that does not even appear
 * in the results does not make it wrong.
 *
 * An id that is not among the results is reported as `id-not-found` rather than
 * falling back to names: quietly booking a same-named stranger is exactly the
 * outcome the id was configured to prevent.
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
 * Clicks "Edit Reservation" and waits for the AJAX modal to attach. Returns a
 * locator scoped to the modal so later steps never leak onto the page behind
 * it (both surfaces carry a `players-table`, but with different inner testids).
 */
export async function openEditReservationModal(page: Page): Promise<Locator> {
    const editReservationButton = page.getByTestId("btn-update-reservation");
    loggerFor(page).info("click Edit Reservation", { event: "click", target: "Edit Reservation" });
    await humanClick(editReservationButton);

    const modal = page.getByTestId("update-reservation-modal");
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
 * Player names from the edit modal's pending roster (`player-fullname`).
 */
export async function readModalPlayers(modal: Locator): Promise<string[]> {
    return modal
        .locator('[data-testid="member-table"] [data-testid="player-fullname"]')
        .allTextContents()
        .then((names) => {
            const players = names.map((n) => n.replace(/\s+/g, " ").trim());
            loggerFor(modal.page()).debug("roster read", {
                event: "roster-read",
                source: "modal",
                count: players.length,
                players,
            });
            return players;
        });
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

    loggerFor(modal.page()).info("click remove member", {
        event: "click",
        target: "remove member",
        name: match.name,
    });
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
        .then((names) => {
            const players = names.map((n) => n.replace(/\s+/g, " ").trim());
            loggerFor(page).debug("roster read", {
                event: "roster-read",
                source: "detail",
                count: players.length,
                players,
            });
            return players;
        });
}

export async function typePlayerSearch(modal: Locator, name: string): Promise<void> {
    loggerFor(modal.page()).info("typed search", { event: "typed-search", name });
    const input = modal.locator('input[name="OwnersDropdown_input"]');
    await input.press("ControlOrMeta+A");
    await input.press("Delete");
    await input.pressSequentially(name, { delay: TYPING_DELAY_MS });
}

/**
 * Empties the member-search box and takes the focus off it.
 *
 * `typePlayerSearch` clears the box at the *start* of a search, so the last one
 * of a run is always left behind — and a search that fails (ambiguous, not
 * found) leaves the widget's dropdown open on top of it. Clicking Save in that
 * state is not what the save button would get in a hand-driven session, and the
 * save POST has been observed not to complete: a run whose last add failed as
 * ambiguous logged `player-failed ambiguous` and `click Save` in the same second,
 * then timed out waiting for the response with the courts unchanged.
 *
 * Best effort throughout — the input is not always present, and failing to clear
 * an input that is already empty is not a reason to abandon a save. `Tab` blurs
 * without the risk `Escape` carries of dismissing the modal itself.
 */
export async function clearMemberSearch(modal: Locator): Promise<void> {
    try {
        const input = modal.locator('input[name="OwnersDropdown_input"]');
        await input.press("ControlOrMeta+A", { timeout: 1000 });
        await input.press("Delete", { timeout: 1000 });
        await input.press("Tab", { timeout: 1000 });
        loggerFor(modal.page()).debug("cleared member search", { event: "search-cleared" });
    } catch {
        // Nothing to clear, or the widget is gone: carry on.
    }
}

/**
 * Waits until the member-search dropdown shows either options or an explicit
 * "no data" state, then returns the visible option names in order.
 */
/**
 * Reads the member-search dropdown as `MemberOption`s: the rendered names,
 * enriched with the ids behind them when the page's own member-search payload
 * can be paired with the rendered list.
 *
 * Options are paired to records by the `data-offset-index` the widget puts on
 * each item — its own statement of which record it is — never by position, and
 * only when the counts agree exactly. A mismatch means the payload is for a
 * different search, or the endpoint changed shape, and an id paired to the wrong
 * name would book the wrong person; withholding the ids there costs only the
 * ability to disambiguate same-named members. The rendered names remain the
 * source of truth either way.
 */
export async function readPlayerOptions(page: Page): Promise<MemberOption[]> {
    try {
        await page.waitForFunction(() => {
            const input = document.querySelector<HTMLInputElement>('input[name="OwnersDropdown_input"]');
            const busy = input?.getAttribute("aria-busy") === "true";
            const items = document.querySelectorAll("#OwnersDropdown_listbox li.k-list-item");
            const noData = document.querySelector("#OwnersDropdown-list .k-no-data");
            if (busy) return false;
            return items.length > 0 || (noData !== null && getComputedStyle(noData).display !== "none");
        });
    } catch (err) {
        const snapshot = await captureFailure(page);
        loggerFor(page).error(`member-search dropdown did not appear: ${err instanceof Error ? err.message : err}`, {
            event: "member-search-timeout",
            message: err instanceof Error ? err.message : String(err),
            snapshot,
        });
        throw err;
    }

    const rendered = await page
        .locator("#OwnersDropdown_listbox li.k-list-item")
        .evaluateAll((els) =>
            els.map((el) => ({
                displayName: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
                offset: el.getAttribute("data-offset-index"),
            })),
        );

    const records = memberSearchRecords(page);
    const pairable =
        records !== undefined &&
        records.length === rendered.length &&
        rendered.every((o) => o.offset !== null && Number.isInteger(Number(o.offset)));

    const options: MemberOption[] = rendered.map((o, i) => {
        const record = pairable ? records[Number(o.offset)] : undefined;
        const memberId = record?.MemberId;
        return memberId === undefined
            ? { displayName: o.displayName }
            : { displayName: o.displayName, memberId };
    });

    const logger = loggerFor(page);
    if (options.length === 0) {
        logger.debug("member-search results", { event: "member-search", count: 0, options: [] });
    } else {
        logger.debug("member-search results", {
            event: "member-search",
            count: options.length,
            // Ids are logged only when they were paired, so a `false` here is a
            // legible signal that the payload was missing rather than a gap.
            idsResolved: pairable,
            options: options.map((o) => (o.memberId === undefined ? o.displayName : `${o.displayName} (${o.memberId})`)),
        });
    }
    return options;
}

export async function selectPlayerOption(page: Page, index: number): Promise<void> {
    const option = page.locator("#OwnersDropdown_listbox li.k-list-item").nth(index);
    loggerFor(page).info("click player option", { event: "click", target: "player option", index });
    await humanClick(option);
}

/**
 * Polls the modal's pending roster until `name` appears (normalized exact
 * match, so the site's trailing "?" and whitespace differences don't matter).
 * The confirm handler appends the member client-side and can be slightly
 * async, so a short bounded poll is more reliable than a one-shot read.
 * Returns false when the name never shows up within `timeoutMs`.
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
 * Clicks "Yes" on the "Are you sure?" confirmation dialog. The player is not
 * persisted here — only added to the modal's pending roster. The caller is
 * responsible for verifying the roster changed; the dialog may close
 * asynchronously on the live site.
 */
export async function confirmAddPlayer(page: Page): Promise<void> {
    const dialog = page.locator(".swal2-container");
    try {
        await dialog.waitFor({ state: "visible" });
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
    await humanClick(dialog.locator("button.swal2-confirm"));
}

/**
 * Dismisses the "Reservation Confirmed" screen if one appears after a
 * successful save. The site does not detach the edit modal on save — it swaps
 * the form for this confirmation view inside the same modal — but only when
 * the detail page was reached directly (empty `document.referrer`). When the
 * page was navigated to, the site instead redirects away and no confirmation
 * is shown, so this waits a bounded time and silently returns if it never
 * appears.
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
 * Saves the reservation (persists the pending roster) and waits for the update
 * POST to succeed. The response body is opaque, so only the HTTP status is
 * checked; on success the edit modal is replaced by a "Reservation Confirmed"
 * screen, which is then dismissed. The caller re-reads the detail page to
 * confirm what persisted.
 */
/**
 * Clicks Save and reports whether the save was **confirmed**.
 *
 * `false` means the POST was never observed, which is not the same as the save
 * having failed: the site sometimes answers on a connection the bot has already
 * given up on, and the caller re-reads the reservation afterwards either way.
 * The distinction matters because the two demand opposite handling — a confirmed
 * save can be reported as done, while an unconfirmed one can only be reported as
 * unknown and left for the next run to settle from a freshly loaded page. It
 * does not justify skipping the remaining courts, which used to cost a whole
 * session because one court's save went unobserved.
 *
 * A response that *arrives* but is not ok still throws: that is a real failure
 * with a real status, and treating it as "unknown" would bury it.
 */
export async function saveReservation(page: Page): Promise<boolean> {
    const responsePromise = page.waitForResponse(
        (response) =>
            response.url().includes(courtReserveUpdateMyReservationUrl) &&
            response.request().method() === "POST",
        { timeout: saveTimeoutMs },
    );

    loggerFor(page).info("click Save", { event: "click", target: "Save" });
    await humanClick(page.getByTestId("Save"));

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
    await humanClick(page.getByTestId("Close"));
    await pauseForAction();
}
