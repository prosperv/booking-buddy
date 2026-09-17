import { describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { createLogger } from "../src/logger";
import { attachLogger, attachLoggerToContext, loggerFor } from "../src/log-context";

/**
 * `attachLogger` / `loggerFor` only use the `Page` as a WeakMap key, so plain
 * stand-in objects exercise the registry without launching Chromium.
 */
function fakePage(): Page {
    return {} as Page;
}

describe("loggerFor", () => {
    it("returns a silent no-op logger for an unattached page", () => {
        const logger = loggerFor(fakePage());

        expect(() => {
            logger.info("unattached");
            logger.flush();
        }).not.toThrow();
    });

    it("returns the logger attached to a page", () => {
        const page = fakePage();
        const logger = createLogger({ console: false });

        attachLogger(page, logger);

        expect(loggerFor(page)).toBe(logger);
    });

    it("keeps loggers scoped per page", () => {
        const first = fakePage();
        const second = fakePage();
        const firstLogger = createLogger({ console: false });
        const secondLogger = createLogger({ console: false });

        attachLogger(first, firstLogger);
        attachLogger(second, secondLogger);

        expect(loggerFor(first)).toBe(firstLogger);
        expect(loggerFor(second)).toBe(secondLogger);
    });
});

describe("attachLoggerToContext", () => {
    it("attaches to existing pages and to pages created later", () => {
        const existing = fakePage();
        let onPage: ((page: Page) => void) | undefined;
        const context = {
            pages: () => [existing],
            on: (event: string, handler: (page: Page) => void) => {
                if (event === "page") onPage = handler;
            },
        } as unknown as BrowserContext;

        const logger = createLogger({ console: false });
        attachLoggerToContext(context, logger);

        expect(loggerFor(existing)).toBe(logger);

        const future = fakePage();
        onPage?.(future);
        expect(loggerFor(future)).toBe(logger);
    });
});
