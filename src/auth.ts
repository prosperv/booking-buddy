import { BrowserContext, Page } from "playwright";
import { authPath, googleUrl } from "./constants";
import { pauseForAction, waitForEnter } from "./utils";
import { navigateTo } from "./navigation";
import { isLoggedIn } from "./login";

export async function manualLogin(context: BrowserContext, authPathOverride?: string): Promise<void> {
    const page = await context.newPage();
    await navigateTo(page, googleUrl, "Google page");
    await waitForEnter();
    const path = authPathOverride ?? authPath;
    await context.storageState({ path });
}

export async function restoreAuth(context: BrowserContext, authPathOverride?: string): Promise<void> {
    const path = authPathOverride ?? authPath;
    await context.setStorageState(path);
}

/**
 * Re-saves the context's storage state to `authPathOverride ?? authPath`, but
 * only when the session is still authenticated. Used on shutdown so a fresh
 * login's refreshed cookies are persisted, while a stale/expired session is
 * never written over a valid saved state. Returns whether the save happened.
 */
export async function saveAuthIfLoggedIn(
    context: BrowserContext,
    page: Page | undefined,
    authPathOverride?: string,
): Promise<boolean> {
    if (!page || page.isClosed()) {
        return false;
    }
    if (!(await isLoggedIn(page))) {
        return false;
    }
    await context.storageState({ path: authPathOverride ?? authPath });
    return true;
}
