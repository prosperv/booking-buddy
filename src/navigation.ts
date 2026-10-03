import { Page } from "playwright";
import { navRetries, navTimeoutMs } from "./constants";
import { loggerFor } from "./log-context";
import { pendingRequests } from "./pending-requests";
import { pauseForAction } from "./utils";

/**
 * Navigates to `url` and waits for the content the caller actually needs.
 *
 * Readiness is a caller-supplied CSS selector (or a list of alternatives, any
 * one of which satisfies the wait), never `DOMContentLoaded`: CourtReserve's
 * pages carry deferred third-party scripts and webfont stylesheets, and a
 * stalled one of those holds `domcontentloaded` open for minutes even though
 * the document is fully parsed and on screen. `commit` resolves on response
 * headers, so a stalled subresource cannot fail the navigation — only the
 * readiness wait can.
 *
 * Two escape hatches keep a slow-but-usable page from failing the caller: a
 * retry, and a probe that proceeds as soon as the requested content is actually
 * on screen (logged at `warn`, so it stays visible). The probe runs *before*
 * each retry, so a page that renders late is accepted the moment it appears
 * rather than after the whole budget twice over. Only a genuinely absent page
 * rethrows, and the original error is preserved for the caller to log.
 */
export async function navigateTo(
    page: Page,
    url: string,
    label: string,
    ready: string | string[],
): Promise<void> {
    const selector = Array.isArray(ready) ? ready.join(", ") : ready;
    const target = page.locator(selector).first();
    let lastError: unknown;

    for (let attempt = 1; attempt <= navRetries + 1; attempt += 1) {
        try {
            await page.goto(url, { waitUntil: "commit", timeout: navTimeoutMs });
            await target.waitFor({ state: "attached", timeout: navTimeoutMs });
            await pauseForAction();
            return;
        } catch (err) {
            lastError = err;
            if ((await target.count()) > 0) {
                loggerFor(page).warn("navigation timed out, continuing with the content on screen", {
                    event: "navigate-timeout-continue",
                    label,
                    url,
                    selector,
                    pending: pendingRequests(page),
                });
                await pauseForAction();
                return;
            }
            if (attempt <= navRetries) {
                loggerFor(page).debug("navigation failed, retrying", {
                    event: "navigate-retry",
                    label,
                    url,
                    selector,
                    attempt,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }

    loggerFor(page).warn("navigation timed out", {
        event: "navigate-timeout",
        label,
        url,
        selector,
        pending: pendingRequests(page),
        message: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw lastError;
}
