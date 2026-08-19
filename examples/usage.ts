import { CourtReserveClient } from "../src";

async function main() {
    const forceLogin = process.argv.includes("--force") || process.argv.includes("-f");

    const client = new CourtReserveClient({
        headless: false,
        manualLogin: forceLogin,
    });
    await client.init();
    const bookings = await client.getCurrentBookings();
    console.log(bookings.map(b => ({
        ...b,
        startTime: b.startTime.toString(),
        endTime: b.endTime.toString(),
    })));
    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
