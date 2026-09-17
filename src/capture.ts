import fs from "node:fs";
import path from "node:path";
import dayjs from "dayjs";
import type { Page } from "playwright";
import { captureDirFor } from "./log-context";

/**
 * Captures an HTML snapshot of the page's current DOM to disk, for diagnosing
 * a failure after the fact. The destination is the page's capture directory
 * (see `captureDirFor`); when none is attached the capture is disabled and
 * this resolves to `undefined`.
 *
 * Any error while capturing (page gone, content unavailable, disk full) is
 * swallowed and reported as `undefined` — a failed snapshot must never mask the
 * original failure it was meant to record.
 *
 * Returns the absolute path of the written file, or `undefined` when disabled
 * or capture failed.
 */
export async function captureFailure(page: Page): Promise<string | undefined> {
    const dir = captureDirFor(page);
    if (!dir) return undefined;

    try {
        const html = await page.content();
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `failure-${dayjs().format("YYYY-MM-DDTHH-mm-ss-SSS")}.html`);
        fs.writeFileSync(filePath, html, "utf8");
        return filePath;
    } catch {
        return undefined;
    }
}
