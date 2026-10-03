import { BrowserContext, Page, Request } from "playwright";

/**
 * In-flight request tracker, used to explain *why* a navigation timed out.
 *
 * A `waitUntil: "commit"` navigation resolves on response headers, so the only
 * thing that can still stall is the caller's readiness wait — and on
 * CourtReserve's pages that is almost always a third-party subresource (a
 * deferred module script, a webfont stylesheet) holding `DOMContentLoaded` or a
 * selector open. Logging the URLs still outstanding at the moment of failure
 * turns "the page took too long" into a named request.
 *
 * A `WeakMap` keyed by `Page`, matching `src/log-context.ts`: pages come and go
 * with their context, and two clients in one process must not share state.
 * Untracked pages simply report nothing pending.
 */
const pendingByPage = new WeakMap<Page, Set<string>>();

/**
 * How many outstanding URLs to report. A stalled page can have dozens open
 * (beacons, fonts, preconnects); the first few are enough to identify the
 * culprit and this keeps a single log line readable.
 */
const MAX_REPORTED = 20;

/**
 * Starts tracking in-flight requests for every page in `context`, including
 * pages created later (`context.on("page")` fires for `newPage()`). Safe to
 * call once per context; `attachPendingTracking` is the only writer.
 */
export function attachPendingTracking(context: BrowserContext): void {
    for (const page of context.pages()) {
        trackPage(page);
    }
    context.on("page", trackPage);
}

function trackPage(page: Page): void {
    const pending = new Set<string>();
    pendingByPage.set(page, pending);

    page.on("request", (request: Request) => {
        pending.add(request.url());
    });
    const settle = (request: Request) => {
        pending.delete(request.url());
    };
    page.on("requestfinished", settle);
    page.on("requestfailed", settle);
}

/**
 * URLs still outstanding for `page`, oldest first, capped at `MAX_REPORTED`.
 * Returns an empty array for a page that was never tracked.
 */
export function pendingRequests(page: Page): string[] {
    const pending = pendingByPage.get(page);
    if (!pending) {
        return [];
    }
    return [...pending].slice(0, MAX_REPORTED);
}