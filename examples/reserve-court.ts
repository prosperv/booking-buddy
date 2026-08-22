import { CourtReserveClient } from "../src";

async function main() {
    const client = new CourtReserveClient({ headless: false });
    await client.init();

    // Example: get reserved slots for a date
    const slots = await client.getReservedSlots("mukilteo", "2026-09-12");
    console.log("Reserved slots:", slots.length);

    // Example: reserve a court
    const result = await client.attemptReserveCourt({
        location: "mukilteo",
        date: "2026-09-12",
        startTime: "18:00",
        durationMinutes: 60,
        players: [{ name: "Prosper Van" }],
        preferCourts: [1, 2, 3],
    });

    console.log("Reservation result:", {
        ...result,
        startTime: result.startTime.toString(),
        endTime: result.endTime.toString(),
    });

    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
