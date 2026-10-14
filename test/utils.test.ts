import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { delay, fileExists, randomDelay } from "../src/index";

const tempPath = resolve(process.cwd(), "test/temp-file.txt");

describe("utility helpers", () => {
    afterEach(async () => {
        try {
            await fs.rm(tempPath);
        } catch {
            // ignore
        }
        vi.useRealTimers();
    });

    it("randomDelay returns values within the inclusive range", () => {
        const min = 10;
        const max = 20;
        for (let i = 0; i < 100; i += 1) {
            const value = randomDelay(min, max);
            expect(value).toBeGreaterThanOrEqual(min);
            expect(value).toBeLessThanOrEqual(max);
        }
    });

    it("delay resolves after the requested time", async () => {
        vi.useFakeTimers();
        const waited = delay(200);
        vi.advanceTimersByTime(200);
        await expect(waited).resolves.toBeUndefined();
    });

    it("fileExists returns true for created files and false for missing files", async () => {
        await fs.writeFile(tempPath, "hello");
        expect(await fileExists(tempPath)).toBe(true);
        await fs.rm(tempPath);
        expect(await fileExists(tempPath)).toBe(false);
    });
});
