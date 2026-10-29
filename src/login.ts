import { Page } from "playwright";
import { courtReserveLoginUrl } from "./constants";
import { humanClick } from "./interactions";
import { loggerFor } from "./log-context";
import { navigateTo } from "./navigation";

/**
 * How long to wait for the login submit to redirect the page off the login
 * URL. The login form is submitted by JavaScript (Ant Design `onFinish`), so
 * success is detected by navigation rather than a network response; this is
 * the bounded wait before we report bad credentials.
 */
const LOGIN_REDIRECT_TIMEOUT_MS = 10_000;

/**
 * The portal's "LOG IN" link. Exported because it doubles as a navigation
 * readiness signal: the bookings list redirects here when the session is
 * stale, so its presence means "the portal rendered, login required" rather
 * than "the page never arrived".
 */
export const LOGIN_LINK_SELECTOR = 'a[href*="/Online/Account/LogIn/"]';

/**
 * True when the page is on the authenticated bookings list. CourtReserve
 * redirects unauthenticated visitors off the bookings list to the portal
 * home, which renders a "LOG IN" button linking to `/Online/Account/LogIn/`.
 * Both signals are checked: the presence of that button, and whether the URL
 * is still the bookings list.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
    if (!page.url().includes("/Online/Bookings/List/")) {
        loggerFor(page).debug("login state", { event: "login-state", loggedIn: false, reason: "not-on-bookings-list" });
        return false;
    }
    const loginButton = page.locator(LOGIN_LINK_SELECTOR);
    const loggedIn = (await loginButton.count()) === 0;
    loggerFor(page).debug("login state", { event: "login-state", loggedIn });
    return loggedIn;
}

/**
 * Logs in with email/password credentials. The login form is JS-submitted (no
 * `action` attribute), so the submit is followed by waiting for the page to
 * navigate away from the login URL; a timeout is reported as invalid
 * credentials. The caller is responsible for re-saving the storage state and
 * re-navigating to the bookings list.
 */
export async function loginWithCredentials(
    page: Page,
    username: string,
    password: string,
): Promise<void> {
    await navigateTo(page, courtReserveLoginUrl, "CourtReserve Login", 'input[name="email"]');
    loggerFor(page).info("navigate to login", { event: "navigate", url: courtReserveLoginUrl });

    await page.locator('input[name="email"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    loggerFor(page).info("click Continue (submit login)", { event: "click", target: "Continue", username });
    await humanClick(page.getByTestId("Continue"));

    try {
        await page.waitForURL(
            (url) => !url.href.includes("/Online/Account/LogIn/"),
            { timeout: LOGIN_REDIRECT_TIMEOUT_MS },
        );
    } catch {
        loggerFor(page).error("login failed", { event: "login-failed", username });
        throw new Error("Login failed: the page did not leave the login screen (bad credentials?).");
    }
    loggerFor(page).info("login submitted", { event: "login-submitted", username });
}

/**
 * Reads the display name of the currently logged-in member from the bookings
 * list's account menu (`#my-account-li-web`). CourtReserve renders that menu
 * only for an authenticated session, so its absence (logged-out page, trimmed
 * fixture, or a layout change) yields `undefined` rather than throwing — the
 * caller logs `user: null` and continues.
 *
 * The id is the site's own hook for the "My Account" dropdown; the
 * `[data-testid="19_link"]` selector is the fallback for pages where the id is
 * missing but the testid survives.
 */
export async function getLoggedInUserName(page: Page): Promise<string | undefined> {
    const locator = page.locator('#my-account-li-web span, [data-testid="19_link"] span').first();
    try {
        await locator.waitFor({ state: "attached", timeout: 2000 });
    } catch {
        loggerFor(page).debug("logged-in user name not found", { event: "login-user", found: false });
        return undefined;
    }
    const text = (await locator.textContent())?.trim();
    if (!text) {
        loggerFor(page).debug("logged-in user name not found", { event: "login-user", found: false });
        return undefined;
    }
    loggerFor(page).debug("logged-in user name", { event: "login-user", name: text });
    return text;
}
