import { CourtReserveClient } from "../src";

async function main() {
    const forceLogin = process.argv.includes("--force") || process.argv.includes("-f");

    const nameArg = process.argv
        .slice(2)
        .find((arg) => !arg.startsWith("-") && !arg.startsWith("--"));
    const name = nameArg?.trim();
    if (!name) {
        console.error("Usage: npx tsx examples/add-player.ts \"<player name>\" [--force]");
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
    console.log(`Adding "${name}" to booking ${booking.bookingId} (${booking.dayOfWeek})...`);

    const result = await client.addPlayerToBooking(booking, { name });
    console.log(JSON.stringify(result, null, 2));

    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
