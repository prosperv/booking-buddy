import { readFileSync } from "fs";
import { chromium } from "playwright";
import { inject } from "vitest";
import { resolve } from "path";

const dataDir = resolve(process.cwd(), "test/data");

export function fixturePath(name: string): string {
    return resolve(dataDir, name);
}

export async function loadFixture(page: import("playwright").Page, name: string): Promise<void> {
    const html = readFileSync(fixturePath(name), "utf-8");
    await page.setContent(html, { waitUntil: "domcontentloaded" });
}


export async function connectSharedBrowser(): Promise<import("playwright").Browser> {
    const endpoint = inject("wsEndpoint");
    if (!endpoint) {
        throw new Error(
            "No shared browser endpoint: this file must run under the `functional` vitest project.",
        );
    }
    return chromium.connect(endpoint);
}
