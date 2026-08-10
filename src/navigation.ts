import { Page } from "playwright";
import { pauseForAction } from "./utils";

export async function navigateTo(page: Page, url: string, label: string): Promise<void> {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await pauseForAction();
    console.log(`Opened ${label} at ${url}`);
}
