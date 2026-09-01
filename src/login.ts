import { Page } from "playwright";
import { courtReserveLoginUrl } from "./constants";
import { humanClick } from "./interactions";
import { navigateTo } from "./navigation";

/**
 * How long to wait for the login submit to redirect the page off the login
 * URL. The login form is submitted by JavaScript (Ant Design `onFinish`), so
 * success is detected by navigation rather than a network response; this is
 * the bounded wait before we report bad credentials.
 */
const LOGIN_REDIRECT_TIMEOUT_MS = 10_000;

/**
 * True when the page is on the authenticated bookings list. CourtReserve
 * redirects unauthenticated visitors off the bookings list to the portal
 * home, which renders a "LOG IN" button linking to `/Online/Account/LogIn/`.
 * Both signals are checked: the presence of that button, and whether the URL
 * is still the bookings list.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
    if (!page.url().includes("/Online/Bookings/List/")) {
        return false;
    }
    const loginButton = page.locator('a[href*="/Online/Account/LogIn/"]');
    return (await loginButton.count()) === 0;
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
    await navigateTo(page, courtReserveLoginUrl, "CourtReserve Login");

    await page.locator('input[name="email"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await humanClick(page.getByTestId("Continue"));

    try {
        await page.waitForURL(
            (url) => !url.href.includes("/Online/Account/LogIn/"),
            { timeout: LOGIN_REDIRECT_TIMEOUT_MS },
        );
    } catch {
        throw new Error("Login failed: the page did not leave the login screen (bad credentials?).");
    }
}
