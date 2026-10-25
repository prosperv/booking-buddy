import { describe, expect, it } from "vitest";
import {
    validateConfig,
    enabledJobs,
    ConfigError,
    DEFAULT_COURT_CAPACITY,
    spreadsheetIdFrom,
} from "../config";

describe("spreadsheetIdFrom", () => {
    it("extracts the id from a full Sheets URL", () => {
        expect(spreadsheetIdFrom("https://docs.google.com/spreadsheets/d/abc123_DEF-xyz/edit#gid=0")).toBe(
            "abc123_DEF-xyz",
        );
    });

    it("returns a bare id unchanged", () => {
        expect(spreadsheetIdFrom("abc123_DEF-xyz")).toBe("abc123_DEF-xyz");
    });

    it("trims surrounding whitespace", () => {
        expect(spreadsheetIdFrom("  abc123  ")).toBe("abc123");
    });
});

describe("validateConfig", () => {
    it("accepts a minimal valid config with a default court capacity", () => {
        const config = validateConfig({
            jobs: [{ name: "tuesday", session: { roster: "bot/rosters/tuesday.csv" } }],
        });
        expect(config.jobs).toEqual([
            {
                name: "tuesday",
                enabled: true,
                match: undefined,
                session: {
                    roster: { kind: "file", path: "bot/rosters/tuesday.csv" },
                    courtCapacity: DEFAULT_COURT_CAPACITY,
                },
            },
        ]);
    });

    it("keeps explicit enabled, match, and courtCapacity", () => {
        const config = validateConfig({
            jobs: [
                {
                    name: "tuesday",
                    enabled: false,
                    match: { weekday: "Tue", startTime: "18:00", location: "Bellevue" },
                    session: { roster: "r.csv", courtCapacity: 8 },
                },
            ],
        });
        expect(config.jobs[0]).toEqual({
            name: "tuesday",
            enabled: false,
            match: { weekday: "Tue", startTime: "18:00", location: "Bellevue" },
            session: { roster: { kind: "file", path: "r.csv" }, courtCapacity: 8 },
        });
    });

    it("parses a Google Sheet URL into a spreadsheet id, defaulting range to undefined", () => {
        const config = validateConfig({
            google: {
                serviceAccount: { client_email: "a@b.c", private_key: "k" },
            },
            jobs: [
                {
                    name: "t",
                    session: {
                        roster: { sheet: "https://docs.google.com/spreadsheets/d/abc123/edit" },
                    },
                },
            ],
        });
        expect(config.jobs[0].session.roster).toEqual({ kind: "googleSheet", spreadsheetId: "abc123" });
    });

    it("keeps an explicit sheet range", () => {
        const config = validateConfig({
            google: { serviceAccount: { client_email: "a@b.c", private_key: "k" } },
            jobs: [{ name: "t", session: { roster: { sheet: "abc123", range: "Signups!A1:Z200" } } }],
        });
        expect(config.jobs[0].session.roster).toEqual({
            kind: "googleSheet",
            spreadsheetId: "abc123",
            range: "Signups!A1:Z200",
        });
    });

    it("rejects a non-object config", () => {
        expect(() => validateConfig(null)).toThrow(ConfigError);
        expect(() => validateConfig("x")).toThrow(ConfigError);
    });

    it("rejects a missing or empty jobs array", () => {
        expect(() => validateConfig({})).toThrow(/jobs/);
        expect(() => validateConfig({ jobs: [] })).toThrow(/jobs/);
    });

    it("rejects a job without a name", () => {
        expect(() => validateConfig({ jobs: [{ session: { roster: "r.csv" } }] })).toThrow(/name/);
    });

    it("rejects duplicate job names", () => {
        expect(() =>
            validateConfig({
                jobs: [
                    { name: "tuesday", session: { roster: "a.csv" } },
                    { name: "tuesday", session: { roster: "b.csv" } },
                ],
            }),
        ).toThrow(/duplicate/);
    });

    it("rejects a non-boolean enabled", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", enabled: "yes", session: { roster: "r.csv" } }] }),
        ).toThrow(/enabled/);
    });

    it("rejects a missing session", () => {
        expect(() => validateConfig({ jobs: [{ name: "t" }] })).toThrow(/session/);
    });

    it("rejects a session without a roster", () => {
        expect(() => validateConfig({ jobs: [{ name: "t", session: {} }] })).toThrow(/roster/);
    });

    it("rejects an empty roster string", () => {
        expect(() => validateConfig({ jobs: [{ name: "t", session: { roster: "  " } }] })).toThrow(
            /roster/,
        );
    });

    it("rejects a roster object without a sheet", () => {
        expect(() => validateConfig({ jobs: [{ name: "t", session: { roster: {} } }] })).toThrow(
            /roster\.sheet/,
        );
    });

    it("rejects a non-string roster source", () => {
        expect(() => validateConfig({ jobs: [{ name: "t", session: { roster: 42 } }] })).toThrow(
            /roster/,
        );
    });

    it("requires google.serviceAccount when a job uses a Google Sheet", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { roster: { sheet: "abc123" } } }] }),
        ).toThrow(/serviceAccount/);
    });

    it("rejects a google.serviceAccount missing client_email or private_key", () => {
        expect(() =>
            validateConfig({ google: { serviceAccount: {} }, jobs: [{ name: "t", session: { roster: "r.csv" } }] }),
        ).toThrow(/client_email/);
        expect(() =>
            validateConfig({
                google: { serviceAccount: { client_email: "a@b.c" } },
                jobs: [{ name: "t", session: { roster: "r.csv" } }],
            }),
        ).toThrow(/private_key/);
    });

    it("rejects an invalid courtCapacity", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { roster: "r.csv", courtCapacity: 0 } }] }),
        ).toThrow(/courtCapacity/);
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { roster: "r.csv", courtCapacity: 5.5 } }] }),
        ).toThrow(/courtCapacity/);
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { roster: "r.csv", courtCapacity: "6" } }] }),
        ).toThrow(/courtCapacity/);
    });

    it("keeps an explicit organizer", () => {
        const config = validateConfig({
            jobs: [{ name: "t", session: { roster: "r.csv", organizer: "Kento Momota" } }],
        });
        expect(config.jobs[0].session.organizer).toBe("Kento Momota");
    });

    it("trims the organizer name", () => {
        const config = validateConfig({
            jobs: [{ name: "t", session: { roster: "r.csv", organizer: "  Kento Momota  " } }],
        });
        expect(config.jobs[0].session.organizer).toBe("Kento Momota");
    });

    it("rejects a non-string or empty organizer", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { roster: "r.csv", organizer: 42 } }] }),
        ).toThrow(/organizer/);
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { roster: "r.csv", organizer: "  " } }] }),
        ).toThrow(/organizer/);
    });
});

describe("validateConfig nameMap", () => {
    const config = (nameMap: unknown) =>
        validateConfig({
            nameMap,
            jobs: [{ name: "t", session: { roster: "r.csv" } }],
        });

    it("normalizes the keys and keeps the member name as written", () => {
        expect(config({ "  Riley   Poe ": " Lee Zii Jia " }).nameMap).toEqual({
            "riley poe": "Lee Zii Jia",
        });
    });

    it("omits the map entirely when it is absent", () => {
        const bare = validateConfig({ jobs: [{ name: "t", session: { roster: "r.csv" } }] });
        expect("nameMap" in bare).toBe(false);
    });

    it("rejects a non-object map", () => {
        expect(() => config("Riley Poe")).toThrow(ConfigError);
        expect(() => config(null)).toThrow(ConfigError);
        expect(() => config([{ from: "Riley Poe" }])).toThrow(/nameMap/);
    });

    it("accepts a member id for a roster name two members share", () => {
        // The club lists "LEE CHONG WEI" and "Lee Chong Wei" as separate members,
        // and the member search returns both for either spelling, so no name
        // mapping can pick between them. The id can.
        expect(config({ "Lee Chong Wei": 6227635 }).nameMap).toEqual({
            "lee chong wei": 6227635,
        });
    });

    it("rejects an empty member name", () => {
        expect(() => config({ "Riley Poe": "   " })).toThrow(/nameMap/);
    });

    it("rejects a member id that is not a positive integer", () => {
        expect(() => config({ "Lee Chong Wei": 0 })).toThrow(/positive integer/);
        expect(() => config({ "Lee Chong Wei": -1 })).toThrow(/positive integer/);
        expect(() => config({ "Lee Chong Wei": 1.5 })).toThrow(/positive integer/);
    });

    it("rejects a value that is neither a name nor an id, naming both options", () => {
        expect(() => config({ "Riley Poe": true })).toThrow(/MemberId/);
        expect(() => config({ "Riley Poe": { memberId: 1 } })).toThrow(/MemberId/);
    });

    it("does not call a name pinned by id a self-mapping", () => {
        // "Lee Chong Wei" -> "Lee Chong Wei" changes no name, so as a string it
        // would be rejected as doing nothing; as an id it is the normal way to
        // say which of two same-named members is meant.
        expect(config({ "Lee Chong Wei": 6227635 }).nameMap).toBeDefined();
    });

    it("rejects an empty roster name", () => {
        expect(() => config({ "   ": "Lee Zii Jia" })).toThrow(/nameMap/);
    });

    it("rejects a name mapped to itself, which would silently do nothing", () => {
        expect(() => config({ "Riley Poe": "riley  POE" })).toThrow(/itself/);
    });

    it("rejects two entries that normalize to the same name", () => {
        expect(() => config({ "Riley Poe": "Lee Zii Jia", "RILEY  poe": "Lee Zii Jiaa" })).toThrow(
            /normalized/,
        );
    });
});

describe("validateConfig reporting", () => {
    const base = { jobs: [{ name: "t", session: { roster: "r.csv" } }] };

    it("accepts an absent reporting block", () => {
        const config = validateConfig(base);
        expect(config.reporting).toBeUndefined();
    });

    it("accepts a valid https webhook url", () => {
        const config = validateConfig({
            ...base,
            reporting: { discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" } },
        });
        expect(config.reporting?.discord.webhookUrl).toBe("https://discord.com/api/webhooks/1/abc");
    });

    it("trims the webhook url", () => {
        const config = validateConfig({
            ...base,
            reporting: { discord: { webhookUrl: "  https://discord.com/api/webhooks/1/abc  " } },
        });
        expect(config.reporting?.discord.webhookUrl).toBe("https://discord.com/api/webhooks/1/abc");
    });

    it("rejects a non-object reporting block", () => {
        expect(() => validateConfig({ ...base, reporting: "x" })).toThrow(/config\.reporting must be an object/);
    });

    it("rejects a missing discord block", () => {
        expect(() => validateConfig({ ...base, reporting: {} })).toThrow(/config\.reporting\.discord must be an object/);
    });

    it("rejects an empty webhook url", () => {
        expect(() => validateConfig({ ...base, reporting: { discord: { webhookUrl: "" } } })).toThrow(
            /config\.reporting\.discord\.webhookUrl must be a non-empty string/,
        );
    });

    it("rejects a non-https webhook url", () => {
        expect(() =>
            validateConfig({ ...base, reporting: { discord: { webhookUrl: "http://discord.com/x" } } }),
        ).toThrow(/config\.reporting\.discord\.webhookUrl must be an https:\/\/ URL/);
    });

    it("rejects a malformed webhook url", () => {
        expect(() =>
            validateConfig({ ...base, reporting: { discord: { webhookUrl: "not a url" } } }),
        ).toThrow(/config\.reporting\.discord\.webhookUrl must be an https:\/\/ URL/);
    });
});
describe("enabledJobs", () => {
    const config = validateConfig({
        jobs: [
            { name: "tuesday", session: { roster: "a.csv" } },
            { name: "disabled", enabled: false, session: { roster: "b.csv" } },
        ],
    });

    it("returns only enabled jobs", () => {
        expect(enabledJobs(config).map((j) => j.name)).toEqual(["tuesday"]);
    });

    it("narrows to a named job", () => {
        expect(enabledJobs(config, "tuesday").map((j) => j.name)).toEqual(["tuesday"]);
    });

    it("throws for an unknown or disabled job name", () => {
        expect(() => enabledJobs(config, "nope")).toThrow(/no enabled job/);
        expect(() => enabledJobs(config, "disabled")).toThrow(/no enabled job/);
    });
});
