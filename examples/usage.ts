import { CourtReserveClient } from "../src";

async function main() {
    const client = new CourtReserveClient({ headless: false });
    await client.init();
    const bookings = await client.getCurrentBookings({ weekday: "Sat" });
    console.log(bookings);
    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
