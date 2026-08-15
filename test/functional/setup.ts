import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = resolve(__dirname, "..", "data");

export function fixturePath(name: string): string {
    return resolve(dataDir, name);
}

export async function loadFixture(page: import("playwright").Page, name: string): Promise<void> {
    const html = readFileSync(fixturePath(name), "utf-8");
    await page.setContent(html, { waitUntil: "domcontentloaded" });
}
