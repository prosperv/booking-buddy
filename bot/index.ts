import { CourtReserveClient, createLogger, defaultLogFile, resolveLogDir, type Logger } from "../src";
import { loadConfig, enabledJobs, type BotConfig, type JobConfig } from "./config";
import { loadRosterFile, formatDateKey, type RosterSet } from "./csv";
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
  --log-path <dir> Directory for the bot log file (default: LOG_PATH or ./log).
`;

type Args = {
    command: string;
    config: string;
    job?: string;
    dryRun: boolean;
    headless: boolean;
    logPath?: string;
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
            case "--log-path":
                args.logPath = argv[++i];
                break;
            default:
                if (!arg.startsWith("-")) args.command = arg;
                break;
        }
    }
    return args;
}

async function runRosterTest(configPath: string, jobName: string | undefined, logger: Logger): Promise<void> {
    let config: BotConfig;
    let jobs: JobConfig[];
    try {
        config = loadConfig(configPath);
        jobs = enabledJobs(config, jobName);
    } catch (err) {
        logger.error(`roster-test: config error: ${err instanceof Error ? err.message : err}`, {
            event: "config-error",
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
    }
    for (const job of jobs) {
        let rosterSet: RosterSet;
        try {
            rosterSet = loadRosterFile(path.resolve(path.dirname(configPath), job.session.rosterFile));
        } catch (err) {
            logger.error(`roster-test: roster error: ${err instanceof Error ? err.message : err}`, {
                event: "roster-error",
                job: job.name,
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            });
            throw err;
        }
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

async function runCheckAuth(logger: Logger): Promise<boolean> {
    const client = new CourtReserveClient();
    try {
        await client.init();
    } catch (err) {
        logger.error(`check-auth: client init failed: ${err instanceof Error ? err.message : err}`, {
            event: "init-failed",
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        return false;
    }
    try {
        if (await client.isLoggedIn()) {
            logger.info("check-auth OK: logged in.", { event: "check-auth-ok" });
            return true;
        }
        logger.error("check-auth FAILED: not logged in (session stale or expired).", {
            event: "check-auth-failed",
        });
        return false;
    } finally {
        await client.close();
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const logger = createLogger({
        filePath: defaultLogFile(resolveLogDir(args.logPath), "bot"),
    });

    switch (args.command) {
        case "ensure-roster": {
            const ok = await runEnsureRoster(args.config, {
                dryRun: args.dryRun,
                job: args.job,
                headless: args.headless,
            }, logger);
            if (!ok) process.exitCode = 1;
            return;
        }
        case "roster-test":
            await runRosterTest(args.config, args.job, logger);
            return;
        case "check-auth":
            if (!(await runCheckAuth(logger))) process.exitCode = 1;
            return;
        default:
            logger.error(USAGE, { event: "usage" });
            process.exit(1);
    }
}

function onFatal(error: unknown, kind: "uncaughtException" | "unhandledRejection"): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Last-resort structured line; the bot logger may not be wired yet.
    console.error(`${kind}: ${err.stack ?? err.message}`);
    process.exit(1);
}

process.on("uncaughtException", (error) => onFatal(error, "uncaughtException"));
process.on("unhandledRejection", (error) => onFatal(error, "unhandledRejection"));

main().catch((error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("Error:", err.stack ?? err.message);
    process.exit(1);
});
