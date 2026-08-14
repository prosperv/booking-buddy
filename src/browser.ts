import { chromium, BrowserContext } from "playwright";
import { profileDir } from "./constants";
import { pauseForAction } from "./utils";

export async function launchPersistentContext(
    headless: boolean,
    profileDirOverride?: string,
): Promise<BrowserContext> {
    const context = await chromium.launchPersistentContext(profileDirOverride ?? profileDir, {
        headless,
        viewport: null,
    });
    await pauseForAction();
    return context;
}

export async function closeBrowserContext(context: BrowserContext): Promise<void> {
    await context.close().catch(() => undefined);
}
