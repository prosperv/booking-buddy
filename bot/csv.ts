import fs from "node:fs";

/**
 * Parses a single-column roster CSV: one player name per line. Blank lines are
 * ignored, a leading "name" header row is skipped, surrounding whitespace and
 * quotes are trimmed, and duplicates are dropped (case-insensitively, keeping
 * first occurrence). Extra columns are ignored — the roster is column A.
 */
export function parseRosterCsv(text: string): string[] {
    const names: string[] = [];
    const seen = new Set<string>();

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "") continue;

        const first = (trimmed.split(",")[0] ?? "").trim().replace(/^"|"$/g, "");
        if (first === "") continue;

        // Header row: skip a leading "name" label (case-insensitive).
        if (names.length === 0 && /^name$/i.test(first)) continue;

        const key = first.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(first);
    }

    return names;
}

/** Reads a roster CSV from disk, throwing a descriptive error when missing/unreadable. */
export function loadRosterFile(path: string): string[] {
    let text: string;
    try {
        text = fs.readFileSync(path, "utf8");
    } catch (err) {
        throw new Error(`could not read roster at ${path}: ${err instanceof Error ? err.message : err}`);
    }
    return parseRosterCsv(text);
}
