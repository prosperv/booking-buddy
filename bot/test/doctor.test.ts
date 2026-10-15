import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnose, runDoctor, type DoctorOptions } from "../doctor";
import type { loadGoogleSheets } from "../sheets";
import type { Logger } from "../../src";

/**
 * `diagnose` is exercised through real files rather than injected config: the
 * things it catches are exactly the things a hand-edited config and a copied
 * auth.json get wrong, so stubbing the input out would test the mock.
 */

/**
 * A key as it looks *after* JSON.parse: the `\n` escapes the downloaded file
 * writes have become the real newlines the signer wants, which is the only form
 * a correct paste ever takes here.
 */
const GOOD_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\n";

/** A config that passes `validateConfig`, with one sheet-roster job by default. */
function configJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        google: {
            serviceAccount: {
                client_email: "bot@example.iam.gserviceaccount.com",
                private_key: GOOD_KEY,
            },
        },
        jobs: [
            {
                name: "tuesday-evening",
                enabled: true,
                match: { weekday: "Tue", startTime: "18:00" },
                session: {
                    roster: { sheet: "https://docs.google.com/spreadsheets/d/SHEET123/edit" },
                    courtCapacity: 6,
                },
            },
        ],
        ...overrides,
    };
}

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "doctor-"));
}

/** Writes a config into a throwaway dir and returns the paths `diagnose` needs. */
function fixture(config: unknown = configJson(), files: Record<string, string> = {}): {
    dir: string;
    configPath: string;
    authFile: string;
} {
    const dir = tempDir();
    const configPath = path.join(dir, "bot.config.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), body);
    }
    return { dir, configPath, authFile: path.join(dir, "auth.json") };
}

const VALID_AUTH = JSON.stringify({ cookies: [{ name: "session", value: "x" }], origins: [] });

function options(configPath: string, authFile: string, overrides: Partial<DoctorOptions> = {}): DoctorOptions {
    return {
        configPath,
        authFile,
        // Credentials present unless a test says otherwise, so credential absence
        // does not drown out the finding being asserted on.
        env: { COURTRESERVE_USERNAME: "me@example.com", COURTRESERVE_PASSWORD: "hunter2" },
        ...overrides,
    };
}

/** Findings whose message mentions `needle`, so assertions name the problem. */
function matching(findings: { message: string }[], needle: RegExp | string): string[] {
    const test = typeof needle === "string" ? (m: string) => m.includes(needle) : (m: string) => needle.test(m);
    return findings.map((f) => f.message).filter(test);
}

/** Captures log lines by level, so `runDoctor`'s output and return value are both assertable. */
function recordingLogger(): { logger: Logger; lines: { level: string; msg: string }[] } {
    const lines: { level: string; msg: string }[] = [];
    const push = (level: string) => (msg: string) => lines.push({ level, msg });
    const logger: Logger = {
        debug: push("debug"),
        info: push("info"),
        warn: push("warn"),
        error: push("error"),
        flush: () => undefined,
    };
    return { logger, lines };
}

const neverCalled = (async () => {
    throw new Error("the sheet reader should not be called without --live");
}) as unknown as typeof loadGoogleSheets;

describe("diagnose: a working setup", () => {
    it("reports nothing blocking when config, sheet key, auth and credentials are all present", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
    });

    it("accepts a file roster that exists, resolved relative to the config file", async () => {
        const config = configJson({
            google: undefined,
            jobs: [{ name: "local", enabled: true, session: { roster: "rosters/example.csv" } }],
        });
        const { dir, configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        fs.mkdirSync(path.join(dir, "rosters"), { recursive: true });
        fs.writeFileSync(path.join(dir, "rosters", "example.csv"), "Aug 25th,18:00\nKento Momota\n");

        const findings = await diagnose(options(configPath, authFile));
        expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
    });
});

describe("diagnose: the config", () => {
    it("reports an unreadable or invalid config as blocking, naming the path", async () => {
        const { configPath, authFile } = fixture();
        fs.writeFileSync(configPath, "{ not json");
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "not valid JSON")).toHaveLength(1);
        expect(findings[0].severity).toBe("blocking");
    });

    it("reports a missing config file", async () => {
        const dir = tempDir();
        const findings = await diagnose(options(path.join(dir, "absent.json"), path.join(dir, "auth.json")));
        expect(matching(findings, "could not read config")).toHaveLength(1);
    });

    it("stops at the config error rather than reporting a cascade of downstream problems", async () => {
        const { configPath, authFile } = fixture();
        fs.writeFileSync(configPath, "nope");
        const findings = await diagnose(options(configPath, authFile));
        expect(findings).toHaveLength(1);
    });

    it("flags an unedited example config, which validateConfig otherwise accepts", async () => {
        const example = JSON.parse(fs.readFileSync("bot/bot.config.example.json", "utf8"));
        const { configPath, authFile } = fixture(example, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "REPLACE_ME")).toHaveLength(1);
        expect(findings.filter((f) => f.severity === "blocking").length).toBeGreaterThan(0);
    });

    it("does not also judge the placeholder key, which is not a mangled paste", async () => {
        const example = JSON.parse(fs.readFileSync("bot/bot.config.example.json", "utf8"));
        const { configPath, authFile } = fixture(example, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "private_key")).toHaveLength(0);
    });

    it("does not probe the sheet with an unedited config, where the key is a placeholder", async () => {
        const example = JSON.parse(fs.readFileSync("bot/bot.config.example.json", "utf8"));
        const { configPath, authFile } = fixture(example, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile, { live: true, loadSheet: neverCalled }));
        expect(findings.filter((f) => f.subject.startsWith("sheet "))).toEqual([]);
        expect(matching(findings, "not verified")).toHaveLength(0);
    });

    it("reports a missing file roster against its config-relative path", async () => {
        const config = configJson({
            google: undefined,
            jobs: [{ name: "local", enabled: true, session: { roster: "rosters/absent.csv" } }],
        });
        const { configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        const found = findings.find((f) => f.subject === 'roster "local"');
        expect(found?.message).toContain("rosters/absent.csv");
        expect(found?.severity).toBe("blocking");
    });

    it("narrows to the named job and flags that name when it does not exist", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile, { job: "nope" }));
        expect(matching(findings, 'no enabled job named "nope"')).toHaveLength(1);
    });

    it("ignores a disabled job's missing roster, since the run would too", async () => {
        const config = configJson({
            google: undefined,
            jobs: [{ name: "off", enabled: false, session: { roster: "rosters/absent.csv" } }],
        });
        const { configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "rosters/absent.csv")).toHaveLength(0);
    });
});

describe("diagnose: the service account key", () => {
    /** A sheet job with `serviceAccount` overridden, everything else valid. */
    function sheetJobWith(serviceAccount: Record<string, unknown>): unknown {
        return configJson({ google: { serviceAccount } });
    }

    it("flags a key whose newlines were escaped twice on the way into the config", async () => {
        const config = sheetJobWith({
            client_email: "bot@example.iam.gserviceaccount.com",
            // What a value looks like when it was already escaped before landing in
            // the config, so JSON.parse leaves the two characters backslash-n.
            private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg\\n-----END PRIVATE KEY-----\\n",
        });
        const { configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, /literal \\n/)).toHaveLength(1);
    });

    it("flags a private_key that is not a PEM block at all", async () => {
        const config = sheetJobWith({
            client_email: "bot@example.iam.gserviceaccount.com",
            private_key: "hunter2",
        });
        const { configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "PEM block")).toHaveLength(1);
    });

    it("accepts a key pasted from the downloaded JSON file, newlines and all", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, /private_key|PEM block|newlines/)).toHaveLength(0);
    });

    it("does not inspect the key at all when no job reads from a sheet", async () => {
        const config = configJson({
            google: { serviceAccount: { client_email: "bot@example.com", private_key: "not-a-key" } },
            jobs: [{ name: "local", enabled: true, session: { roster: "rosters/example.csv" } }],
        });
        const { dir, configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        fs.mkdirSync(path.join(dir, "rosters"), { recursive: true });
        fs.writeFileSync(path.join(dir, "rosters", "example.csv"), "Aug 25th,18:00\nKento Momota\n");

        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "PEM block")).toHaveLength(0);
    });
});

describe("diagnose: auth.json", () => {
    it("flags a missing saved session and names the transfer as the fix", async () => {
        const { configPath, authFile } = fixture();
        const findings = await diagnose(options(configPath, authFile));
        const found = findings.find((f) => f.subject === "auth.json");
        expect(found?.severity).toBe("blocking");
        expect(found?.remedy).toContain("npm start");
    });

    it("flags a truncated copy, which is the usual cause of a missing session", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH.slice(0, 40) });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "truncated copy")).toHaveLength(1);
    });

    it("flags storage state with no cookies, which cannot authenticate anything", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": '{"cookies":[]}' });
        const findings = await diagnose(options(configPath, authFile));
        expect(matching(findings, "no cookies")).toHaveLength(1);
    });

    it("accepts a storage state with a cookie", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile));
        expect(findings.filter((f) => f.subject === "auth.json")).toEqual([]);
    });
});

describe("diagnose: credentials", () => {
    /**
     * The credentials check is advisory, so look it up by subject rather than
     * severity. `credentialsFile` points into a throwaway dir so the result does
     * not depend on whether the host running the tests has one installed.
     */
    async function credentialFinding(
        env: Record<string, string | undefined>,
        credentialsFile?: string,
    ): Promise<{ severity: string; message: string; remedy?: string } | undefined> {
        const { dir, configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile, { env, credentialsFile: credentialsFile ?? path.join(dir, "credentials.env") }));
        return findings.find((f) => f.subject === "credentials");
    }

    it("is advisory, not blocking: runs work until the session expires", async () => {
        expect((await credentialFinding({}))?.severity).toBe("advisory");
    });

    it("names the env file as the fix, since a headless host cannot answer a prompt", async () => {
        const dir = tempDir();
        const finding = await credentialFinding({}, path.join(dir, "credentials.env"));
        expect(finding?.remedy).toContain(path.join(dir, "credentials.env"));
    });

    it("treats a half-configured pair as unconfigured, matching the library", async () => {
        expect(await credentialFinding({ COURTRESERVE_USERNAME: "me@example.com" })).toBeDefined();
    });

    it("says nothing when both are present", async () => {
        expect(await credentialFinding({ COURTRESERVE_USERNAME: "me@example.com", COURTRESERVE_PASSWORD: "x" })).toBeUndefined();
    });

    it("separates a configured host from an unconfigured one when the env file is there", async () => {
        const dir = tempDir();
        const file = path.join(dir, "credentials.env");
        fs.writeFileSync(file, "COURTRESERVE_USERNAME=me@example.com\nCOURTRESERVE_PASSWORD=hunter2\n");

        const finding = await credentialFinding({}, file);
        expect(finding?.message).toContain(file);
        expect(finding?.remedy).toContain("nothing to fix");
    });

    it("never reads the env file, whose contents are a root-owned password", async () => {
        const dir = tempDir();
        const file = path.join(dir, "credentials.env");
        fs.writeFileSync(file, "COURTRESERVE_PASSWORD=hunter2\n");

        const finding = await credentialFinding({}, file);
        expect(JSON.stringify(finding)).not.toContain("hunter2");
    });
});

describe("diagnose: xvfb", () => {
    /**
     * Advisory like the credentials check, so it is looked up by subject.
     * `xvfbRunPath` is injected so neither branch depends on what the host
     * running the tests happens to have installed.
     */
    async function xvfbFinding(xvfbRunPath: string): Promise<{ severity: string; message: string; remedy?: string } | undefined> {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile, { xvfbRunPath }));
        return findings.find((f) => f.subject === "xvfb");
    }

    it("is advisory, not blocking: an interactive run on a machine with a display never needs it", async () => {
        expect((await xvfbFinding(""))?.severity).toBe("advisory");
    });

    it("explains the block it prevents, so it does not read as a missing nicety", async () => {
        const finding = await xvfbFinding("");
        expect(finding?.message).toContain("Cloudflare");
        expect(finding?.message).toContain("HeadlessChrome");
    });

    it("points at the two commands that fix it, and notes the unit needs no reinstall", async () => {
        const finding = await xvfbFinding("");
        expect(finding?.remedy).toContain("apt install xvfb");
        expect(finding?.remedy).toContain("daemon-reload");
    });

    it("says nothing when xvfb-run is on PATH", async () => {
        expect(await xvfbFinding("/usr/bin/xvfb-run")).toBeUndefined();
    });
});

describe("diagnose: --live", () => {
    it("makes no network call without --live, and says the sheet is unverified", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const findings = await diagnose(options(configPath, authFile, { loadSheet: neverCalled }));
        const unverified = findings.find((f) => f.subject === "sheet");
        expect(unverified?.severity).toBe("advisory");
        expect(unverified?.remedy).toContain("--live");
        expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
    });

    it("probes the spreadsheet and passes when the reader returns tabs", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const calls: string[] = [];
        const loadSheet: typeof loadGoogleSheets = async (id, range, sa) => {
            calls.push(id);
            expect(sa.client_email).toBe("bot@example.iam.gserviceaccount.com");
            expect(range).toBeUndefined();
            return [{ tab: "Oct 2026", csv: "Aug 25th,18:00\nKento Momota\n" }];
        };
        const findings = await diagnose(options(configPath, authFile, { live: true, loadSheet }));
        expect(calls).toEqual(["SHEET123"]);
        expect(matching(findings, "not verified")).toHaveLength(0);
        expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
    });

    it("turns a read failure into a blocking finding that names the sheet to share", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const loadSheet: typeof loadGoogleSheets = async () => {
            throw new Error("400: Invalid Credentials");
        };
        const findings = await diagnose(options(configPath, authFile, { live: true, loadSheet }));
        const found = findings.find((f) => f.subject.startsWith("sheet "));
        expect(found?.severity).toBe("blocking");
        expect(found?.message).toContain("Invalid Credentials");
        expect(found?.remedy).toContain("bot@example.iam.gserviceaccount.com");
    });

    it("probes each distinct spreadsheet once, not once per job", async () => {
        const config = configJson({
            jobs: [
                {
                    name: "a",
                    enabled: true,
                    session: { roster: { sheet: "SHEET123" } },
                },
                {
                    name: "b",
                    enabled: true,
                    session: { roster: { sheet: "SHEET123" } },
                },
            ],
        });
        const { configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        let calls = 0;
        const loadSheet: typeof loadGoogleSheets = async () => {
            calls += 1;
            return [{ tab: "Oct 2026", csv: "" }];
        };
        await diagnose(options(configPath, authFile, { live: true, loadSheet }));
        expect(calls).toBe(1);
    });

    it("passes an explicit range through to the reader", async () => {
        const config = configJson({
            jobs: [
                { name: "a", enabled: true, session: { roster: { sheet: "SHEET123", range: "Oct 2026!A1:D50" } } },
            ],
        });
        const { configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        let seen: string | undefined;
        const loadSheet: typeof loadGoogleSheets = async (_id, range) => {
            seen = range;
            return [{ tab: "range", csv: "" }];
        };
        await diagnose(options(configPath, authFile, { live: true, loadSheet }));
        expect(seen).toBe("Oct 2026!A1:D50");
    });

    it("does not probe anything when every roster is a local file", async () => {
        const config = configJson({
            google: undefined,
            jobs: [{ name: "local", enabled: true, session: { roster: "rosters/example.csv" } }],
        });
        const { dir, configPath, authFile } = fixture(config, { "auth.json": VALID_AUTH });
        fs.mkdirSync(path.join(dir, "rosters"), { recursive: true });
        fs.writeFileSync(path.join(dir, "rosters", "example.csv"), "Aug 25th,18:00\nKento Momota\n");

        const findings = await diagnose(options(configPath, authFile, { live: true, loadSheet: neverCalled }));
        expect(matching(findings, "not verified")).toHaveLength(0);
    });
});

describe("runDoctor: reporting", () => {
    it("succeeds and logs a summary when nothing is blocking", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const { logger, lines } = recordingLogger();
        const ok = await runDoctor(options(configPath, authFile), logger);

        expect(ok).toBe(true);
        expect(lines.filter((l) => l.level === "error")).toEqual([]);
        expect(lines.some((l) => l.level === "info" && l.msg.includes("doctor OK"))).toBe(true);
    });

    it("reminds a non-live pass that the rosters were never verified", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const { logger, lines } = recordingLogger();
        await runDoctor(options(configPath, authFile), logger);
        expect(lines.some((l) => l.msg.includes("--live"))).toBe(true);
    });

    it("drops that reminder once --live has actually checked", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const loadSheet: typeof loadGoogleSheets = async () => [{ tab: "Oct 2026", csv: "" }];
        const { logger, lines } = recordingLogger();
        await runDoctor(options(configPath, authFile, { live: true, loadSheet }), logger);
        expect(lines.some((l) => l.level === "info" && l.msg.includes("rosters not verified"))).toBe(false);
    });

    it("fails and logs every problem at error, each with its fix", async () => {
        const { configPath, authFile } = fixture(); // no auth.json, and a seeded-looking key
        const { logger, lines } = recordingLogger();
        const ok = await runDoctor(options(configPath, authFile), logger);

        expect(ok).toBe(false);
        const errors = lines.filter((l) => l.level === "error");
        expect(errors.some((l) => l.msg.startsWith("FAIL  auth.json"))).toBe(true);
        expect(errors.some((l) => l.msg.startsWith("      fix:"))).toBe(true);
        expect(errors.some((l) => l.msg.includes("doctor FAILED"))).toBe(true);
    });

    it("counts warnings in a successful summary without treating them as failure", async () => {
        const { configPath, authFile } = fixture(configJson(), { "auth.json": VALID_AUTH });
        const { logger, lines } = recordingLogger();
        const ok = await runDoctor(options(configPath, authFile, { env: {} }), logger);

        expect(ok).toBe(true);
        const summary = lines.find((l) => l.level === "info")?.msg;
        expect(summary).toContain("warning");
        expect(lines.some((l) => l.level === "warn" && l.msg.includes("credentials"))).toBe(true);
    });
});
