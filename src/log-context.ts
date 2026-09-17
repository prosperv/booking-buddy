import { BrowserContext, Page } from "playwright";
import { createLogger, type Logger } from "./logger";

/**
 * Per-page registry. The `CourtReserveClient` owns its `Logger`, but the
 * low-level action/feedback helpers (`humanClick`, `navigateTo`, `readModalPlayers`,
 * …) only ever receive a `Page` or `Locator` — never the logger. A `WeakMap`
 * keyed by `Page` lets those helpers look up the logger in scope without
 * threading a `logger` parameter through every signature or reaching for global
 * mutable state (a module singleton would collide across two clients in one
 * process).
 *
 * Each entry also carries the page's capture directory (where failure HTML
 * snapshots are written, see `src/capture.ts`), so a helper can snapshot the
 * DOM on error without knowing anything about the client's logging layout.
 *
 * Pages that are never attached (e.g. the ones the functional tests build
 * directly) fall back to a silent no-op logger and no capture dir, so the
 * helpers keep working — and keep their existing signatures — when no client is
 * involved.
 */
type PageContext = { logger: Logger; captureDir?: string };

const pageContexts = new WeakMap<Page, PageContext>();

const silent: Logger = createLogger({ console: false });

/**
 * Associates `logger` (and optionally `captureDir`) with `page`. The client
 * attaches its logger to every page in its context (see
 * `attachLoggerToContext`), so each helper that resolves a page — via
 * `loggerFor` — logs through the client's own destination.
 */
export function attachLogger(page: Page, logger: Logger, captureDir?: string): void {
    pageContexts.set(page, { logger, captureDir });
}

/**
 * Returns the logger attached to `page`, or a silent no-op logger when none was
 * attached. Helpers call this with `page` (or `locator.page()`) and log
 * unconditionally; without a client there is simply nothing to write to.
 */
export function loggerFor(page: Page): Logger {
    return pageContexts.get(page)?.logger ?? silent;
}

/**
 * Returns the capture directory attached to `page`, or `undefined` when none
 * was attached. Failure snapshotting is disabled without it.
 */
export function captureDirFor(page: Page): string | undefined {
    return pageContexts.get(page)?.captureDir;
}

/**
 * Attaches `logger` (and `captureDir`) to every page in `context` — both the
 * pages that already exist and any created later (`context.on("page")` fires
 * for `newPage()`). This covers the client's main page, the throwaway
 * edit-modal pages, and the manual-login page in one call.
 */
export function attachLoggerToContext(
    context: BrowserContext,
    logger: Logger,
    captureDir?: string,
): void {
    for (const page of context.pages()) {
        attachLogger(page, logger, captureDir);
    }
    context.on("page", (page) => attachLogger(page, logger, captureDir));
}
