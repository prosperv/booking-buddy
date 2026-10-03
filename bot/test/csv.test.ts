import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
    parseRoster,
    parseRosterAll,
    parseRosterCsv,
    parseEventExportCsv,
    parseSignupsExportCsv,
    parseDateLabel,
    formatDateKey,
    type Roster,
    type RosterSet,
} from "../csv";

describe("parseDateLabel", () => {
    it("parses a 3-letter month with ordinal suffix", () => {
        expect(parseDateLabel("Aug 25th")).toEqual({ month: 8, day:25 });
        expect(parseDateLabel("Sep 1st")).toEqual({ month: 9, day:1 });
        expect(parseDateLabel("Oct 2nd")).toEqual({ month: 10, day:2 });
        expect(parseDateLabel("Nov 3rd")).toEqual({ month: 11, day:3 });
    });

    it("parses without a suffix and with full month names", () => {
        expect(parseDateLabel("Aug 25")).toEqual({ month: 8, day:25 });
        expect(parseDateLabel("September 25th")).toEqual({ month: 9, day:25 });
    });

    it("is case-insensitive", () => {
        expect(parseDateLabel("aug 25th")).toEqual({ month: 8, day:25 });
    });

    it("returns null for non-date labels", () => {
        expect(parseDateLabel("name")).toBeNull();
        expect(parseDateLabel("")).toBeNull();
        expect(parseDateLabel("25 Aug")).toBeNull();
        expect(parseDateLabel("Aug")).toBeNull();
    });
});

describe("parseRosterCsv (legacy date-column)", () => {
    it("parses players listed under each date column", () => {
        const set = parseRosterCsv(
            "Aug 25th,Sep 1st,Sep 8th\n" +
                "Kento Momota,Kento Momota,Viktor Axelsen\n" +
                "Viktor Axelsen,Chen Long,Chen Long\n" +
                "Chen Long,,\n",
        );
        expect(set.rosters.map((r) => r.players)).toEqual([
            ["Kento Momota", "Viktor Axelsen", "Chen Long"],
            ["Kento Momota", "Chen Long"],
            ["Viktor Axelsen", "Chen Long"],
        ]);
    });

    it("skips header columns that are not dates", () => {
        const set = parseRosterCsv("name,Aug 25th\nfoo,Kento Momota\nbar,Viktor Axelsen\n");
        expect(set.rosters).toHaveLength(1);
        expect(set.rosters[0].players).toEqual(["Kento Momota", "Viktor Axelsen"]);
    });

    it("trims whitespace, strips quotes, and drops per-column duplicates", () => {
        const set = parseRosterCsv('Aug 25th\n"Kento Momota"\n kento momota \n Chen Long \n');
        expect(set.rosters[0].players).toEqual(["Kento Momota", "Chen Long"]);
    });

    it("handles quoted names containing commas", () => {
        const set = parseRosterCsv('Aug 25th\n"Last, First"\n"Chen Long"\n');
        expect(set.rosters[0].players).toEqual(["Last, First", "Chen Long"]);
    });

    it("returns an empty array for empty or blank input", () => {
        expect(parseRosterCsv("").rosters).toEqual([]);
        expect(parseRosterCsv("\n\n").rosters).toEqual([]);
    });

    it("returns an empty array when no header is a date", () => {
        expect(parseRosterCsv("name,other\nKento Momota,foo\n").rosters).toEqual([]);
    });
});

describe("parseEventExportCsv (new format)", () => {
    const sample =
        "▶,Date,Start Time,\n" +
        ",9/7/2026,6:30 PM,\n" +
        ",,,\n" +
        "#,Paid,Player Name,\n" +
        "1,FALSE,Chou Tien-chen,\n" +
        "2,FALSE,Kento Momota,\n" +
        "3,FALSE,Anders Antonsen,\n" +
        "4,FALSE,Peter Gade,\n";

    it("parses the date, start time, and player names", () => {
        const set = parseEventExportCsv(sample);
        expect(set.rosters).toHaveLength(1);
        const roster = set.rosters[0];
        expect(roster.date.getFullYear()).toBe(2026);
        expect(roster.date.getMonth() + 1).toBe(9);
        expect(roster.date.getDate()).toBe(7);
        expect(roster.startTime).toBe("18:30");
        expect(roster.players).toEqual(["Chou Tien-chen", "Kento Momota", "Anders Antonsen", "Peter Gade"]);
    });

    it("matches by month/day regardless of year", () => {
        const set = parseEventExportCsv(sample);
        expect(set.find(new Date(2026, 8, 7))?.players).toHaveLength(4);
        expect(set.find(new Date(2026, 8, 8))).toBeUndefined();
        // The year on a year-carrying export is ignored, so a booking in a
        // later year on the same month/day still matches.
        expect(set.find(new Date(2027, 8, 7))?.players).toHaveLength(4);
    });

    it("accepts zero-padded M/D/YYYY dates", () => {
        const set = parseEventExportCsv(sample.replace("9/7/2026", "09/07/2026"));
        expect(set.rosters[0].date.getMonth() + 1).toBe(9);
        expect(set.rosters[0].date.getDate()).toBe(7);
    });

    it("drops blank and duplicate player rows", () => {
        const set = parseEventExportCsv(
            "Date,Start Time,Player Name\n9/7/2026,6:30 PM,,\n,,A,\n,,A,\n,,,\n,,B,\n",
        );
        expect(set.rosters[0].players).toEqual(["A", "B"]);
    });

    it("returns no rosters when there is no Player Name column", () => {
        expect(parseEventExportCsv("foo,bar\n1,2\n").rosters).toEqual([]);
    });
});

describe("parseSignupsExportCsv (stacked signups export)", () => {
    it("reads the date, start time, and players from a single block", () => {
        const set = parseSignupsExportCsv(
            "▶,Date,Start Time,Hrs,Location,\n" +
                ",9/7/2026,6:30 PM,2,BBC Mukilteo,\n" +
                ",,,,,,\n" +
                "#,Paid,Player Name,,Pos,\n" +
                "1,FALSE,Chou Tien-chen,,P1,\n" +
                "2,FALSE,Chen Chia Hung,,P2,\n" +
                "3,FALSE,Chen Chia Hung,,P3,\n" +
                "4,FALSE,,\n",
        );
        expect(set.rosters).toHaveLength(1);
        const roster = set.rosters[0];
        expect(roster.date.getFullYear()).toBe(2026);
        expect(roster.date.getMonth() + 1).toBe(9);
        expect(roster.date.getDate()).toBe(7);
        expect(roster.startTime).toBe("18:30");
        expect(roster.players).toEqual(["Chou Tien-chen", "Chen Chia Hung"]);
    });

    it("ignores all other columns and rows", () => {
        const set = parseSignupsExportCsv(
            "▶,Date,Start Time,Hrs,Location,Host,Courts,\n" +
                ",9/7/2026,6:30 PM,2,BBC Mukilteo,Taufik Hidayat,\"1, 3, 4, 5\",\n" +
                ",,,,,,,\n" +
                "#,Paid,Player Name,,Pos,Ct 1,Ct 3,\n" +
                "1,FALSE,Alice,,P1,Alice,X,\n" +
                "2,FALSE,Bob,,P2,Bob,Y,\n",
        );
        expect(set.rosters[0].players).toEqual(["Alice", "Bob"]);
    });

    it("uses the year-less date as month/day only", () => {
        const set = parseSignupsExportCsv(
            "▶,Date,Start Time,\n" +
                ",9/7,6:30 PM,\n" +
                ",,\n" +
                "#,Paid,Player Name,\n" +
                "1,FALSE,Alice,\n",
        );
        const roster = set.rosters[0];
        expect(roster.year).toBeUndefined();
        expect(roster.date.getMonth() + 1).toBe(9);
        expect(roster.date.getDate()).toBe(7);
    });

    it("parses multiple stacked events into one roster each", () => {
        const set = parseSignupsExportCsv(
            "▶,Date,Start Time,\n" +
                ",10/23/2026,9:00 AM,\n" +
                "#,Paid,Player Name,\n" +
                "1,FALSE,Chou Tien-chen,\n" +
                "2,FALSE,Chou Tien-chen,\n" +
                "3,FALSE,Chen Chia Hung,\n" +
                "▶,Date,Start Time,Hrs,\n" +
                ",9/14/2026,6:30 PM,2,\n" +
                "#,Paid,Player Name,\n" +
                "1,FALSE,\n" +
                "▶,Date,Start Time,Hrs,\n" +
                ",9/21/2026,6:30 PM,2,\n" +
                "#,Paid,Player Name,\n" +
                "1,FALSE,Alice,\n",
        );
        expect(set.rosters).toHaveLength(3);
        expect(set.rosters[0].players).toEqual(["Chou Tien-chen", "Chen Chia Hung"]);
        expect(set.rosters[0].startTime).toBe("09:00");
        expect(set.rosters[1].players).toEqual([]);
        expect(set.rosters[1].date.getMonth() + 1).toBe(9);
        expect(set.rosters[1].date.getDate()).toBe(14);
        expect(set.rosters[2].players).toEqual(["Alice"]);
        expect(set.rosters[2].date.getDate()).toBe(21);
    });

    it("returns no rosters when there is no ▶ block", () => {
        expect(parseSignupsExportCsv("a,b,c\n1,2,3\n").rosters).toEqual([]);
    });

    it("skips a block whose date is unparseable", () => {
        const set = parseSignupsExportCsv(
            "▶,Date,Start Time,\n" +
                ",not-a-date,6:30 PM,\n" +
                "#,Paid,Player Name,\n" +
                "1,FALSE,Alice,\n",
        );
        expect(set.rosters).toEqual([]);
    });

    it("skips a block with no Player Name column", () => {
        const set = parseSignupsExportCsv(
            "▶,Date,Start Time,\n" +
                ",9/7/2026,6:30 PM,\n" +
                "#,Paid,Whatever,\n" +
                "1,FALSE,Alice,\n",
        );
        expect(set.rosters).toEqual([]);
    });
});

describe("parseRoster (auto-detection)", () => {
    it("routes the signups layout (▶ marker) to parseSignupsExportCsv", () => {
        const set = parseRoster(
            "▶,Date,Start Time,Hrs,Location,\n" +
                ",9/7/2026,6:30 PM,2,BBC Mukilteo,\n" +
                ",,,,,,\n" +
                "#,Paid,Player Name,,Pos,\n" +
                "1,FALSE,Chou Tien-chen,,P1,\n",
        );
        expect(set.rosters).toHaveLength(1);
        expect(set.rosters[0].players).toEqual(["Chou Tien-chen"]);
        expect(set.rosters[0].startTime).toBe("18:30");
    });

    it("falls back to the event-export parser when Paid/Player Name present but no signups header", () => {
        const set = parseRoster(
            "Date,Start Time,Paid,Player Name\n" +
                "9/7/2026,6:30 PM,FALSE,Chou Tien-chen\n" +
                ",,FALSE,Kento Momota\n",
        );
        // The Player Name header sits in the same row as Paid (no ▶ marker), so
        // the keyword-based event-export parser handles it instead.
        expect(set.rosters).toHaveLength(1);
        expect(set.rosters[0].players).toEqual(["Chou Tien-chen", "Kento Momota"]);
    });

    it("falls back to the date-column format otherwise", () => {
        const set = parseRoster("Aug 25th,Sep 1st\nKento Momota,Chen Long\n");
        expect(set.rosters).toHaveLength(2);
        expect(set.rosters[0].players).toEqual(["Kento Momota"]);
    });

    it("find() matches month/day only for year-less rosters", () => {
        const set = parseRoster("Aug 25th,Sep 1st\nKento Momota,Chen Long\nViktor Axelsen,,\n");
        expect(set.find(new Date(2026, 7, 25))?.players).toEqual(["Kento Momota", "Viktor Axelsen"]);
        expect(set.find(new Date(2026, 7, 26))).toBeUndefined();
    });
});

describe("parseRosterAll + RosterSet.next (month-per-tab spreadsheet)", () => {
    // A real export split across month tabs: Sept-2026.csv holds four Mondays
    // (the last one still unfilled) and Oct-2026.csv the next two.
    const fixture = (name: string) => readFileSync(resolve(process.cwd(), "bot/test/data", name), "utf8");

    const monthTabs = (): RosterSet =>
        parseRosterAll([
            { text: fixture("Sept-2026.csv"), tab: "Sept-2026" },
            { text: fixture("Oct-2026.csv"), tab: "Oct-2026" },
        ]);

    const days = (set: RosterSet) => set.rosters.map((r) => formatDateKey(r.date));
    const picked = (set: RosterSet, from: string, startTime?: string) =>
        formatDateKey(set.next(new Date(from), startTime ? { startTime } : undefined)?.date ?? new Date(1970, 0, 1));
    const expected = ["sep 7", "sep 14", "sep 21", "sep 28", "oct 5", "oct 12"];

    it("reads every session out of every tab and tags where each came from", () => {
        const set = monthTabs();
        expect(days(set)).toEqual(expected);
        expect(set.rosters.map((r) => r.tab)).toEqual([
            "Sept-2026",
            "Sept-2026",
            "Sept-2026",
            "Sept-2026",
            "Oct-2026",
            "Oct-2026",
        ]);
    });

    it("counts the players the sheet itself reports", () => {
        expect(monthTabs().rosters.map((r) => r.players.length)).toEqual([23, 23, 29, 0, 23, 0]);
    });

    it("selects the second session once the first has passed", () => {
        const set = monthTabs();
        expect(picked(set, "2026-09-07T12:00:00")).toBe("sep 7");
        expect(picked(set, "2026-09-08T12:00:00")).toBe("sep 14");
        expect(picked(set, "2026-09-15T12:00:00")).toBe("sep 21");
        expect(picked(set, "2026-09-22T12:00:00")).toBe("sep 28");
    });

    it("reaches every session in order — none skipped, none repeated", () => {
        const set = monthTabs();
        // Starting the day after each session, the bot must land on the very
        // next one every time, so all six become selectable in turn.
        const walked = set.rosters.slice(0, -1).map((roster, i) => {
            const dayAfter = new Date(roster.year ?? 1970, roster.date.getMonth(), roster.date.getDate() + 1, 12);
            return formatDateKey(set.next(dayAfter)!.date);
        });
        expect(walked).toEqual(["sep 14", "sep 21", "sep 28", "oct 5", "oct 12"]);

        // Every session was selected exactly once, in order.
        expect(new Set([...walked, formatDateKey(set.rosters[0].date)]).size).toBe(set.rosters.length);
    });

    it("crosses the tab boundary into the next month's tab", () => {
        const set = monthTabs();
        const next = set.next(new Date("2026-09-29T12:00:00"));
        expect(formatDateKey(next!.date)).toBe("oct 5");
        expect(next!.tab).toBe("Oct-2026");
    });

    it("returns nothing once every session has passed", () => {
        const set = monthTabs();
        expect(set.next(new Date("2026-10-13T12:00:00"))).toBeUndefined();
        expect(set.next(new Date("2027-10-13T12:00:00"))).toBeUndefined();
    });

    it("keeps a same-day session until its start time has gone by", () => {
        const set = monthTabs();
        // The 6:30 PM session is still the next one at 2:00 PM...
        expect(picked(set, "2026-09-07T14:00:00")).toBe("sep 7");
        // ...but at 8:00 PM it has started, so the following one wins.
        expect(picked(set, "2026-09-07T20:00:00")).toBe("sep 14");
    });

    it("restricts the choice to a job's own start-time slot", () => {
        const twoSlots = parseRosterAll([
            "▶,Date,Start Time,\n" +
                ",9/7/2026,6:30 PM,\n" +
                ",,,\n" +
                "#,Paid,Player Name,,\n" +
                "1,TRUE,Chou Tien-chen,,\n" +
                "▶,Date,Start Time,\n" +
                ",9/7/2026,8:00 PM,\n" +
                ",,,\n" +
                "#,Paid,Player Name,,\n" +
                "1,TRUE,Lin Dan,,\n",
        ]);
        expect(twoSlots.rosters.map((r) => r.startTime)).toEqual(["18:30", "20:00"]);
        expect(picked(twoSlots, "2026-09-07T12:00:00", "18:30")).toBe("sep 7");
        expect(picked(twoSlots, "2026-09-07T12:00:00", "20:00")).toBe("sep 7");
        // The 6:30 group is done for, so its next pick is a week later while the
        // 8:00 group still has tonight.
        expect(twoSlots.next(new Date("2026-09-07T19:00:00"), { startTime: "18:30" })).toBeUndefined();
        expect(twoSlots.next(new Date("2026-09-07T19:00:00"), { startTime: "20:00" })?.startTime).toBe("20:00");
    });

    it("rolls a year-less roster forward to its next occurrence", () => {
        const legacy = parseRosterAll(["Aug 25th,Sep 1st\nKento Momota,Chen Long\n"]);
        expect(formatDateKey(legacy.next(new Date(2026, 6, 1))!.date)).toBe("aug 25");
        // Aug 25 has gone by, so the next one up is Sep 1...
        expect(formatDateKey(legacy.next(new Date(2026, 7, 26))!.date)).toBe("sep 1");
        // ...and a lone Aug 25 stays selectable, rolled to the following year,
        // rather than dropping off the end the way a dated roster would.
        const onlyAug = parseRosterAll(["Aug 25th\nKento Momota\n"]);
        expect(formatDateKey(onlyAug.next(new Date(2026, 7, 26))!.date)).toBe("aug 25");
    });

    it("keeps an unfilled block as a roster with no players", () => {
        const set = monthTabs();
        const empty = set.next(new Date("2026-09-22T12:00:00")) as Roster;
        expect(empty.players).toEqual([]);
        expect(formatDateKey(empty.date)).toBe("sep 28");
    });

    it("skips a tab that holds no roster sessions", () => {
        const set = parseRosterAll([
            "Some notes about how this sheet works.\nNothing to see here.\n",
            { text: fixture("Oct-2026.csv"), tab: "Oct-2026" },
        ]);
        expect(set.rosters).toHaveLength(2);
        expect(set.rosters.every((r) => r.tab === "Oct-2026")).toBe(true);
    });

    it("accepts a bare roster file as a single source", () => {
        const set = parseRosterAll(["▶,Date,Start Time,\n,9/7/2026,6:30 PM,\n,,,\n#,Paid,Player Name,,\n1,TRUE,Chou Tien-chen,,\n"]);
        expect(set.rosters).toHaveLength(1);
        expect(set.rosters[0].tab).toBeUndefined();
    });
});
