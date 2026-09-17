import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { attachLogger } from "../src/log-context";
import { captureFailure } from "../src/capture";
import { createLogger } from "../src/logger";

/**
 * `captureFailure` only needs a `content()` method from the page and a capture
 * dir from the log-context registry, so plain stand-in objects exercise it
 * without launching Chromium.
 */
const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-buddy-capture-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function fakePage(html: string): Page {
    return { content: async () => html } as unknown as Page;
}

describe("captureFailure", () => {
    it("writes an HTML snapshot and returns its path when a capture dir is attached", async () => {
        const dir = makeTempDir();
        const page = fakePage("<html><body>boom</body></html>");
        attachLogger(page, createLogger({ console: false }), dir);

        const snapshot = await captureFailure(page);

        expect(snapshot).toBeTypeOf("string");
        const files = fs.readdirSync(dir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^failure-.*\.html$/);
        expect(fs.readFileSync(snapshot!, "utf8")).toBe("<html><body>boom</body></html>");
    });

    it("returns undefined when no capture dir is attached", async () => {
        await expect(captureFailure(fakePage("<html></html>"))).resolves.toBeUndefined();
    });

    it("returns undefined (no throw) when page.content() fails", async () => {
        const dir = makeTempDir();
        const page = {
            content: async () => {
                throw new Error("page gone");
            },
        } as unknown as Page;
        attachLogger(page, createLogger({ console: false }), dir);

        await expect(captureFailure(page)).resolves.toBeUndefined();
    });
});
