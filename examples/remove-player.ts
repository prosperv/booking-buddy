import { CourtReserveClient } from "../src";

async function main() {
    const forceLogin = process.argv.includes("--force") || process.argv.includes("-f");
    const playerName = process.argv[2];

    if (!playerName) {
        console.error("Usage: npx tsx examples/remove-player.ts <player-name> [--force]");
        process.exit(1);
    }

    const client = new CourtReserveClient({
        headless: false,
        manualLogin: forceLogin,
    });
    await client.init();

    const bookings = await client.getCurrentBookings();
    const booking = bookings[0];
    if (!booking) {
        console.log("No bookings found.");
        await client.close();
        return;
    }

    const result = await client.removePlayerFromBooking(booking, { name: playerName });
    console.log(JSON.stringify(result, null, 2));

    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
