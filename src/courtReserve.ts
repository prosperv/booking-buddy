import { chromium, BrowserContext, Page } from "playwright";
import fs from "node:fs/promises";
import {
    authPath,
    courtReserveMyReservationsUrl,
    googleUrl,
    profileDir,
    headless,
} from "./constants";
import { pauseForAction, waitForEnter } from "./utils";
import { collectBookingSessions, getBookingsFound } from "./booking";

let context: BrowserContext | undefined;

export async function openCourtReserveManualLogin() {
    context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: null,
    });

    const page = await context.newPage();
    await pauseForAction();
    await page.goto(googleUrl, { waitUntil: "domcontentloaded" });
    await pauseForAction();
    console.log(`Opened Google page at ${googleUrl}`);
    await waitForEnter();
    await context.storageState({ path: authPath });
    return { page, context };
}

export async function openCourtReserveDummy() {
    context = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: null,
    });
    context.setStorageState(authPath);

    const page = await context.newPage();
    await pauseForAction();
    const htmlContent = await fs.readFile("./courtreserve_myreservation.html", "utf-8");
    await page.setContent(htmlContent, { waitUntil: "domcontentloaded" });
    await pauseForAction();
    console.log(`Loaded local HTML from ./courtreserve_myreservation.html`);
    await waitForEnter();
    return { page, context };
}

export async function openCourtReserve() {
    await fs.readFile(authPath, "utf-8");
    context = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: null,
    });
    context.setStorageState(authPath);

    const page = await context.newPage();
    await pauseForAction();
    await page.goto(courtReserveMyReservationsUrl, { waitUntil: "domcontentloaded" });
    await pauseForAction();
    console.log(`Opened CourtReserve page at ${courtReserveMyReservationsUrl}`);
    await page.pause();

    const bookingCount = await getBookingsFound(page);
    console.log(`Found ${bookingCount} bookings.`);
    await page.pause();

    const bookingSessions = await collectBookingSessions(page);
    console.log(`Collected ${bookingSessions.length} booking sessions.`);

    return { page, context };
}

export async function closeBrowserContext(): Promise<void> {
    if (context) {
        await context.close().catch(() => undefined);
        context = undefined;
    }
}
