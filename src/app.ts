import { authPath, port } from "./constants";
import { fileExists } from "./utils";
import { closeBrowserContext, openCourtReserve, openCourtReserveManualLogin } from "./courtReserve";

export async function start() {
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
    await closeBrowserContext();
    process.exit(0);
});
