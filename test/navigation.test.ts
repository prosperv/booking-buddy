import { describe, expect, it, vi, afterEach } from "vitest";
import type { Page } from "playwright";
import { navigateTo } from "../src/navigation";
import { attachLogger } from "../src/log-context";
import type { Logger } from "../src/logger";

/**
 * The anti-bot pause is real time (1-3s by default); stub it so these tests
 * exercise the readiness/retry logic without the delay.
 */
vi.mock("../src/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/utils")>();
    return { ...actual, pauseForAction: vi.fn(async () => undefined) };
});

const READY = '[data-testid="booking-list-active"]';

type LogLine = { level: string; msg: string; fields?: Record<string, unknown> };

function recordingLogger(): { logger: Logger; lines: LogLine[] } {
    const lines: LogLine[] = [];
    const record =
        (level: string) =>
        (msg: string, fields?: Record<string, unknown>): void => {
            lines.push({ level, msg, fields });
        };
    return {
        lines,
        logger: {
            debug: record("debug"),
            info: record("info"),
            warn: record("warn"),
            error: record("error"),
            flush: () => undefined,
        },
    };
}

type FakePage = {
    page: Page;
    gotoCalls: { url: string; options?: Record<string, unknown> }[];
    waitForCalls: { state?: string; timeout?: number }[];
    selectors: string[];
    lines: LogLine[];
};

/**
 * `navigateTo` only touches `goto` and `locator().first().waitFor()/count()`,
 * so a plain stand-in page exercises every branch without launching Chromium.
 *
 * `count` is the "is the content actually there" probe: > 0 means the page is
 * usable and the timeout should be survivable.
 */
function fakePage(options: { count?: number; gotoError?: Error; readyError?: Error } = {}): FakePage {
    const gotoCalls: FakePage["gotoCalls"] = [];
    const waitForCalls: FakePage["waitForCalls"] = [];
    const selectors: string[] = [];
    const { logger, lines } = recordingLogger();

    const locator = {
        first: () => locator,
        waitFor: async (opts: { state?: string; timeout?: number }) => {
            waitForCalls.push(opts);
            if (options.readyError) {
                throw options.readyError;
            }
        },
        count: async () => options.count ?? 0,
    };

    const page = {
        goto: async (url: string, opts?: Record<string, unknown>) => {
            gotoCalls.push({ url, options: opts });
            if (options.gotoError) {
                throw options.gotoError;
            }
        },
        locator: (selector: string) => {
            selectors.push(selector);
            return locator;
        },
    } as unknown as Page;

    attachLogger(page, logger);

    return { page, gotoCalls, waitForCalls, selectors, lines };
}

const timeoutError = (): Error =>
    new Error('page.goto: Timeout 60000ms exceeded.\nCall log:\n  - navigating to "x", waiting until "commit"');

describe("navigateTo", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it("navigates with commit and waits for the caller's readiness selector", async () => {
        const fake = fakePage();

        await navigateTo(fake.page, "https://example.test/list", "List", READY);

        expect(fake.gotoCalls).toHaveLength(1);
        // `commit` is the point of the change: a stalled third-party subresource
        // must not be able to fail the navigation.
        expect(fake.gotoCalls[0].options).toEqual({ waitUntil: "commit", timeout: 60_000 });
        expect(fake.selectors).toEqual([READY]);
        expect(fake.waitForCalls).toEqual([{ state: "attached", timeout: 60_000 }]);
        expect(fake.lines).toHaveLength(0);
    });

    it("joins alternative readiness selectors into a single union selector", async () => {
        const fake = fakePage({ count: 1 });

        await navigateTo(fake.page, "https://example.test/list", "List", [
            '[data-testid="booking-list-active"]',
            'a[href*="/Online/Account/LogIn/"]',
        ]);

        expect(fake.selectors).toEqual([
            '[data-testid="booking-list-active"], a[href*="/Online/Account/LogIn/"]',
        ]);
    });

    it("continues when the content is on screen despite a timeout", async () => {
        const fake = fakePage({ gotoError: timeoutError(), count: 1 });

        await expect(
            navigateTo(fake.page, "https://example.test/list", "List", READY),
        ).resolves.toBeUndefined();

        const warned = fake.lines.filter((line) => line.level === "warn");
        expect(warned).toHaveLength(1);
        expect(warned[0].fields).toMatchObject({
            event: "navigate-timeout-continue",
            url: "https://example.test/list",
            label: "List",
            selector: READY,
        });
    });

    it("does not retry a page that is already usable", async () => {
        const fake = fakePage({ gotoError: timeoutError(), count: 1 });

        await navigateTo(fake.page, "https://example.test/list", "List", READY);

        expect(fake.gotoCalls).toHaveLength(1);
    });

    it("rethrows the original error when the content never appears", async () => {
        const error = timeoutError();
        const fake = fakePage({ gotoError: error, count: 0 });

        await expect(navigateTo(fake.page, "https://example.test/list", "List", READY)).rejects.toBe(
            error,
        );

        const warned = fake.lines.filter((line) => line.fields?.event === "navigate-timeout");
        expect(warned).toHaveLength(1);
        expect(warned[0].level).toBe("warn");
    });

    it("retries once by default before giving up", async () => {
        const fake = fakePage({ gotoError: timeoutError(), count: 0 });

        await expect(
            navigateTo(fake.page, "https://example.test/list", "List", READY),
        ).rejects.toBeDefined();

        expect(fake.gotoCalls).toHaveLength(2);
        expect(fake.lines.filter((line) => line.fields?.event === "navigate-retry")).toHaveLength(1);
    });

    it("honours NAV_RETRIES=0 by making a single attempt", async () => {
        vi.stubEnv("NAV_RETRIES", "0");
        vi.resetModules();
        const { navigateTo: fresh } = await import("../src/navigation");

        const fake = fakePage({ gotoError: timeoutError(), count: 0 });
        await expect(
            fresh(fake.page, "https://example.test/list", "List", READY),
        ).rejects.toBeDefined();

        expect(fake.gotoCalls).toHaveLength(1);
    });

    it("honours NAV_RETRIES=2 by making three attempts", async () => {
        vi.stubEnv("NAV_RETRIES", "2");
        vi.resetModules();
        const { navigateTo: fresh } = await import("../src/navigation");

        const fake = fakePage({ gotoError: timeoutError(), count: 0 });
        await expect(
            fresh(fake.page, "https://example.test/list", "List", READY),
        ).rejects.toBeDefined();

        expect(fake.gotoCalls).toHaveLength(3);
    });

    it("honours NAV_TIMEOUT_MS for both the navigation and the readiness wait", async () => {
        vi.stubEnv("NAV_TIMEOUT_MS", "1234");
        vi.resetModules();
        const { navigateTo: fresh } = await import("../src/navigation");

        const fake = fakePage();
        await fresh(fake.page, "https://example.test/list", "List", READY);

        expect(fake.gotoCalls[0].options).toEqual({ waitUntil: "commit", timeout: 1234 });
        expect(fake.waitForCalls).toEqual([{ state: "attached", timeout: 1234 }]);
    });

    it("recovers when a retry finds the page", async () => {
        let attempt = 0;
        const locator = {
            first: () => locator,
            waitFor: async (opts: { state?: string; timeout?: number }) => {
                if (attempt === 0) {
                    throw timeoutError();
                }
            },
            count: async () => 0,
        };
        const gotoCalls: unknown[] = [];
        const page = {
            goto: async () => {
                attempt += 1;
                gotoCalls.push(attempt);
                if (attempt === 1) {
                    throw timeoutError();
                }
            },
            locator: () => locator,
        } as unknown as Page;

        await expect(navigateTo(page, "https://example.test/list", "List", READY)).resolves.toBeUndefined();
        expect(gotoCalls).toHaveLength(2);
    });
});