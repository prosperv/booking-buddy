import { describe, expect, it } from "vitest";
import type { BrowserContext, Page, Request } from "playwright";
import { attachPendingTracking, pendingRequests } from "../src/pending-requests";

/**
 * `attachPendingTracking` only uses the `Page` as a WeakMap key and listens for
 * request lifecycle events, so plain stand-ins exercise it without launching
 * Chromium.
 */
function fakePage(): { page: Page; emit: (event: string, request: { url: () => string }) => void } {
    const listeners = new Map<string, (request: { url: () => string }) => void>();
    const page = {
        on: (event: string, handler: (request: { url: () => string }) => void) => {
            listeners.set(event, handler);
        },
    } as unknown as Page;

    return {
        page,
        emit: (event, request) => {
            const handler = listeners.get(event);
            if (!handler) {
                throw new Error(`no listener registered for "${event}"`);
            }
            handler(request);
        },
    };
}

function fakeContext(pages: Page[]): { context: BrowserContext; addPage: (page: Page) => void } {
    const pageListeners: ((page: Page) => void)[] = [];
    const context = {
        pages: () => pages,
        on: (event: string, handler: (page: Page) => void) => {
            if (event === "page") {
                pageListeners.push(handler);
            }
        },
    } as unknown as BrowserContext;

    return {
        context,
        addPage: (page) => pageListeners.forEach((handler) => handler(page)),
    };
}

const request = (url: string): Request => ({ url: () => url }) as unknown as Request;

describe("pendingRequests", () => {
    it("reports nothing for a page that was never tracked", () => {
        expect(pendingRequests({} as Page)).toEqual([]);
    });

    it("lists requests that are still in flight", () => {
        const fake = fakePage();
        attachPendingTracking(fakeContext([fake.page]).context);

        fake.emit("request", request("https://app.courtreserve.com/ClientApp/bundle.js"));
        fake.emit("request", request("https://static.cloudflareinsights.com/beacon.min.js"));

        expect(pendingRequests(fake.page)).toEqual([
            "https://app.courtreserve.com/ClientApp/bundle.js",
            "https://static.cloudflareinsights.com/beacon.min.js",
        ]);
    });

    it("drops requests that finished or failed", () => {
        const fake = fakePage();
        attachPendingTracking(fakeContext([fake.page]).context);

        fake.emit("request", request("https://app.courtreserve.com/fast.js"));
        fake.emit("request", request("https://app.courtreserve.com/slow.js"));
        fake.emit("requestfinished", request("https://app.courtreserve.com/fast.js"));
        fake.emit("requestfailed", request("https://app.courtreserve.com/slow.js"));

        expect(pendingRequests(fake.page)).toEqual([]);
    });

    it("tracks pages created after the context was set up", () => {
        const { context, addPage } = fakeContext([]);
        attachPendingTracking(context);

        const later = fakePage();
        addPage(later.page);
        later.emit("request", request("https://app.courtreserve.com/late.js"));

        expect(pendingRequests(later.page)).toEqual(["https://app.courtreserve.com/late.js"]);
    });

    it("caps the reported list so one log line stays readable", () => {
        const fake = fakePage();
        attachPendingTracking(fakeContext([fake.page]).context);

        for (let i = 0; i < 50; i += 1) {
            fake.emit("request", request(`https://app.courtreserve.com/${i}.js`));
        }

        expect(pendingRequests(fake.page)).toHaveLength(20);
    });
});