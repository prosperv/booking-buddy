import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { BrowserContext, Page, chromium } from "playwright";
import {
    closeReservationConfirmation,
    confirmAddPlayer,
    openEditReservationModal,
    openReservationDetail,
    readDetailPlayers,
    readModalPlayers,
    readPlayerOptions,
    reservationDetailUrl,
    selectPlayerOption,
    typePlayerSearch,
} from "../../src/players";
import { fixturePath, loadFixture } from "./setup";

const BROWSER_TEST_TIMEOUT = 20_000;

/**
 * Per-state DOM coverage of the add-player step functions. The captured MHTML
 * pages contain no JavaScript, so these exercise locators and state reads
 * only — the interactive Kendo ComboBox / sweetalert2 chain (and the member
 * search XHR) must be validated against the live site.
 */
describe("functional: add-player steps", () => {
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

    describe("openReservationDetail", () => {
        it("navigates to the detail URL and waits for the edit button", async () => {
            let requestedUrl = "";
            await page.route("**/Online/MyProfile/Reservation/**", async (route) => {
                requestedUrl = route.request().url();
                await route.fulfill({
                    body: readFileSync(fixturePath("reservation-detail.html"), "utf-8"),
                    contentType: "text/html",
                });
            });

            await openReservationDetail(page, "58800347");

            expect(requestedUrl).toBe(reservationDetailUrl("58800347"));
            expect(await page.getByTestId("btn-update-reservation").isVisible()).toBe(true);
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("openEditReservationModal", () => {
        it("clicks Edit Reservation and returns the modal locator", async () => {
            await loadFixture(page, "edit-modal.html");

            const modal = await openEditReservationModal(page);

            expect(await modal.isVisible()).toBe(true);
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("readModalPlayers", () => {
        it("reads the pending roster from the modal", async () => {
            await loadFixture(page, "edit-modal.html");

            const players = await readModalPlayers(page.getByTestId("update-reservation-modal"));

            expect(players).toHaveLength(3);
            expect(players[0]).toBe("Prosper Van");
            expect(players).toContain("Peter Nguyen ??");
        });

        it("sees the added player after confirmation", async () => {
            await loadFixture(page, "player-added.html");

            const players = await readModalPlayers(page.getByTestId("update-reservation-modal"));

            expect(players).toHaveLength(4);
            expect(players).toContain("Brandon Luu");
        });
    });

    describe("readDetailPlayers", () => {
        it("reads the persisted roster from the detail page", async () => {
            await loadFixture(page, "reservation-detail.html");

            const players = await readDetailPlayers(page);

            expect(players).toHaveLength(3);
            expect(players[0]).toBe("Prosper Van");
        });
    });

    describe("typePlayerSearch", () => {
        it("types a query into the owners combobox", async () => {
            await loadFixture(page, "edit-modal.html");
            const modal = page.getByTestId("update-reservation-modal");

            await typePlayerSearch(modal, "Brandon");

            expect(await modal.locator('input[name="OwnersDropdown_input"]').inputValue()).toBe(
                "Brandon",
            );
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("readPlayerOptions", () => {
        it("reads the visible dropdown options in order", async () => {
            await loadFixture(page, "player-options.html");

            const options = await readPlayerOptions(page);

            expect(options).toHaveLength(11);
            expect(options[0]).toBe("Brandon Chau");
            expect(options).toContain("Brandon Luu");
        });

        it("returns an empty list when the dropdown shows no data", async () => {
            await loadFixture(page, "no-player-options.html");

            await expect(readPlayerOptions(page)).resolves.toEqual([]);
        });
    });

    describe("selectPlayerOption", () => {
        it("clicks the option at the given index", async () => {
            await loadFixture(page, "player-options.html");

            await expect(selectPlayerOption(page, 5)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("confirmAddPlayer", () => {
        it("clicks Yes on the confirmation dialog", async () => {
            await loadFixture(page, "confirm-dialog.html");

            await expect(confirmAddPlayer(page)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("closeReservationConfirmation", () => {
        it("waits for the confirmation modal and clicks Close", async () => {
            await loadFixture(page, "reservation-confirmed.html");

            const confirmation = page.getByTestId("reservation-confirm");
            expect(await confirmation.isVisible()).toBe(true);
            expect(await confirmation.getByTestId("title").textContent()).toContain(
                "Reservation Confirmed",
            );

            await expect(closeReservationConfirmation(page)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);
    });
});
