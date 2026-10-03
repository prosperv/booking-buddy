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
export const headless = process.env.HEADLESS !== "false";
export const minActionDelay = Number(process.env.MIN_ACTION_DELAY_MS ?? 1000);
export const maxActionDelay = Number(process.env.MAX_ACTION_DELAY_MS ?? 3000);
// Budget for a single navigation: the `goto` itself plus the wait for the
// caller-supplied readiness selector (see src/navigation.ts). CourtReserve's
// list page pulls third-party resources that occasionally stall for far longer
// than Playwright's 30s default, so the default here is deliberately larger.
export const navTimeoutMs = Number(process.env.NAV_TIMEOUT_MS ?? 60_000);
export const navRetries = Number(process.env.NAV_RETRIES ?? 1);
