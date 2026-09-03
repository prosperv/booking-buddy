import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import { saveAuthIfLoggedIn } from "../../src/auth";
import { fixturePath } from "./setup";

const BOOKINGS_LIST_URL = "https://app.courtreserve.com/Online/Bookings/List/7031?type=1";

describe("functional: saveAuthIfLoggedIn", () => {
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    let dir: string;

    const authFile = (): string => join(dir, "auth.json");

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext();
        page = await context.newPage();
        dir = await mkdtemp(join(tmpdir(), "auth-save-test-"));
    });

    afterAll(async () => {
        await browser.close();
        await rm(dir, { recursive: true, force: true });
    });

    const serveFixture = (name: string) =>
        page.route("**/Online/**", (route) =>
            route.fulfill({
                body: readFileSync(fixturePath(name), "utf-8"),
                contentType: "text/html",
            }),
        );

    it("saves auth when the page is still logged in", async () => {
        await serveFixture("one-booking-two-people.html");
        await page.goto(BOOKINGS_LIST_URL);

        const saved = await saveAuthIfLoggedIn(context, page, authFile());

        expect(saved).toBe(true);
        expect(existsSync(authFile())).toBe(true);
    });

    it("does not save when the LOG IN button is present", async () => {
        const path = authFile();
        await rm(path, { force: true });

        await serveFixture("not-logged-in.html");
        await page.goto(BOOKINGS_LIST_URL);

        const saved = await saveAuthIfLoggedIn(context, page, path);

        expect(saved).toBe(false);
        expect(existsSync(path)).toBe(false);
    });

    it("does not save when redirected off the bookings list", async () => {
        const path = authFile();
        await rm(path, { force: true });

        await page.goto("https://app.courtreserve.com/Online/Portal/Index/7031");

        const saved = await saveAuthIfLoggedIn(context, page, path);

        expect(saved).toBe(false);
        expect(existsSync(path)).toBe(false);
    });

    it("does not save when there is no page", async () => {
        const path = authFile();
        await rm(path, { force: true });

        const saved = await saveAuthIfLoggedIn(context, undefined, path);

        expect(saved).toBe(false);
        expect(existsSync(path)).toBe(false);
    });
});
