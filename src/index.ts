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
// Exporting utility functions for testing purposes
export { randomDelay, delay, fileExists };

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

async function getBookingsFound(page: Page): Promise<number> {
    // Check for number of bookings
    // const bookingCount = await page.getByTestId('booking-count').textContent();
    const text = await page.getByText("Booking Found").innerText();
    const match = text.match(/(\d+)/);
    const count = match ? Number(match[1]) : 0;

    return count;
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
    if (!box) {
        throw new Error("Could not determine edit button position.");
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    
    await pauseForAction();
    // await editReservationbutton.click();
    await page.mouse.down();
    await page.mouse.up();
}

async function convertBookingCardToBookingSession(bookingCard: Locator): Promise<BookingSession> {
    // Get locations
    const typename = await bookingCard.getByTestId("type-name").textContent();

    // Get start and end times. and date
    // Example text: "Sat, Jun 13th, 10:30 AM - 12:00 PM"
    const datetimeText = (await bookingCard.getByTestId("row-date-and-times").textContent()) ?? "";

    // Remove ordinal suffixes (st, nd, rd, th)
    const cleaned = datetimeText.replace(/(\d+)(st|nd|rd|th)/, "$1");

    // Split into date part + time range
    const [weekday, monthDay, times] = cleaned.split(",");
    const datePart = `${weekday.trim()}, ${monthDay.trim()}`; // "Sat, Jun 13"

    // Split start/end times
    const [startTime, endTime] = times.trim().split(" - ");

    // Build full datetime strings
    const startString = `${datePart}, ${startTime}`;
    const endString = `${datePart}, ${endTime}`;

    // Parse using Day.js
    const start = dayjs(startString, "ddd, MMM D, h:mm A");
    const end = dayjs(endString, "ddd, MMM D, h:mm A");

    // Get day of week
    const dayOfWeek = weekday.trim();

    // Get court number. Extract from "Redmond 6"
    const locationAndCourt = (await bookingCard.getByTestId("row-courts").textContent()) ?? "";
    const courtNumber = Number(locationAndCourt.split(" ").pop() ?? "0");
    const location = locationAndCourt.split(" ").slice(0, -1).join(" ");

    // Get players. Ex. "Prosper Van, Xi S Chen"
    const playersText = (await bookingCard.getByTestId("row-members").textContent()) ?? "";
    const players = playersText ? playersText.split(",").map((player) => player.trim()) : [];

    return {
        dayOfWeek,
        startTime: start.toDate(),
        endTime: end.toDate(),
        courtNumber,
        courtLocation: location,
        players,
        page: bookingCard.page(),
    };
}

async function collectBookingSessions(page: Page): Promise<BookingSession[]> {
    const bookingCard = page.getByTestId("booking-card");
    const count = await bookingCard.count();
    const bookingSessions: BookingSession[] = [];

    for (let i = 0; i < count; i++) {
        bookingSessions.push(await convertBookingCardToBookingSession(bookingCard.nth(i)));
    }

    return bookingSessions;
}

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

    // testing
    const bookingCount = await getBookingsFound(page);
    console.log(`Found ${bookingCount} bookings.`);
    await page.pause();

    const bookingSessions = await collectBookingSessions(page);
    console.log(`Collected ${bookingSessions.length} booking sessions.`);

    return { page, context };
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

if (require.main === module) {
start().catch((error) => {
    console.error("Failed to open CourtReserve login page:", error);
    process.exit(1);
});
}

process.on("SIGINT", async () => {
    console.log("Shutting down gracefully...");
    if (context) {
        await context.close().catch(() => undefined);
    }
    process.exit(0);
});
