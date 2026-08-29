import fs from "node:fs";

export type JobMatch = {
    weekday?: string;
    date?: string;
    startTime?: string;
    location?: string;
};

export type SessionConfig = {
    rosterFile: string;
    courtCapacity: number;
    organizer?: string;
};

export type JobConfig = {
    name: string;
    enabled: boolean;
    match?: JobMatch;
    session: SessionConfig;
};

export type BotConfig = {
    jobs: JobConfig[];
};

export const DEFAULT_COURT_CAPACITY = 6;

export class ConfigError extends Error {}

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

    const root = raw as { jobs?: unknown };
    if (!Array.isArray(root.jobs) || root.jobs.length === 0) {
        throw new ConfigError("config.jobs must be a non-empty array");
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
            for (const key of ["weekday", "date", "startTime", "location"] as const) {
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
        if (typeof s.rosterFile !== "string" || s.rosterFile.trim() === "") {
            throw new ConfigError(`config.jobs[${i}].session.rosterFile must be a non-empty string`);
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
            session: { rosterFile: s.rosterFile.trim(), courtCapacity, ...(organizer ? { organizer } : {}) },
        };
    });

    return { jobs };
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
