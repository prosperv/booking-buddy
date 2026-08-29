import { describe, expect, it } from "vitest";
import { validateConfig, enabledJobs, ConfigError, DEFAULT_COURT_CAPACITY } from "../config";

describe("validateConfig", () => {
    it("accepts a minimal valid config with a default court capacity", () => {
        const config = validateConfig({
            jobs: [{ name: "tuesday", session: { rosterFile: "bot/rosters/tuesday.csv" } }],
        });
        expect(config.jobs).toEqual([
            {
                name: "tuesday",
                enabled: true,
                match: undefined,
                session: { rosterFile: "bot/rosters/tuesday.csv", courtCapacity: DEFAULT_COURT_CAPACITY },
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
                    session: { rosterFile: "r.csv", courtCapacity: 8 },
                },
            ],
        });
        expect(config.jobs[0]).toEqual({
            name: "tuesday",
            enabled: false,
            match: { weekday: "Tue", startTime: "18:00", location: "Bellevue" },
            session: { rosterFile: "r.csv", courtCapacity: 8 },
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
        expect(() => validateConfig({ jobs: [{ session: { rosterFile: "r.csv" } }] })).toThrow(/name/);
    });

    it("rejects duplicate job names", () => {
        expect(() =>
            validateConfig({
                jobs: [
                    { name: "tuesday", session: { rosterFile: "a.csv" } },
                    { name: "tuesday", session: { rosterFile: "b.csv" } },
                ],
            }),
        ).toThrow(/duplicate/);
    });

    it("rejects a non-boolean enabled", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", enabled: "yes", session: { rosterFile: "r.csv" } }] }),
        ).toThrow(/enabled/);
    });

    it("rejects a missing session", () => {
        expect(() => validateConfig({ jobs: [{ name: "t" }] })).toThrow(/session/);
    });

    it("rejects a session without a rosterFile", () => {
        expect(() => validateConfig({ jobs: [{ name: "t", session: {} }] })).toThrow(/rosterFile/);
    });

    it("rejects an invalid courtCapacity", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { rosterFile: "r.csv", courtCapacity: 0 } }] }),
        ).toThrow(/courtCapacity/);
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { rosterFile: "r.csv", courtCapacity: 5.5 } }] }),
        ).toThrow(/courtCapacity/);
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { rosterFile: "r.csv", courtCapacity: "6" } }] }),
        ).toThrow(/courtCapacity/);
    });

    it("keeps an explicit organizer", () => {
        const config = validateConfig({
            jobs: [{ name: "t", session: { rosterFile: "r.csv", organizer: "Kento Momota" } }],
        });
        expect(config.jobs[0].session.organizer).toBe("Kento Momota");
    });

    it("trims the organizer name", () => {
        const config = validateConfig({
            jobs: [{ name: "t", session: { rosterFile: "r.csv", organizer: "  Kento Momota  " } }],
        });
        expect(config.jobs[0].session.organizer).toBe("Kento Momota");
    });

    it("rejects a non-string or empty organizer", () => {
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { rosterFile: "r.csv", organizer: 42 } }] }),
        ).toThrow(/organizer/);
        expect(() =>
            validateConfig({ jobs: [{ name: "t", session: { rosterFile: "r.csv", organizer: "  " } }] }),
        ).toThrow(/organizer/);
    });
});

describe("enabledJobs", () => {
    const config = validateConfig({
        jobs: [
            { name: "tuesday", session: { rosterFile: "a.csv" } },
            { name: "disabled", enabled: false, session: { rosterFile: "b.csv" } },
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
