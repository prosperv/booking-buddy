import path from "node:path";
import type { Logger } from "../src";
import { loadRosterFile, parseRosterAll, formatDateKey, type RosterSet } from "./csv";
import { loadGoogleSheets } from "./sheets";
import type { BotConfig, JobConfig } from "./config";

/**
 * Loads a job's roster from its configured source — a local CSV file or a
 * Google Sheet — normalizing either to a `RosterSet`. File paths resolve
 * relative to the config file's directory; a sheet resolves every month tab in
 * play via the top-level `google.serviceAccount` credentials, recording which
 * tab each session came from. `from` is the instant the month tabs are chosen
 * around (default: now).
 */
export async function loadRoster(
    config: BotConfig,
    job: JobConfig,
    configPath: string,
    from: Date = new Date(),
): Promise<RosterSet> {
    const source = job.session.roster;
    if (source.kind === "file") {
        return loadRosterFile(path.resolve(path.dirname(configPath), source.path));
    }

    const serviceAccount = config.google?.serviceAccount;
    if (!serviceAccount) {
        throw new Error(`job "${job.name}" uses a Google Sheet roster but config.google.serviceAccount is missing`);
    }
    const tabs = await loadGoogleSheets(source.spreadsheetId, source.range, serviceAccount, { from });
    return parseRosterAll(tabs.map((t) => ({ text: t.csv, tab: t.tab })));
}

/** Logs a job's parsed roster content (dates and players) at info level. */
export function logRosterRead(logger: Logger, job: JobConfig, rosterSet: RosterSet): void {
    logger.info("roster read", {
        event: "roster-read",
        job: job.name,
        source: job.session.roster.kind,
        rosters: rosterSet.rosters.map((roster) => ({
            date: formatDateKey(roster.date),
            startTime: roster.startTime,
            tab: roster.tab,
            count: roster.players.length,
            players: roster.players,
        })),
    });
}
