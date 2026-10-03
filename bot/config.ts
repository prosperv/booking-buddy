import fs from "node:fs";

export type JobMatch = {
    weekday?: string;
    startTime?: string;
    location?: string;
};

/** A local CSV roster, resolved relative to the config file's directory. */
export type FileRosterSource = {
    kind: "file";
    path: string;
};

/** A Google Sheet roster, addressed by spreadsheet id (parsed from a URL or a bare id). */
export type GoogleSheetRosterSource = {
    kind: "googleSheet";
    spreadsheetId: string;
    /** A1 range; defaults to the first tab's full used range. */
    range?: string;
};

export type RosterSource = FileRosterSource | GoogleSheetRosterSource;

export type SessionConfig = {
    roster: RosterSource;
    courtCapacity: number;
    organizer?: string;
};

export type JobConfig = {
    name: string;
    enabled: boolean;
    match?: JobMatch;
    session: SessionConfig;
};

/** A Google service-account key; only the two fields the Sheets client needs are required. */
export type ServiceAccountKey = {
    client_email: string;
    private_key: string;
    [key: string]: unknown;
};

export type BotConfig = {
    jobs: JobConfig[];
    google?: { serviceAccount: ServiceAccountKey };
};

export const DEFAULT_COURT_CAPACITY = 6;

export class ConfigError extends Error {}

/** Extracts a spreadsheet id from a full Sheets URL, or returns the bare id unchanged. */
export function spreadsheetIdFrom(sheet: string): string {
    const trimmed = sheet.trim();
    const match = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
    return match ? match[1] : trimmed;
}

/**
 * Validates an already-parsed config object, returning a normalized shape with
 * defaults applied (`enabled` true, `match` undefined when absent,
 * `courtCapacity` defaulting to `DEFAULT_COURT_CAPACITY`, `organizer` omitted
 * when absent). Throws `ConfigError`
 * with a path-like message for anything malformed so mistakes in
 * `bot.config.json` fail loudly instead of silently skipping jobs.
 */
export function validateConfig(raw: unknown): BotConfig {
    if (!raw || typeof raw !== "object") {
        throw new ConfigError("config must be a JSON object");
    }

    const root = raw as { jobs?: unknown; google?: unknown };
    if (!Array.isArray(root.jobs) || root.jobs.length === 0) {
        throw new ConfigError("config.jobs must be a non-empty array");
    }

    let google: BotConfig["google"];
    if (root.google !== undefined) {
        if (!root.google || typeof root.google !== "object") {
            throw new ConfigError("config.google must be an object");
        }
        const g = root.google as Record<string, unknown>;
        const sa = g.serviceAccount;
        if (!sa || typeof sa !== "object") {
            throw new ConfigError("config.google.serviceAccount must be an object");
        }
        const key = sa as Record<string, unknown>;
        if (typeof key.client_email !== "string" || key.client_email.trim() === "") {
            throw new ConfigError("config.google.serviceAccount.client_email must be a non-empty string");
        }
        if (typeof key.private_key !== "string" || key.private_key.trim() === "") {
            throw new ConfigError("config.google.serviceAccount.private_key must be a non-empty string");
        }
        google = { serviceAccount: key as ServiceAccountKey };
    }

    const seenNames = new Set<string>();
    const jobs = root.jobs.map((job, i) => {
        if (!job || typeof job !== "object") {
            throw new ConfigError(`config.jobs[${i}] must be an object`);
        }
        const j = job as Record<string, unknown>;

        if (typeof j.name !== "string" || j.name.trim() === "") {
            throw new ConfigError(`config.jobs[${i}].name must be a non-empty string`);
        }
        const name = j.name.trim();
        if (seenNames.has(name)) {
            throw new ConfigError(`duplicate job name "${name}"`);
        }
        seenNames.add(name);

        if (j.enabled !== undefined && typeof j.enabled !== "boolean") {
            throw new ConfigError(`config.jobs[${i}].enabled must be a boolean`);
        }

        let match: JobMatch | undefined;
        if (j.match !== undefined) {
            if (!j.match || typeof j.match !== "object") {
                throw new ConfigError(`config.jobs[${i}].match must be an object`);
            }
            const m = j.match as Record<string, unknown>;
            const parsed: JobMatch = {};
            for (const key of ["weekday", "startTime", "location"] as const) {
                if (m[key] !== undefined) {
                    if (typeof m[key] !== "string" || (m[key] as string).trim() === "") {
                        throw new ConfigError(`config.jobs[${i}].match.${key} must be a non-empty string`);
                    }
                    parsed[key] = (m[key] as string).trim();
                }
            }
            match = parsed;
        }

        if (!j.session || typeof j.session !== "object") {
            throw new ConfigError(`config.jobs[${i}].session must be an object`);
        }
        const s = j.session as Record<string, unknown>;

        let roster: RosterSource;
        if (typeof s.roster === "string") {
            if (s.roster.trim() === "") {
                throw new ConfigError(`config.jobs[${i}].session.roster must be a non-empty string`);
            }
            roster = { kind: "file", path: s.roster.trim() };
        } else if (s.roster && typeof s.roster === "object") {
            const r = s.roster as Record<string, unknown>;
            if (typeof r.sheet !== "string" || r.sheet.trim() === "") {
                throw new ConfigError(`config.jobs[${i}].session.roster.sheet must be a non-empty string`);
            }
            let range: string | undefined;
            if (r.range !== undefined) {
                if (typeof r.range !== "string" || r.range.trim() === "") {
                    throw new ConfigError(`config.jobs[${i}].session.roster.range must be a non-empty string`);
                }
                range = r.range.trim();
            }
            roster = {
                kind: "googleSheet",
                spreadsheetId: spreadsheetIdFrom(r.sheet),
                ...(range ? { range } : {}),
            };
        } else {
            throw new ConfigError(
                `config.jobs[${i}].session.roster must be a string (file path) or an object with "sheet"`,
            );
        }

        let courtCapacity = DEFAULT_COURT_CAPACITY;
        if (s.courtCapacity !== undefined) {
            if (
                typeof s.courtCapacity !== "number" ||
                !Number.isInteger(s.courtCapacity) ||
                s.courtCapacity < 1
            ) {
                throw new ConfigError(`config.jobs[${i}].session.courtCapacity must be an integer >= 1`);
            }
            courtCapacity = s.courtCapacity;
        }

        let organizer: string | undefined;
        if (s.organizer !== undefined) {
            if (typeof s.organizer !== "string" || s.organizer.trim() === "") {
                throw new ConfigError(`config.jobs[${i}].session.organizer must be a non-empty string`);
            }
            organizer = s.organizer.trim();
        }

        return {
            name,
            enabled: j.enabled ?? true,
            match,
            session: { roster, courtCapacity, ...(organizer ? { organizer } : {}) },
        };
    });

    if (jobs.some((job) => job.session.roster.kind === "googleSheet") && !google) {
        throw new ConfigError(
            "config.google.serviceAccount is required when a job uses a Google Sheet roster",
        );
    }

    return { jobs, ...(google ? { google } : {}) };
}

/** Reads, parses, and validates a config file, throwing `ConfigError` on any failure. */
export function loadConfig(path: string): BotConfig {
    let text: string;
    try {
        text = fs.readFileSync(path, "utf8");
    } catch (err) {
        throw new ConfigError(`could not read config at ${path}: ${err instanceof Error ? err.message : err}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new ConfigError(`config at ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`);
    }

    return validateConfig(parsed);
}

/** Returns enabled jobs, optionally narrowed to a single job by name. */
export function enabledJobs(config: BotConfig, name?: string): JobConfig[] {
    const enabled = config.jobs.filter((j) => j.enabled);
    if (!name) return enabled;

    const matches = enabled.filter((j) => j.name === name);
    if (matches.length === 0) {
        throw new ConfigError(`no enabled job named "${name}"`);
    }
    return matches;
}
