import { maybeReportRun, emptyReportNames, type RunReport } from "../bot/notify";
import type { RunTally } from "../bot/ensure-roster";

async function main(): Promise<void> {
    const webhookUrl = process.argv[2] || process.env.REPORTING_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error("Usage: npx tsx examples/test-reporting.ts <discord-webhook-url>");
        console.error("   or set REPORTING_WEBHOOK_URL in the environment.");
        process.exit(1);
    }

    const tally: RunTally = {
        sessions: 1,
        courtsEdited: 1,
        added: 2,
        removed: 1,
        skipped: 0,
        failed: 1,
        noBooking: 0,
        noUpcoming: 0,
        emptyRoster: 0,
        deferred: 0,
        saveUnconfirmed: 0,
        courtsFailed: 0,
    };

    const names = emptyReportNames();
    names.added.push("Viktor Axelsen", "Kento Momota");
    names.removed.push("Chen Long");
    names.waitlisted.push("Lin Dan");
    names.overflow.push("Tai Tzu-ying (court 8, 6/6)");
    names.problems.push("Lee Chong Wei — ambiguous");

    const report: RunReport = {
        ok: true,
        tally,
        summary: "1 session(s), 1 court(s) edited, 2 added, 1 removed, 0 skipped, 1 failed",
        names,
        sessionLabels: ["Tue Oct 27, 6:00 PM @ Bellevue"],
    };

    await maybeReportRun({ discord: { webhookUrl } }, report, console as never, { dryRun: false });
    console.log("done — check the Discord channel");
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});