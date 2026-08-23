import { CourtReserveClient, type CourtLocation } from "../src";

const LOCATIONS: CourtLocation[] = ["bellevue", "mukilteo", "redmond", "renton", "southcenter"];
const DURATIONS = [60, 90, 120, 150, 180] as const;
type Duration = (typeof DURATIONS)[number];

const USAGE =
    'Usage: npx tsx examples/reserve-court.ts [--location <bellevue|mukilteo|redmond|renton|southcenter>] ' +
    "[--date <YYYY-MM-DD>] [--time <HH:MM>] [--duration <60|90|120|150|180>] [--court <n> ...] " +
    '"<player name>" [...] [--force]';

interface ReserveArgs {
    forceLogin: boolean;
    location: CourtLocation;
    date: string;
    startTime: string;
    durationMinutes: Duration;
    courts: number[];
    players: string[];
}

function todayISO(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseArgs(argv: string[]): ReserveArgs {
    const forceLogin = argv.includes("--force") || argv.includes("-f");
    const players: string[] = [];
    const courts: number[] = [];
    let location: CourtLocation = "mukilteo";
    let date = todayISO();
    let startTime = "18:00";
    let durationMinutes: Duration = 60;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => argv[++i] ?? "";
        switch (arg) {
            case "--location":
            case "-l": {
                const v = value();
                if (v) location = v as CourtLocation;
                break;
            }
            case "--date":
            case "-d": {
                const v = value();
                if (v) date = v;
                break;
            }
            case "--time":
            case "-t": {
                const v = value();
                if (v) startTime = v;
                break;
            }
            case "--duration":
            case "-m": {
                const v = value();
                if (v) durationMinutes = Number(v) as Duration;
                break;
            }
            case "--court":
            case "-c": {
                const v = value();
                if (v) courts.push(Number(v));
                break;
            }
            case "--force":
            case "-f":
                break;
            default:
                if (!arg.startsWith("-")) players.push(arg.trim());
                break;
        }
    }

    return {
        forceLogin,
        location,
        date,
        startTime,
        durationMinutes,
        courts,
        players: players.filter((n) => n.length > 0),
    };
}

async function main() {
    const { forceLogin, location, date, startTime, durationMinutes, courts, players } = parseArgs(
        process.argv.slice(2),
    );

    if (!LOCATIONS.includes(location)) {
        console.error(`Invalid location "${location}". Choose from: ${LOCATIONS.join(", ")}`);
        process.exit(1);
    }
    if (!DURATIONS.includes(durationMinutes)) {
        console.error(`Invalid duration ${durationMinutes}. Choose from: ${DURATIONS.join(", ")}`);
        process.exit(1);
    }
    if (players.length === 0) {
        console.error(USAGE);
        process.exit(1);
    }

    const client = new CourtReserveClient({
        headless: false,
        manualLogin: forceLogin,
    });
    await client.init();

    // Example: get reserved slots for a date
    const slots = await client.getReservedSlots(location, date);
    console.log(`Reserved slots for ${location} on ${date}:`, slots.length);

    // Example: reserve a court
    const result = await client.attemptReserveCourt({
        location,
        date,
        startTime,
        durationMinutes,
        players: players.map((name) => ({ name })),
        preferCourts: courts,
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
