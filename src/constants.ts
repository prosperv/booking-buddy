export const port = Number(process.env.PORT ?? 3000);
export const courtReserveUrl = "https://app.courtreserve.com/";
export const courtReserveOrgId = process.env.COURTRESERVE_ORG_ID ?? "7031";
export const courtReserveMyReservationsUrl =
    `${courtReserveUrl}Online/Bookings/List/${courtReserveOrgId}?type=1`;
export const courtReserveLoginUrl =
    `${courtReserveUrl}Online/Account/LogIn/${courtReserveOrgId}`;
export const courtReserveUpdateMyReservationUrl =
    `${courtReserveUrl}Online/Reservations/UpdateMyReservation/${courtReserveOrgId}`;
export const googleUrl = "https://www.google.com/";
export const authPath = process.env.AUTH_PATH ?? "./auth.json";
export const profileDir = process.env.PROFILE_DIR ?? "./my-profile";
// No `??` default here: absence is the signal that unattended login is not
// configured, and `??` would turn a blank value into a real username/password.
export const courtreserveUsername = process.env.COURTRESERVE_USERNAME;
export const courtreservePassword = process.env.COURTRESERVE_PASSWORD;
export const headless = process.env.HEADLESS !== "false";
// Opens a Chrome DevTools Protocol port on the launched browser, so a run can be
// inspected from another machine (`http://localhost:9222`) or driven over a real
// display (`DISPLAY=:99` + x11vnc) on a headless host. Chromium binds the port
// to loopback, so it is reachable only through an SSH tunnel. Unset in normal
// runs; read with a truthiness check, never `??`, so a blank value — which
// dotenv produces for a valueless `PLAYWRIGHT_DEBUG_PORT=` line — stays off
// instead of becoming `--remote-debugging-port=`.
export const playwrightDebugPort = process.env.PLAYWRIGHT_DEBUG_PORT;
export const minActionDelay = Number(process.env.MIN_ACTION_DELAY_MS ?? 1000);
export const maxActionDelay = Number(process.env.MAX_ACTION_DELAY_MS ?? 3000);
// Budget for a single navigation: the `goto` itself plus the wait for the
// caller-supplied readiness selector (see src/navigation.ts). CourtReserve's
// list page pulls third-party resources that occasionally stall for far longer
// than Playwright's 30s default, so the default here is deliberately larger.
export const navTimeoutMs = Number(process.env.NAV_TIMEOUT_MS ?? 60_000);
export const navRetries = Number(process.env.NAV_RETRIES ?? 1);
// Budget for the bookings list to fill in after its container appears. The
// container and its cards are rendered separately, so scraping on the container
// alone can read an empty list that looks exactly like an account with no
// bookings. Deliberately short and separate from the navigation budget: this
// is a short local render, not a network wait, and a changed-markup state
// should fall through to counting rather than burn a whole navigation timeout.
export const bookingListPopulateMs = Number(process.env.BOOKING_LIST_TIMEOUT_MS ?? 10_000);
// How long to wait for the save POST to answer before calling the save
// unconfirmed. Explicit rather than inherited from Playwright's default action
// timeout, because the consequence of hitting it is now a reported
// `save-unconfirmed` rather than a thrown failure — a number worth being able
// to tune per host.
export const saveTimeoutMs = Number(process.env.SAVE_TIMEOUT_MS ?? 30_000);
