import { readFileSync } from "fs";
import { resolve } from "path";

const dataDir = resolve(process.cwd(), "test/data");

export function fixturePath(name: string): string {
    return resolve(dataDir, name);
}

export async function loadFixture(page: import("playwright").Page, name: string): Promise<void> {
    const html = readFileSync(fixturePath(name), "utf-8");
    await page.setContent(html, { waitUntil: "domcontentloaded" });
}
