import { CourtReserveClient } from "../src";

async function main() {
    const forceLogin = process.argv.includes("--force") || process.argv.includes("-f");

    const names = process.argv
        .slice(2)
        .filter((arg) => !arg.startsWith("-"))
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

    if (names.length === 0) {
        console.error('Usage: npx tsx examples/add-player.ts "<player name>" [<player name> ...] [--force]');
        process.exit(1);
    }

    const client = new CourtReserveClient({
        headless: false,
        manualLogin: forceLogin,
    });
    await client.init();

    const bookings = await client.getCurrentBookings();
    if (bookings.length === 0) {
        console.log("No bookings found.");
        await client.close();
        return;
    }

    const booking = bookings[0];
    console.log(`Adding [${names.map((n) => `"${n}"`).join(", ")}] to booking ${booking.bookingId} (${booking.dayOfWeek})...`);

    const result = await client.addPlayersToBooking(booking, names.map((name) => ({ name })));
    console.log(JSON.stringify(result, null, 2));

    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
