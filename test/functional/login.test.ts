import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { BrowserContext, Page, chromium } from "playwright";
import { isLoggedIn, loginWithCredentials } from "../../src/login";
import { fixturePath } from "./setup";

const BOOKINGS_LIST_URL = "https://app.courtreserve.com/Online/Bookings/List/7031?type=1";
const BROWSER_TEST_TIMEOUT = 20_000;

/**
 * DOM coverage of the login primitives. The captured pages contain no
 * JavaScript, so `loginWithCredentials`'s post-submit redirect is simulated by
 * injecting a script that navigates on submit — the real submit is an Ant
 * Design XHR whose exact endpoint is only observable live.
 */
describe("functional: login", () => {
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

    describe("isLoggedIn", () => {
        it("returns true on the bookings list with no login button", async () => {
            await page.route("**/Online/Bookings/List/**", (route) =>
                route.fulfill({
                    body: readFileSync(fixturePath("one-booking-two-people.html"), "utf-8"),
                    contentType: "text/html",
                }),
            );

            await page.goto(BOOKINGS_LIST_URL);

            await expect(isLoggedIn(page)).resolves.toBe(true);
        });

        it("returns false when the LOG IN button is present", async () => {
            await page.route("**/Online/Bookings/List/**", (route) =>
                route.fulfill({
                    body: readFileSync(fixturePath("not-logged-in.html"), "utf-8"),
                    contentType: "text/html",
                }),
            );

            await page.goto(BOOKINGS_LIST_URL);

            await expect(isLoggedIn(page)).resolves.toBe(false);
        });

        it("returns false when redirected off the bookings list", async () => {
            await page.route("**/Online/Portal/Index/**", (route) =>
                route.fulfill({
                    body: readFileSync(fixturePath("not-logged-in.html"), "utf-8"),
                    contentType: "text/html",
                }),
            );

            await page.goto("https://app.courtreserve.com/Online/Portal/Index/7031");

            await expect(isLoggedIn(page)).resolves.toBe(false);
        });
    });

    describe("loginWithCredentials", () => {
        // Simulate the live JS submit (Ant Design XHR -> redirect) by baking a
        // script into the fulfilled login page. `loginWithCredentials` itself
        // re-navigates to the login URL, so the script must live in the served
        // body, not be injected afterwards.
        const loginWithRedirect = readFileSync(fixturePath("login-page.html"), "utf-8").replace(
            "</body>",
            `<script>
                document.querySelector("form").addEventListener("submit", (e) => {
                    e.preventDefault();
                    window.location.href = "/Online/Bookings/List/7031?type=1";
                });
            </script></body>`,
        );

        it("fills the email/password fields and submits", async () => {
            await page.route("**/Online/Account/LogIn/**", (route) =>
                route.fulfill({ body: loginWithRedirect, contentType: "text/html" }),
            );
            await page.route("**/Online/Bookings/List/**", (route) =>
                route.fulfill({ body: "<html><body>bookings</body></html>", contentType: "text/html" }),
            );

            await loginWithCredentials(page, "user@example.com", "hunter2");

            expect(page.url()).toContain("/Online/Bookings/List/");
            expect(await isLoggedIn(page)).toBe(true);
        }, BROWSER_TEST_TIMEOUT);

        it("reports invalid credentials when the page does not leave login", async () => {
            await page.route("**/Online/Account/LogIn/**", (route) =>
                route.fulfill({
                    body: readFileSync(fixturePath("login-page.html"), "utf-8"),
                    contentType: "text/html",
                }),
            );

            await page.goto("https://app.courtreserve.com/Online/Account/LogIn/7031");

            // No JS submit -> the page never navigates, so login times out.
            await expect(loginWithCredentials(page, "user@example.com", "wrong")).rejects.toThrow(
                /Login failed/,
            );
        }, BROWSER_TEST_TIMEOUT);
    });
});
