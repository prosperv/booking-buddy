export const port = Number(process.env.PORT ?? 3000);
export const courtReserveUrl = "https://app.courtreserve.com/";
export const courtReserveOrgId = process.env.COURTRESERVE_ORG_ID ?? "7031";
export const courtReserveMyReservationsUrl =
    `${courtReserveUrl}Online/Bookings/List/${courtReserveOrgId}?type=1`;
export const courtReserveUpdateMyReservationUrl =
    `${courtReserveUrl}Online/Reservations/UpdateMyReservation/${courtReserveOrgId}`;
export const googleUrl = "https://www.google.com/";
export const authPath = process.env.AUTH_PATH ?? "./auth.json";
export const profileDir = process.env.PROFILE_DIR ?? "./my-profile";
export const headless = process.env.HEADLESS !== "false";
export const minActionDelay = Number(process.env.MIN_ACTION_DELAY_MS ?? 1000);
export const maxActionDelay = Number(process.env.MAX_ACTION_DELAY_MS ?? 3000);
