import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `launchPersistentContext` is the one place Chromium's launch flags are
 * decided, and its only observable output is the argument bag — so these tests
 * mock Playwright entirely and read the flags back. No browser is launched.
 */

const { launchPersistentContext } = vi.hoisted(() => ({ launchPersistentContext: vi.fn() }));

vi.mock("playwright", () => ({ chromium: { launchPersistentContext } }));

/**
 * The anti-bot pause is real time (1-3s by default); stub it so these tests
 * exercise the flag handling without the delay.
 */
vi.mock("../src/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/utils")>();
    return { ...actual, pauseForAction: vi.fn(async () => undefined) };
});

type LaunchOptions = { headless: boolean; viewport: null; args: string[] };

/** The stub stands in for a `BrowserContext`; `attachPendingTracking` only needs these three. */
function fakeContext() {
    return { setDefaultNavigationTimeout: vi.fn(), pages: () => [], on: vi.fn() };
}

/**
 * Launches with `PLAYWRIGHT_DEBUG_PORT` set to `value` (`undefined` = unset)
 * and returns the flags Chromium was given. `src/constants.ts` reads the
 * environment at import time, so each case resets the module registry and
 * re-imports to pick the new value up.
 */
async function launchWithPort(value: string | undefined): Promise<LaunchOptions> {
    vi.resetModules();
    if (value === undefined) {
        delete process.env.PLAYWRIGHT_DEBUG_PORT;
    } else {
        process.env.PLAYWRIGHT_DEBUG_PORT = value;
    }

    launchPersistentContext.mockResolvedValue(fakeContext());
    const browser = await import("../src/browser");
    await browser.launchPersistentContext(true);

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    const options = launchPersistentContext.mock.calls[0][1] as LaunchOptions;
    return options;
}

beforeEach(() => {
    launchPersistentContext.mockReset();
});

afterEach(() => {
    delete process.env.PLAYWRIGHT_DEBUG_PORT;
});

describe("launchPersistentContext", () => {
    it("passes no extra Chromium flags when no debug port is configured", async () => {
        expect((await launchWithPort(undefined)).args).toEqual([]);
    });

    it("passes no flags when the debug port is blank", async () => {
        // dotenv yields "" for a valueless `PLAYWRIGHT_DEBUG_PORT=` line. The
        // guard is a truthiness check rather than `??`, so blank stays off
        // instead of becoming `--remote-debugging-port=`.
        expect((await launchWithPort("")).args).toEqual([]);
    });

    it("opens the debug port when PLAYWRIGHT_DEBUG_PORT is set", async () => {
        expect((await launchWithPort("9222")).args).toEqual(["--remote-debugging-port=9222"]);
    });

    it("still forwards headless and the null viewport alongside the flags", async () => {
        const options = await launchWithPort("9222");
        expect(options.headless).toBe(true);
        expect(options.viewport).toBeNull();
    });
});