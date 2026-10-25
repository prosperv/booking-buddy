import type { Logger } from "../src";
import type { RunTally } from "./ensure-roster";

/**
 * Whether a tally describes a run that needs a human. A deferred roster is
 * deliberately not one of these — it is the normal steady state of walking
 * forward through a month.
 */
export function tallyNeedsAttention(tally: RunTally): boolean {
    return (
        tally.failed > 0 ||
        tally.noBooking > 0 ||
        tally.noUpcoming > 0 ||
        tally.emptyRoster > 0 ||
        tally.saveUnconfirmed > 0 ||
        tally.courtsFailed > 0
    );
}

/** Names accumulated during a run, grouped the way an organizer reads them. */
export type RunReportNames = {
    added: string[];
    removed: string[];
    waitlisted: string[];
    overflow: string[];
    problems: string[];
};

export function emptyReportNames(): RunReportNames {
    return { added: [], removed: [], waitlisted: [], overflow: [], problems: [] };
}

/**
 * Whether a report describes a run that needs attention. Waitlisted and
 * overflow names gate this too — those people are playing without a seat —
 * even though they do not move the `run-end` log level.
 */
export function reportNeedsAttention(tally: RunTally, names: RunReportNames): boolean {
    return tallyNeedsAttention(tally) || names.waitlisted.length > 0 || names.overflow.length > 0;
}

/**
 * Whether a run is worth posting about. A run that edited courts, or that needs
 * attention, or that left anyone waiting, is worth telling people about.
 */
export function shouldNotify(tally: RunTally, names: RunReportNames): boolean {
    return reportNeedsAttention(tally, names) || tally.courtsEdited > 0;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Renders a session's date and 24-hour start time as "Tue Oct 27, 6:00 PM".
 * `bot/` is deliberately dayjs-free, so this is done by hand. Falls back to the
 * raw inputs when they do not parse, so a surprise format never breaks a report.
 */
export function formatSessionLabel(date: string, startTime: string): string {
    const dateParts = date.split("-");
    const timeParts = startTime.split(":");
    if (dateParts.length !== 3 || timeParts.length !== 2) return `${date} ${startTime}`.trim();
    const y = Number(dateParts[0]);
    const m = Number(dateParts[1]);
    const d = Number(dateParts[2]);
    const hh = Number(timeParts[0]);
    const mm = Number(timeParts[1]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(hh) || !Number.isFinite(mm)) {
        return `${date} ${startTime}`.trim();
    }
    const dateObj = new Date(y, m - 1, d, hh, mm);
    if (isNaN(dateObj.getTime())) return `${date} ${startTime}`.trim();
    const hour12 = hh % 12 || 12;
    const ampm = hh < 12 ? "AM" : "PM";
    const minute = String(mm).padStart(2, "0");
    return `${WEEKDAYS[dateObj.getDay()]} ${MONTHS[dateObj.getMonth()]} ${dateObj.getDate()}, ${hour12}:${minute} ${ampm}`;
}

const REASON_TEXT: Record<string, string> = {
    "already-added": "already on the court",
    "not-found": "not found in member search",
    "ambiguous": "two members match this name",
    "member-id-not-found": "pinned id not in search results",
    "query-too-short": "name too short to search",
    "not-added": "search returned nothing",
    "not-in-roster": "not on the roster",
    "not-removable": "is the reservation owner",
};

export function humanReason(reason: string): string {
    return REASON_TEXT[reason] ?? reason;
}

export type RunReport = {
    ok: boolean;
    tally: RunTally;
    summary: string;
    names: RunReportNames;
    sessionLabels: string[];
};

export type RunReportDeps = {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};

const MAX_DESCRIPTION = 3900;

function buildDescription(names: RunReportNames): string {
    const sections: Array<[string, string[]]> = [
        ["Players added to court", names.added],
        ["Players removed", names.removed],
        ["Players on waitlist", names.waitlisted],
        ["Players overflow", names.overflow],
        ["Players with problems", names.problems],
    ];
    const lines: string[] = [];
    for (const [title, items] of sections) {
        lines.push(`**${title}**`);
        if (items.length === 0) {
            lines.push("(none)");
        } else {
            for (const item of items) lines.push(`- ${item}`);
        }
        lines.push("");
    }
    let text = lines.join("\n").trimEnd();
    if (text.length > MAX_DESCRIPTION) {
        text = text.slice(0, MAX_DESCRIPTION) + "\n… (truncated)";
    }
    return text;
}

export function buildDiscordBody(report: RunReport): Record<string, unknown> {
    const needs = reportNeedsAttention(report.tally, report.names);
    const title =
        report.sessionLabels.length > 0 ? report.sessionLabels.join("  ·  ") : "ensure-roster report";
    return {
        username: "Booking Buddy",
        content: needs ? "⚠️ ensure-roster needs attention" : "✅ ensure-roster run complete",
        embeds: [
            {
                title,
                description: buildDescription(report.names),
                color: needs ? 0xc0392b : 0x2ecc71,
                fields: [
                    { name: "Summary", value: report.summary, inline: false },
                    { name: "Courts edited", value: String(report.tally.courtsEdited), inline: true },
                    { name: "Added", value: String(report.tally.added), inline: true },
                    { name: "Removed", value: String(report.tally.removed), inline: true },
                    { name: "Failed", value: String(report.tally.failed), inline: true },
                ],
                timestamp: new Date().toISOString(),
            },
        ],
    };
}

export async function maybeReportRun(
    reporting: { discord: { webhookUrl: string } } | undefined,
    report: RunReport,
    logger: Logger,
    opts: { dryRun: boolean },
    deps?: RunReportDeps,
): Promise<void> {
    if (!reporting) {
        logger.debug("reporting disabled (no reporting block in config)", { event: "report-disabled" });
        return;
    }
    if (opts.dryRun) {
        logger.debug("report skipped: dry run", { event: "report-skipped", reason: "dry-run" });
        return;
    }
    if (!shouldNotify(report.tally, report.names)) {
        logger.debug("report skipped: nothing to report", { event: "report-skipped", reason: "nothing-to-report" });
        return;
    }
    const fetchImpl = deps?.fetchImpl ?? fetch;
    const timeoutMs = deps?.timeoutMs ?? 10000;
    try {
        const response = await fetchImpl(reporting.discord.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildDiscordBody(report)),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
            logger.info("report sent to Discord", {
                event: "report-sent",
                target: new URL(reporting.discord.webhookUrl).host,
                status: response.status,
            });
        } else {
            const body = await response.text().catch(() => "");
            logger.warn(`report failed: Discord returned ${response.status}`, {
                event: "report-failed",
                target: new URL(reporting.discord.webhookUrl).host,
                status: response.status,
                body: body.slice(0, 200),
            });
        }
    } catch (err) {
        logger.warn(`report failed: ${err instanceof Error ? err.message : err}`, {
            event: "report-failed",
            target: safeHost(reporting.discord.webhookUrl),
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return "unknown";
    }
}
