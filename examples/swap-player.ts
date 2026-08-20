import { CourtReserveClient } from "../src";

function parseArgs(argv: string[]): { forceLogin: boolean; remove: string[]; add: string[] } {
    const forceLogin = argv.includes("--force") || argv.includes("-f");

    const remove: string[] = [];
    const add: string[] = [];
    let target = remove;

    for (const arg of argv) {
        if (arg === "--remove") {
            target = remove;
        } else if (arg === "--add") {
            target = add;
        } else if (!arg.startsWith("-")) {
            target.push(arg.trim());
        }
    }

    return { forceLogin, remove: remove.filter((n) => n.length > 0), add: add.filter((n) => n.length > 0) };
}

async function main() {
    const { forceLogin, remove, add } = parseArgs(process.argv.slice(2));

    if (remove.length === 0 && add.length === 0) {
        console.error(
            'Usage: npx tsx examples/swap-player.ts --remove "<player name>" [...] --add "<player name>" [...] [--force]',
        );
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

    const result = await client.swapPlayersOnBooking(
        booking,
        remove.map((name) => ({ name })),
        add.map((name) => ({ name })),
    );
    console.log(JSON.stringify(result, null, 2));

    await client.close();
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
