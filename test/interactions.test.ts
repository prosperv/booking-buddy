import { describe, expect, it } from "vitest";
import { isTransientClickError } from "../src/interactions";

/**
 * This classification decides whether a failed click is retried or surfaced.
 * Retrying too eagerly turns a fast, loud failure into a slow silent stall;
 * retrying too little leaves a race to fail a run. It is the only part of the
 * retry that can be pinned without a browser and a live re-render, so it is
 * pinned here rather than left to a live run.
 */
describe("isTransientClickError", () => {
    // The real failure that cost two courts, verbatim apart from the call log.
    const DETACHED =
        'locator.scrollIntoViewIfNeeded: Element is not attached to the DOM\nCall log:\n  - attempting scroll into view action\n    2 × waiting for element to be stable\n      - element is not visible';

    it("treats a detached element as transient", () => {
        expect(isTransientClickError(DETACHED)).toBe(true);
    });

    it("treats an unstable element as transient", () => {
        expect(isTransientClickError("element is not stable")).toBe(true);
    });

    it("treats a not-visible element as transient", () => {
        expect(isTransientClickError("element is not visible")).toBe(true);
    });

    it("treats an intercepted click as transient, which is the same detach symptom", () => {
        expect(isTransientClickError(
            "element intercepts pointer events\nCall log: - attempting click action",
        )).toBe(true);
    });

    it("is case-insensitive, since the wording comes from Playwright internals", () => {
        expect(isTransientClickError("ELEMENT IS NOT ATTACHED TO THE DOM")).toBe(true);
    });

    it("does not retry a timeout waiting for something absent", () => {
        // Retrying this would cost 3x the wall clock and still fail: the button
        // is not going to appear.
        expect(
            isTransientClickError("locator.waitFor: Timeout 30000ms exceeded waiting for getByTestId('Save')"),
        ).toBe(false);
    });

    it("does not retry an element that resolves to nothing", () => {
        expect(isTransientClickError('locator.click: Error: strict mode violation: locator("tr") resolved to 0 elements')).toBe(
            false,
        );
    });

    it("does not retry a navigation or protocol error", () => {
        expect(isTransientClickError("net::ERR_CONNECTION_RESET")).toBe(false);
    });

    it("does not treat an empty message as transient", () => {
        expect(isTransientClickError("")).toBe(false);
    });
});