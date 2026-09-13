import { CourtReserveClient } from "../src";
import { loadConfig, enabledJobs } from "./config";
import { loadRosterFile, formatDateKey } from "./csv";
import { runEnsureRoster } from "./ensure-roster";
import path from "node:path";

const USAGE = `Usage: npx tsx bot/index.ts <command> [options]

Commands:
  ensure-roster   Add each job's roster to its matching bookings.
  roster-test     Print the parsed roster names for each enabled job (no browser).
  check-auth      Verify the saved CourtReserve session still works.

Options:
  --job <name>    Restrict to a single job by name.
  --dry-run       Plan only; print the diff without editing (ensure-roster).
  --headed        Run a visible browser (default is headless).
  --config <path> Path to bot.config.json (default: ./bot.config.json).
`;

type Args = {
    command: string;
    config: string;
    job?: string;
    dryRun: boolean;
    headless: boolean;
};

function parseArgs(argv: string[]): Args {
    const args: Args = { command: "", config: "bot.config.json", dryRun: false, headless: true };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--job":
                args.job = argv[++i];
                break;
            case "--dry-run":
                args.dryRun = true;
                break;
            case "--headed":
                args.headless = false;
                break;
            case "--config":
                args.config = argv[++i];
                break;
            default:
                if (!arg.startsWith("-")) args.command = arg;
                break;
        }
    }
    return args;
}

async function runRosterTest(configPath: string, jobName?: string): Promise<void> {
    const config = loadConfig(configPath);
    const jobs = enabledJobs(config, jobName);
    for (const job of jobs) {
        const rosterSet = loadRosterFile(path.resolve(path.dirname(configPath), job.session.rosterFile));
        console.log(`[job "${job.name}"] ${rosterSet.rosters.length} roster(s):`);
        for (const roster of rosterSet.rosters) {
            const when = [formatDateKey(roster.date), roster.startTime].filter(Boolean).join(" ");
            console.log(`  ${when} (${roster.players.length} player(s)):`);
            for (const name of roster.players) {
                console.log(`    - ${name}`);
            }
        }
    }
}

async function runCheckAuth(): Promise<boolean> {
    const client = new CourtReserveClient();
    await client.init();
    try {
        if (await client.isLoggedIn()) {
            console.log("check-auth OK: logged in.");
            return true;
        }
        console.error("check-auth FAILED: not logged in (session stale or expired).");
        return false;
    } finally {
        await client.close();
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    switch (args.command) {
        case "ensure-roster": {
            const ok = await runEnsureRoster(args.config, {
                dryRun: args.dryRun,
                job: args.job,
                headless: args.headless,
            });
            if (!ok) process.exitCode = 1;
            return;
        }
        case "roster-test":
            await runRosterTest(args.config, args.job);
            return;
        case "check-auth":
            if (!(await runCheckAuth())) process.exitCode = 1;
            return;
        default:
            console.error(USAGE);
            process.exit(1);
    }
}

main().catch((error) => {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
});
