import { chromium, BrowserContext } from "playwright";
import { profileDir } from "./constants";
import { pauseForAction } from "./utils";

export async function launchPersistentContext(headless: boolean): Promise<BrowserContext> {
    const context = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: null,
    });
    await pauseForAction();
    return context;
}

export async function closeBrowserContext(context: BrowserContext): Promise<void> {
    await context.close().catch(() => undefined);
}
