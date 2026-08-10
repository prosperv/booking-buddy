import { BrowserContext } from "playwright";
import { authPath, googleUrl } from "./constants";
import { pauseForAction, waitForEnter } from "./utils";
import { navigateTo } from "./navigation";

export async function manualLogin(context: BrowserContext, authPathOverride?: string): Promise<void> {
    const page = await context.newPage();
    await navigateTo(page, googleUrl, "Google page");
    await waitForEnter();
    const path = authPathOverride ?? authPath;
    await context.storageState({ path });
}

export async function restoreAuth(context: BrowserContext, authPathOverride?: string): Promise<void> {
    const path = authPathOverride ?? authPath;
    context.setStorageState(path);
}
