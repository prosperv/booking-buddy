import { describe, expect, it, vi } from "vitest";
import {
    tallyNeedsAttention,
    reportNeedsAttention,
    shouldNotify,
    emptyReportNames,
    formatSessionLabel,
    humanReason,
    buildDiscordBody,
    maybeReportRun,
    type RunReport,
    type RunReportNames,
} from "../notify";
import type { RunTally } from "../ensure-roster";

function cleanTally(): RunTally {
    return {
        sessions: 0,
        courtsEdited: 0,
        added: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        noBooking: 0,
        noUpcoming: 0,
        emptyRoster: 0,
        deferred: 0,
        saveUnconfirmed: 0,
        courtsFailed: 0,
    };
}

function names(overrides: Partial<RunReportNames> = {}): RunReportNames {
    return { ...emptyReportNames(), ...overrides };
}

describe("tallyNeedsAttention", () => {
    it("is false for a clean tally", () => {
        expect(tallyNeedsAttention(cleanTally())).toBe(false);
    });

    it.each(["failed", "noBooking", "noUpcoming", "emptyRoster", "saveUnconfirmed", "courtsFailed"] as const)(
        "is true when %s is non-zero",
        (key) => {
            const t = cleanTally();
            (t as Record<string, number>)[key] = 1;
            expect(tallyNeedsAttention(t)).toBe(true);
        },
    );
});

describe("shouldNotify", () => {
    it("is false when nothing happened and nothing is waiting", () => {
        expect(shouldNotify(cleanTally(), emptyReportNames())).toBe(false);
    });

    it("is true when a court was edited", () => {
        const t = cleanTally();
        t.courtsEdited = 1;
        expect(shouldNotify(t, emptyReportNames())).toBe(true);
    });

    it("is true when a tally needs attention", () => {
        const t = cleanTally();
        t.failed = 1;
        expect(shouldNotify(t, emptyReportNames())).toBe(true);
    });

    it("is true when players are waitlisted even with a clean tally and no edits", () => {
        expect(shouldNotify(cleanTally(), names({ waitlisted: ["Viktor Axelsen"] }))).toBe(true);
    });

    it("is true when players overflow even with a clean tally and no edits", () => {
        expect(shouldNotify(cleanTally(), names({ overflow: ["Bea (court 8, 6/6)"] }))).toBe(true);
    });

    it("is false when only added/removed names exist but nothing was edited", () => {
        expect(shouldNotify(cleanTally(), names({ added: ["Viktor Axelsen"], removed: ["Kento Momota"] }))).toBe(false);
    });
});

describe("reportNeedsAttention", () => {
    it("does not flip on added or removed names alone", () => {
        expect(reportNeedsAttention(cleanTally(), names({ added: ["Viktor Axelsen"], removed: ["Kento Momota"] }))).toBe(false);
    });
});

describe("formatSessionLabel", () => {
    it("renders an evening slot in 12-hour time", () => {
        expect(formatSessionLabel("2026-10-27", "18:00")).toBe("Tue Oct 27, 6:00 PM");
    });

    it("renders midnight as 12:00 AM", () => {
        expect(formatSessionLabel("2026-10-27", "00:30")).toBe("Tue Oct 27, 12:30 AM");
    });

    it("renders noon as 12:00 PM", () => {
        expect(formatSessionLabel("2026-10-27", "12:00")).toBe("Tue Oct 27, 12:00 PM");
    });

    it("passes an unparseable input through unchanged", () => {
        expect(formatSessionLabel("soon", "later")).toBe("soon later");
    });
});

describe("humanReason", () => {
    it("maps known reasons", () => {
        expect(humanReason("ambiguous")).toBe("two members match this name");
    });

    it("falls back to the raw token", () => {
        expect(humanReason("something-new")).toBe("something-new");
    });
});

describe("buildDiscordBody", () => {
    const report: RunReport = {
        ok: true,
        tally: cleanTally(),
        summary: "0 session(s), 0 court(s) edited",
        names: names({ added: ["Viktor Axelsen"], removed: ["Kento Momota"], waitlisted: ["Chen Long"], overflow: ["Lin Dan (court 8, 6/6)"], problems: ["Tai Tzu-ying — ambiguous"] }),
        sessionLabels: ["Tue Oct 27, 6:00 PM @ Bellevue"],
    };

    it("puts the session label in the title", () => {
        const body = buildDiscordBody(report) as { embeds: Array<{ title: string }> };
        expect(body.embeds[0].title).toBe("Tue Oct 27, 6:00 PM @ Bellevue");
    });

    it("renders the five sections in order", () => {
        const body = buildDiscordBody(report) as { embeds: Array<{ description: string }> };
        const desc = body.embeds[0].description;
        expect(desc.indexOf("Players added to court")).toBeLessThan(desc.indexOf("Players removed"));
        expect(desc.indexOf("Players removed")).toBeLessThan(desc.indexOf("Players on waitlist"));
        expect(desc.indexOf("Players on waitlist")).toBeLessThan(desc.indexOf("Players overflow"));
        expect(desc.indexOf("Players overflow")).toBeLessThan(desc.indexOf("Players with problems"));
        expect(desc).toContain("- Viktor Axelsen");
        expect(desc).toContain("- Kento Momota");
        expect(desc).toContain("- Chen Long");
        expect(desc).toContain("- Lin Dan (court 8, 6/6)");
        expect(desc).toContain("- Tai Tzu-ying — ambiguous");
    });

    it("renders (none) for empty sections", () => {
        const emptyReport: RunReport = { ...report, names: emptyReportNames() };
        const body = buildDiscordBody(emptyReport) as { embeds: Array<{ description: string }> };
        expect(body.embeds[0].description).toContain("(none)");
    });

    it("uses a red colour when attention is needed", () => {
        const needs: RunReport = { ...report, tally: { ...cleanTally(), failed: 1 } };
        const body = buildDiscordBody(needs) as { embeds: Array<{ color: number }> };
        expect(body.embeds[0].color).toBe(0xc0392b);
    });

    it("uses a green colour for a clean run", () => {
        const body = buildDiscordBody({ ...report, names: emptyReportNames() }) as { embeds: Array<{ color: number }> };
        expect(body.embeds[0].color).toBe(0x2ecc71);
    });
});

describe("maybeReportRun", () => {
    const report: RunReport = {
        ok: true,
        tally: cleanTally(),
        summary: "0 session(s), 0 court(s) edited",
        names: names({ waitlisted: ["Viktor Axelsen"] }),
        sessionLabels: [],
    };

    it("does nothing when reporting is not configured", async () => {
        const fetchImpl = vi.fn();
        await maybeReportRun(undefined, report, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() } as never, { dryRun: false }, { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("does nothing on a dry run", async () => {
        const fetchImpl = vi.fn();
        const reporting = { discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" } };
        await maybeReportRun(reporting, report, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() } as never, { dryRun: true }, { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("does nothing when there is nothing to report", async () => {
        const fetchImpl = vi.fn();
        const reporting = { discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" } };
        const quiet: RunReport = { ...report, names: emptyReportNames(), tally: cleanTally() };
        await maybeReportRun(reporting, quiet, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() } as never, { dryRun: false }, { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("posts once when there is something to report", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
        const reporting = { discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" } };
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() } as never;
        await maybeReportRun(reporting, report, logger, { dryRun: false }, { fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith(
            "https://discord.com/api/webhooks/1/abc",
            expect.objectContaining({ method: "POST" }),
        );
    });

    it("never throws when fetch rejects", async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
        const reporting = { discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" } };
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() } as never;
        await expect(maybeReportRun(reporting, report, logger, { dryRun: false }, { fetchImpl })).resolves.toBeUndefined();
    });

    it("never throws on a non-2xx response", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" });
        const reporting = { discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" } };
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() } as never;
        await expect(maybeReportRun(reporting, report, logger, { dryRun: false }, { fetchImpl })).resolves.toBeUndefined();
    });
});