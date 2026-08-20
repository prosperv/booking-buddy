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
    removeMemberFromModal,
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
                    body: readFileSync(fixturePath("adding-player/reservation-detail.html"), "utf-8"),
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
            await loadFixture(page, "adding-player/edit-modal.html");

            const modal = await openEditReservationModal(page);

            expect(await modal.isVisible()).toBe(true);
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("readModalPlayers", () => {
        it("reads the pending roster from the modal", async () => {
            await loadFixture(page, "adding-player/edit-modal.html");

            const players = await readModalPlayers(page.getByTestId("update-reservation-modal"));

            expect(players).toHaveLength(3);
            expect(players[0]).toBe("Viktor Axelsen");
            expect(players).toContain("Kento Momota ??");
        });

        it("sees the added player after confirmation", async () => {
            await loadFixture(page, "adding-player/player-added.html");

            const players = await readModalPlayers(page.getByTestId("update-reservation-modal"));

            expect(players).toHaveLength(4);
            expect(players).toContain("Lee Zii Jiaa");
        });
    });

    describe("readDetailPlayers", () => {
        it("reads the persisted roster from the detail page", async () => {
            await loadFixture(page, "adding-player/reservation-detail.html");

            const players = await readDetailPlayers(page);

            expect(players).toHaveLength(3);
            expect(players[0]).toBe("Viktor Axelsen");
        });
    });

    describe("typePlayerSearch", () => {
        it("types a query into the owners combobox", async () => {
            await loadFixture(page, "adding-player/edit-modal.html");
            const modal = page.getByTestId("update-reservation-modal");

            await typePlayerSearch(modal, "Lee Zii");

            expect(await modal.locator('input[name="OwnersDropdown_input"]').inputValue()).toBe(
                "Lee Zii",
            );
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("readPlayerOptions", () => {
        it("reads the visible dropdown options in order", async () => {
            await loadFixture(page, "adding-player/player-options.html");

            const options = await readPlayerOptions(page);

            expect(options).toHaveLength(11);
            expect(options[0]).toBe("Lee Zii Chau");
            expect(options).toContain("Lee Zii Jiaa");
        });

        it("returns an empty list when the dropdown shows no data", async () => {
            await loadFixture(page, "adding-player/no-player-options.html");

            await expect(readPlayerOptions(page)).resolves.toEqual([]);
        });
    });

    describe("selectPlayerOption", () => {
        it("clicks the option at the given index", async () => {
            await loadFixture(page, "adding-player/player-options.html");

            await expect(selectPlayerOption(page, 5)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("confirmAddPlayer", () => {
        it("clicks Yes on the confirmation dialog", async () => {
            await loadFixture(page, "adding-player/confirm-dialog.html");

            await expect(confirmAddPlayer(page)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);
    });

    describe("closeReservationConfirmation", () => {
        it("waits for the confirmation modal and clicks Close", async () => {
            await loadFixture(page, "adding-player/reservation-confirmed.html");

            const confirmation = page.getByTestId("reservation-confirm");
            expect(await confirmation.isVisible()).toBe(true);
            expect(await confirmation.getByTestId("title").textContent()).toContain(
                "Reservation Confirmed",
            );

            await expect(closeReservationConfirmation(page)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);

        it("resolves without throwing when no confirmation page appears", async () => {
            await loadFixture(page, "adding-player/reservation-detail.html");

            await expect(closeReservationConfirmation(page)).resolves.toBeUndefined();
        }, BROWSER_TEST_TIMEOUT);
    });
});

describe("functional: remove-player steps", () => {
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

    describe("readModalPlayers", () => {
        it("reads the full roster from the modal", async () => {
            await loadFixture(page, "removing-player/modal-player-list.html");

            const players = await readModalPlayers(page.getByTestId("update-reservation-modal"));

            expect(players).toHaveLength(5);
            expect(players[0]).toBe("Viktor Axelsen");
            expect(players).toContain("Kento Momota ??");
        });

        it("sees the removed player is gone after removal", async () => {
            await loadFixture(page, "removing-player/modal-player-removed.html");

            const players = await readModalPlayers(page.getByTestId("update-reservation-modal"));

            expect(players).toHaveLength(4);
            expect(players).not.toContain("Kento Momota ??");
        });
    });

    describe("removeMemberFromModal", () => {
        it("removes a player from the roster", async () => {
            await loadFixture(page, "removing-player/modal-player-list.html");
            const modal = page.getByTestId("update-reservation-modal");

            await expect(removeMemberFromModal(modal, "Kento Momota")).resolves.toEqual({
                status: "removed",
                name: "Kento Momota ??",
            });
        }, BROWSER_TEST_TIMEOUT);

        it("reports a player who is not on the roster", async () => {
            await loadFixture(page, "removing-player/modal-player-list.html");
            const modal = page.getByTestId("update-reservation-modal");

            await expect(removeMemberFromModal(modal, "Zed")).resolves.toEqual({
                status: "not-found",
                name: "Zed",
            });
        }, BROWSER_TEST_TIMEOUT);

        it("reports the reservation owner as not removable", async () => {
            await loadFixture(page, "removing-player/modal-player-list.html");
            const modal = page.getByTestId("update-reservation-modal");

            await expect(removeMemberFromModal(modal, "Viktor Axelsen")).resolves.toEqual({
                status: "not-removable",
                name: "Viktor Axelsen",
            });
        }, BROWSER_TEST_TIMEOUT);
    });
});
