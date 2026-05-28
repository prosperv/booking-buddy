import { chromium, BrowserContext, Page } from "playwright";
import fs from "node:fs/promises";

const port = process.env.PORT ?? 3000;
const courtReserveUrl = "https://app.courtreserve.com/";
const courtReserveMyReservationsUrl =
    "https://app.courtreserve.com/Online/Bookings/List/7031?type=1";
const googleUrl = "https://www.google.com/";
const authPath = process.env.AUTH_PATH ?? "./auth.json";
const profileDir = process.env.PROFILE_DIR ?? "./my-profile";
const headless = process.env.HEADLESS !== "false";
const minActionDelay = Number(process.env.MIN_ACTION_DELAY_MS ?? 400);
const maxActionDelay = Number(process.env.MAX_ACTION_DELAY_MS ?? 2000);
let context: BrowserContext | undefined;

type BookingSession = {
    startTime: Date; // e.g. "18:00"
    endTime: Date; // e.g. "19:00"
    courtNumber: number; // e.g. 1
    courtLocation: string; // e.g. "Redmond"
    page: Page; // Playwright page instance for this booking session
}

function randomDelay(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pauseForAction() {
    const waitMs = randomDelay(minActionDelay, maxActionDelay);
    await delay(waitMs);
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

async function waitForEnter(): Promise<void> {
    console.log("Press Enter after you have logged in successfully.");
    return new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.once("data", () => {
            process.stdin.pause();
            resolve();
        });
    });
}

// This function is used when there is no existing auth state. It opens the Google homepage first to allow the user to log in and save their auth state, which can then be reused for CourtReserve.
async function openCourtReserveManualLogin() {
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

function getBookingsFound(page: Page): number {
    // Check for number of bookings
    // const bookingCount = await page.getByTestId('booking-count').textContent();
    const text = await page.getByText("Booking Found").innerText();
    const match = text.match(/(\d+)/);
    const count = match ? Number(match[1]) : 0;

    return count;
}

function

async function openCourtReserve() {
    const storageState = JSON.parse(await fs.readFile(authPath, "utf-8"));
    context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: null,
    });
    context.setStorageState(authPath);

    const page = await context.newPage();

    await pauseForAction();
    await page.goto(courtReserveUrl, { waitUntil: "domcontentloaded" });
    await pauseForAction();
    console.log(`Opened CourtReserve page at ${courtReserveUrl}`);
    await page.pause();
    return { page, context };
}

async function openCourtReserveDummy() {
    const storageState = JSON.parse(await fs.readFile(authPath, "utf-8"));
    context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
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

async function editBooking(page: Page) {
    const editReservationbutton = page.getByTestId('details-btn');

    await editReservationbutton.scrollIntoViewIfNeeded();
    await editReservationbutton.hover();

    const box = await editReservationbutton.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    
    pauseForAction();

    // await editReservationbutton.click();
    await page.mouse.down();
    await page.mouse.up();
}

async function start() {
    console.log(`Court Sign-Up service starting on port ${port}...`);

    const hasSavedAuth = await fileExists(authPath);
    if (!hasSavedAuth) {
        console.log(`No existing auth state found at ${authPath}. Will require manual login.`);
        await openCourtReserveManualLogin();
    } else {
        console.log(`Found existing auth state at ${authPath}. Will attempt to use it.`);
        await openCourtReserve();
    }

    console.log("Browser automation initialized. Press Ctrl+C to stop.");
}

start().catch((error) => {
    console.error("Failed to open CourtReserve login page:", error);
    process.exit(1);
});

process.on("SIGINT", async () => {
    console.log("Shutting down gracefully...");
    if (context) {
        await context.close().catch(() => undefined);
    }
    process.exit(0);
});
