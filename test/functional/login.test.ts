import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { Browser, Page } from "playwright";
import { isLoggedIn, loginWithCredentials } from "../../src/login";
import { connectSharedBrowser, fixturePath } from "./setup";

const BOOKINGS_LIST_URL = "https://app.courtreserve.com/Online/Bookings/List/7031?type=1";
const BROWSER_TEST_TIMEOUT = 20_000;

/**
 * DOM coverage of the login primitives. The captured pages contain no
 * JavaScript, so `loginWithCredentials`'s post-submit redirect is simulated by
 * injecting a script that navigates on submit — the real submit is an Ant
 * Design XHR whose exact endpoint is only observable live.
 *
 * The client's own `init()` / `ensureLoggedIn()` are not covered here: they
 * launch a persistent context against the live site. What these tests pin is the
 * sequence they are built from — detect the logged-out state, log in, and be on
 * the bookings list afterwards.
 */
describe("functional: login", () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
        browser = await connectSharedBrowser();
        page = await browser.newPage();
    });

    afterAll(async () => {
        await page.close();
        await browser.close();
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

        it("keeps the password out of the serialized page", async () => {
            // The login failure path logs at error, which snapshots the page to
            // log/failures/. `page.content()` serializes the `value` attribute,
            // and filling sets the input's value property rather than its
            // attribute, so a snapshot cannot leak the typed password. This
            // guards that reasoning against a future switch to a fill that
            // writes the attribute.
            const probeContext = await browser.newContext();
            const probePage = await probeContext.newPage();
            try {
                await probePage.route("**/Online/Account/LogIn/**", (route) =>
                    route.fulfill({
                        body: readFileSync(fixturePath("login-page.html"), "utf-8"),
                        contentType: "text/html",
                    }),
                );
                await probePage.goto("https://app.courtreserve.com/Online/Account/LogIn/7031");
                await probePage.locator('input[name="password"]').fill("sup3r-s3cret-value");

                expect(await probePage.content()).not.toContain("sup3r-s3cret-value");
            } finally {
                await probePage.close();
                await probeContext.close();
            }
        });
    });

    describe("session recovery", () => {
        // What `CourtReserveClient.ensureLoggedIn` does, minus the browser
        // launch: the bookings list bounces to the portal when the restored
        // session is stale, so the login state has to be re-checked and a
        // credential login has to leave the page back on the list.
        //
        // The simulated submit marks the redirect target, so the bookings-list
        // route can serve the logged-out page before the login and the
        // authenticated one after — the real site decides that server-side.
        const loginWithRedirect = readFileSync(fixturePath("login-page.html"), "utf-8").replace(
            "</body>",
            `<script>
                document.querySelector("form").addEventListener("submit", (e) => {
                    e.preventDefault();
                    window.location.href = "/Online/Bookings/List/7031?type=1&relogged=1";
                });
            </script></body>`,
        );

        const serveBookingsList = (target: Page) =>
            target.route("**/Online/Bookings/List/**", (route) =>
                route.fulfill({
                    body: readFileSync(
                        fixturePath(
                            route.request().url().includes("relogged=1")
                                ? "one-booking-two-people.html"
                                : "not-logged-in.html",
                        ),
                        "utf-8",
                    ),
                    contentType: "text/html",
                }),
            );

        it("recovers from a stale session with a credential login", async () => {
            await serveBookingsList(page);
            await page.route("**/Online/Account/LogIn/**", (route) =>
                route.fulfill({ body: loginWithRedirect, contentType: "text/html" }),
            );

            await page.goto(BOOKINGS_LIST_URL);
            await expect(isLoggedIn(page)).resolves.toBe(false);

            await loginWithCredentials(page, "user@example.com", "hunter2");

            await expect(isLoggedIn(page)).resolves.toBe(true);
        }, BROWSER_TEST_TIMEOUT);

        it("stays logged out when the credentials are wrong", async () => {
            await serveBookingsList(page);
            // The plain fixture, with no submit script: the page never leaves the
            // login URL, which is how a wrong password surfaces.
            await page.route("**/Online/Account/LogIn/**", (route) =>
                route.fulfill({
                    body: readFileSync(fixturePath("login-page.html"), "utf-8"),
                    contentType: "text/html",
                }),
            );

            await page.goto(BOOKINGS_LIST_URL);
            await expect(isLoggedIn(page)).resolves.toBe(false);
            await expect(loginWithCredentials(page, "user@example.com", "wrong")).rejects.toThrow(/Login failed/);
            await expect(isLoggedIn(page)).resolves.toBe(false);
        }, BROWSER_TEST_TIMEOUT);
    });
});
