import fs from "node:fs";
import path from "node:path";
import { credentialsFromEnv, type Logger } from "../src";
import { authPath } from "../src/constants";
import { loadConfig, enabledJobs, type BotConfig, type JobConfig, type ServiceAccountKey } from "./config";
import { loadGoogleSheets } from "./sheets";

/**
 * How a finding should be read. `blocking` means a run cannot succeed until it is
 * fixed; `advisory` means the run still works but something will bite later —
 * a missing credentials file only matters once the saved session goes stale.
 */
export type Severity = "blocking" | "advisory";

export type Finding = {
    severity: Severity;
    /** Short label for what was checked, e.g. `auth.json`. */
    subject: string;
    /** What is wrong, in one sentence. */
    message: string;
    /** What to do about it, printed verbatim. */
    remedy?: string;
};

/**
 * Where the systemd unit is pointed for the unattended-login credentials. It is
 * only ever stat'ed — the run reads it through `EnvironmentFile=`, not from here.
 */
const CREDENTIALS_FILE = "/etc/booking-buddy/credentials.env";

export type DoctorOptions = {
    /** Config path; also the anchor for relative roster paths. */
    configPath: string;
    /** Restrict to one job by name. */
    job?: string;
    /** Also reach the network: probe each sheet job's spreadsheet. */
    live?: boolean;
    /** Where `auth.json` lives; overridable so tests need no real one. */
    authFile?: string;
    /**
     * The sheet reader, injected so the `--live` path is testable without a
     * network. Defaults to the same `loadGoogleSheets` a real run uses, which is
     * the point: one probe that proves the key *and* the share together.
     */
    loadSheet?: typeof loadGoogleSheets;
    /** Credentials to classify, defaults to this process's environment. */
    env?: { COURTRESERVE_USERNAME?: string; COURTRESERVE_PASSWORD?: string };
    /**
     * The `EnvironmentFile=` the unit loads credentials from; overridable so
     * tests need no real one, and so a check for its presence is not a claim
     * about whichever host the tests run on.
     */
    credentialsFile?: string;
};

/**
 * Reports whether a setup can actually run, before a scheduled run finds out the
 * expensive way. Every check reads files or configuration the run itself depends
 * on, so a finding is actionable by construction; the network probe is opt-in via
 * `live` so the local half stays fast and usable with no connectivity.
 *
 * Deliberately opens no browser: this answers "is the setup right", which is
 * separable from "does the session still work" (`check-auth`) and "does the site
 * still look like we expect" (the run itself).
 */
export async function runDoctor(options: DoctorOptions, logger: Logger): Promise<boolean> {
    const findings = await diagnose(options);
    return report(findings, options, logger);
}

/** Collects every finding, so one run surfaces all the problems rather than the first. */
export async function diagnose(options: DoctorOptions): Promise<Finding[]> {
    const findings: Finding[] = [];

    let config: BotConfig;
    let jobs: JobConfig[];
    try {
        config = loadConfig(options.configPath);
        jobs = enabledJobs(config, options.job);
    } catch (err) {
        findings.push({
            severity: "blocking",
            subject: "config",
            message: err instanceof Error ? err.message : String(err),
            remedy: `copy bot/bot.config.example.json to ${options.configPath} and fill it in`,
        });
        return findings;
    }

    const template = checkTemplate(options.configPath);
    findings.push(...template);
    // An unedited example's key is the literal string REPLACE_ME, so judging its
    // shape would report a mangled paste that never happened. The placeholder
    // finding already says the file needs filling in.
    if (template.length === 0) {
        findings.push(...checkServiceAccount(config, jobs));
    }
    findings.push(...checkFileRosters(jobs, options.configPath));
    findings.push(...checkAuthFile(options.authFile ?? authPath));
    findings.push(...checkCredentials(options.credentialsFile ?? CREDENTIALS_FILE, options.env));

    const hasSheetJob = jobs.some((j) => j.session.roster.kind === "googleSheet");
    if (options.live && template.length === 0) {
        findings.push(...(await checkSheets(config, jobs, options.loadSheet ?? loadGoogleSheets)));
    } else if (hasSheetJob && template.length === 0) {
        findings.push({
            severity: "advisory",
            subject: "sheet",
            message: "not verified — the service-account key and the sheet share are unproven",
            remedy: "re-run with --live to probe the spreadsheet",
        });
    }

    return findings;
}

/**
 * A freshly seeded config is a working shell rather than a working config: the
 * placeholders survive `validateConfig` because they are well-formed strings, so
 * the failure would otherwise wait for the first scheduled run.
 */
function checkTemplate(configPath: string): Finding[] {
    let text: string;
    try {
        text = fs.readFileSync(configPath, "utf8");
    } catch {
        return []; // loadConfig already reported the unreadable config.
    }
    if (!text.includes("REPLACE_ME")) return [];
    return [{
        severity: "blocking",
        subject: "config",
        message: "still contains REPLACE_ME placeholders from the example file",
        remedy: "fill in google.serviceAccount and each job's session.roster.sheet",
    }];
}

/**
 * A service account key is hand-edited into the config, so the likeliest damage is
 * a mangled paste, or a copy out of a file that was itself truncated.
 */
function checkServiceAccount(config: BotConfig, jobs: JobConfig[]): Finding[] {
    const sheetJobs = jobs.filter((j) => j.session.roster.kind === "googleSheet");
    if (sheetJobs.length === 0) return [];

    const sa: ServiceAccountKey | undefined = config.google?.serviceAccount;
    if (!sa) {
        return [{
            severity: "blocking",
            subject: "service account",
            message: `job${sheetJobs.length > 1 ? "s" : ""} ${sheetJobs.map((j) => `"${j.name}"`).join(", ")} use a Google Sheet roster but config.google.serviceAccount is missing`,
            remedy: "add google.serviceAccount (client_email + private_key) to the config",
        }];
    }

    // validateConfig has already rejected an empty client_email or private_key, so
    // only the shapes it cannot check are worth looking at here.
    const findings: Finding[] = [];
    const key = sa.private_key;
    if (!key.includes("BEGIN PRIVATE KEY")) {
        findings.push({
            severity: "blocking",
            subject: "service account",
            message: "private_key does not look like a PEM block (no BEGIN PRIVATE KEY marker)",
            remedy: "paste the whole key from the JSON file the GCP console downloaded",
        });
    } else if (key.includes("\\n") || key.includes("\\r")) {
        // The config is inspected *after* JSON.parse, which turns the `\n` escapes
        // of a key pasted from the downloaded file into the real newlines the JWT
        // signer wants — so real line breaks are the healthy shape, not the broken
        // one. A value still holding the two characters backslash-n was escaped
        // twice on its way into the config (pasted out of a shell heredoc, an env
        // dump, or a copy already round-tripped through JSON), leaving a key the
        // API rejects as an opaque 400, well away from the edit that caused it.
        findings.push({
            severity: "blocking",
            subject: "service account",
            message: "private_key still contains literal \\n two-character escapes instead of real newlines",
            remedy: "re-copy the key straight from the downloaded JSON file — the config needs one \\n escape per line break, not a doubled one",
        });
    }

    return findings;
}

/** A file roster that is missing or unreadable fails the run at load time. */
function checkFileRosters(jobs: JobConfig[], configPath: string): Finding[] {
    const findings: Finding[] = [];
    for (const job of jobs) {
        const source = job.session.roster;
        if (source.kind !== "file") continue;
        const resolved = path.resolve(path.dirname(configPath), source.path);
        if (fs.existsSync(resolved)) continue;
        findings.push({
            severity: "blocking",
            subject: `roster "${job.name}"`,
            message: `file not found at ${resolved}`,
            remedy: "roster paths resolve relative to the config file — fix session.roster or create the file",
        });
    }
    return findings;
}

/**
 * The saved session is usually produced on another machine and copied in, so the
 * failure modes are a truncated transfer and a file that is not the storage state
 * at all. Neither is visible without reading it.
 */
function checkAuthFile(authFile: string): Finding[] {
    if (!fs.existsSync(authFile)) {
        return [{
            severity: "blocking",
            subject: "auth.json",
            message: `no saved session at ${authFile}`,
            remedy: "log in once on a machine with a display (npm start) and copy the file across; a missing session on a headless host blocks on a prompt with no TTY",
        }];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(authFile, "utf8"));
    } catch (err) {
        return [{
            severity: "blocking",
            subject: "auth.json",
            message: `not valid JSON (${err instanceof Error ? err.message : String(err)}) — usually a truncated copy`,
            remedy: "re-copy the file, and check it ends with the closing brace",
        }];
    }

    const cookies = (parsed as { cookies?: unknown })?.cookies;
    if (!Array.isArray(cookies) || cookies.length === 0) {
        return [{
            severity: "blocking",
            subject: "auth.json",
            message: "storage state has no cookies — the file is not a usable login",
            remedy: "log in again on a machine with a display and copy the new file across",
        }];
    }

    return [];
}

/**
 * Absent credentials are not a problem until CourtReserve drops the session, at
 * which point the run falls back to the interactive prompt and a oneshot unit has
 * no TTY for it. Worth surfacing now precisely because the failure is deferred and
 * would otherwise be discovered from a hung service.
 *
 * The variables reach a scheduled run through `EnvironmentFile=` rather than the
 * bot reading that file itself, so a doctor run from a shell cannot see them even
 * on a fully configured host. Checking whether the file is there at least tells
 * "never configured" apart from "configured, and this shell just cannot see it" —
 * and it can only be stat'ed, never read: the file is root-owned mode 600 and
 * holds a password.
 */
function checkCredentials(credentialsFile: string, env?: { COURTRESERVE_USERNAME?: string; COURTRESERVE_PASSWORD?: string }): Finding[] {
    const credentials = credentialsFromEnv(env);
    if (credentials) return [];

    if (fs.existsSync(credentialsFile)) {
        return [{
            severity: "advisory",
            subject: "credentials",
            message: `COURTRESERVE_USERNAME/COURTRESERVE_PASSWORD are not in this process, but ${credentialsFile} is there for the unit to load`,
            remedy: "normally nothing to fix — systemd reads that file into the service's environment (EnvironmentFile=) before it drops privileges, so a scheduled run has both; it is only a real gap if that file does not hold both",
        }];
    }

    return [{
        severity: "advisory",
        subject: "credentials",
        message: "COURTRESERVE_USERNAME/COURTRESERVE_PASSWORD are not configured (both are required)",
        remedy: `runs work while the saved session is fresh; once it expires the run blocks on the manual-login prompt — add them to ${credentialsFile}`,
    }];
}

/**
 * The one check that cannot be done by reading a file. Probing the spreadsheet
 * proves the key is usable and the sheet is shared with it at the same time,
 * which are the two things a hand-edited key most often gets wrong, and it is the
 * exact call a real run makes — so a pass here is not a weaker version of a run.
 */
async function checkSheets(
    config: BotConfig,
    jobs: JobConfig[],
    loadSheet: typeof loadGoogleSheets,
): Promise<Finding[]> {
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const job of jobs) {
        const source = job.session.roster;
        if (source.kind !== "googleSheet") continue;
        if (!seen.has(source.spreadsheetId)) {
            seen.add(source.spreadsheetId);
            const sa = config.google?.serviceAccount;
            if (!sa) continue; // already reported by checkServiceAccount.
            try {
                const tabs = await loadSheet(source.spreadsheetId, source.range, sa);
                // `loadGoogleSheets` already throws when it finds no month tab, so
                // a non-empty result means the key authenticated and the sheet was
                // readable: the one combination only the network can prove.
                if (tabs.length === 0) {
                    findings.push({
                        severity: "blocking",
                        subject: `sheet ${source.spreadsheetId}`,
                        message: "readable but no roster tab for this month or the next",
                        remedy: `share the spreadsheet with ${sa.client_email} and give it a tab named like "Oct 2026"`,
                    });
                }
            } catch (err) {
                findings.push({
                    severity: "blocking",
                    subject: `sheet ${source.spreadsheetId}`,
                    message: err instanceof Error ? err.message : String(err),
                    remedy: `check the private_key, and that the spreadsheet is shared with ${sa.client_email}`,
                });
            }
        }
    }

    return findings;
}

/**
 * Prints findings grouped by severity, then one summary line. Blocking findings
 * are printed to stderr so they survive a pipe into a pager that only keeps
 * stdout; the rest go to stdout with the rest of the report.
 */
function report(findings: Finding[], options: DoctorOptions, logger: Logger): boolean {
    const blocking = findings.filter((f) => f.severity === "blocking");
    const advisory = findings.filter((f) => f.severity === "advisory");

    for (const finding of blocking) {
        logger.error(`FAIL  ${finding.subject}: ${finding.message}`, {
            event: "doctor-finding",
            severity: finding.severity,
            subject: finding.subject,
            message: finding.message,
            remedy: finding.remedy,
        });
        if (finding.remedy) logger.error(`      fix: ${finding.remedy}`, { event: "doctor-remedy", subject: finding.subject });
    }
    for (const finding of advisory) {
        logger.warn(`WARN  ${finding.subject}: ${finding.message}`, {
            event: "doctor-finding",
            severity: finding.severity,
            subject: finding.subject,
            message: finding.message,
            remedy: finding.remedy,
        });
        if (finding.remedy) logger.warn(`      fix: ${finding.remedy}`, { event: "doctor-remedy", subject: finding.subject });
    }

    const ok = blocking.length === 0;
    const summary = ok
        ? `doctor OK${advisory.length > 0 ? ` (${advisory.length} warning(s))` : ""}${
            options.live ? "" : " — rosters not verified; re-run with --live"
        }`
        : `doctor FAILED: ${blocking.length} blocking problem(s)${
            advisory.length > 0 ? `, ${advisory.length} warning(s)` : ""
        }`;

    if (ok) {
        logger.info(summary, { event: "doctor-end", ok: true, blocking: 0, advisory: advisory.length, live: !!options.live });
    } else {
        logger.error(summary, { event: "doctor-end", ok: false, blocking: blocking.length, advisory: advisory.length, live: !!options.live });
    }

    return ok;
}
