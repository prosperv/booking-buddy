import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

export function parseDatetime(datetimeText: string): {
    dayOfWeek: string;
    startTime: Date;
    endTime: Date;
} {
    const cleaned = datetimeText.replace(/(\d+)(st|nd|rd|th)/, "$1");
    const [weekday, monthDay, times] = cleaned.split(",");
    const [startTime, endTime] = times.trim().split(" - ");
    const datePart = `${monthDay.trim()}`;
    const start = dayjs(`${datePart}, ${startTime}`, "MMM D, h:mm A");
    const end = dayjs(`${datePart}, ${endTime}`, "MMM D, h:mm A");

    return {
        dayOfWeek: weekday.trim(),
        startTime: start.toDate(),
        endTime: end.toDate(),
    };
}

export function parseCourt(locationAndCourt: string): {
    courtNumber: number;
    courtLocation: string;
} {
    const courtNumber = Number(locationAndCourt.split(" ").pop() ?? "0");
    const courtLocation = locationAndCourt.split(" ").slice(0, -1).join(" ");

    return { courtNumber, courtLocation };
}

export function parsePlayers(playersText: string): string[] {
    if (!playersText) return [];
    return playersText.split(",").map((p) => p.trim());
}
