import { chromium, BrowserContext } from "playwright";
import { navTimeoutMs, profileDir } from "./constants";
import { attachPendingTracking } from "./pending-requests";
import { pauseForAction } from "./utils";

export async function launchPersistentContext(
    headless: boolean,
    profileDirOverride?: string,
): Promise<BrowserContext> {
    const context = await chromium.launchPersistentContext(profileDirOverride ?? profileDir, {
        headless,
        viewport: null,
    });
    // Covers any navigation that doesn't pass its own budget, and gives every
    // page in the context the same ceiling. Action timeouts are left at
    // Playwright's defaults on purpose — clicks and modal waits are a
    // different budget.
    context.setDefaultNavigationTimeout(navTimeoutMs);
    attachPendingTracking(context);
    await pauseForAction();
    return context;
}

export async function closeBrowserContext(context: BrowserContext): Promise<void> {
    await context.close().catch(() => undefined);
}
