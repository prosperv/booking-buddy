#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "fs";

/**
 * Prunes a full-page CourtReserve capture into a test fixture.
 *
 *   npx tsx test/data/recapture.ts <capture.mhtml> [anchor] [out.html] [tag]
 *
 * A capture is a Chrome "Save page as..." MHTML file: a multipart MIME message
 * whose `text/html` part is quoted-printable encoded, several MB, with every
 * stylesheet, image and script inlined as a `cid:` reference. Decode that part,
 * slice the one element the scraper or the test actually reads, and wrap it in
 * a minimal shell. Never commit the `.mhtml` itself (`.gitignore`).
 *
 * `anchor` defaults to the bookings list (`data-testid="booking-tabs"`) and is
 * matched as a literal substring, so it can be any attribute fragment —
 * `data-testid="member-table"`, `class="header-nav`. `tag` names the element to
 * keep; by default it is the nearest enclosing open tag before the anchor, which
 * is why an anchor on a `<table>` or an untagged `<header>` still works.
 */

const DEFAULT_ANCHOR = 'data-testid="booking-tabs"';

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;

function decodeQuotedPrintable(body: Buffer): Buffer {
    const out: number[] = [];
    for (let i = 0; i < body.length; i++) {
        if (body[i] !== 0x3d) {
            out.push(body[i]);
            continue;
        }
        const next = body[i + 1];
        if (next === 0x0d && body[i + 2] === 0x0a) {
            i += 2;
            continue;
        }
        if (next === 0x0a) {
            i += 1;
            continue;
        }
        const hex = body.toString("latin1", i + 1, i + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            out.push(parseInt(hex, 16));
            i += 2;
            continue;
        }
        out.push(body[i]);
    }
    return Buffer.from(out);
}

export function htmlPart(mhtml: Buffer): string {
    const boundary = mhtml.toString("latin1", 0, 4000).match(/boundary="?([^"\r\n]+)"?/);
    if (!boundary) throw new Error("no MIME boundary in the capture");
    const part = mhtml.indexOf(Buffer.from("Content-Type: text/html"));
    if (part < 0) throw new Error("no text/html part in the capture");
    const separator = mhtml.indexOf(Buffer.from("\r\n\r\n"), part);
    if (separator < 0) throw new Error("unterminated part headers");
    const body = mhtml.subarray(separator + 4);
    const end = body.indexOf(Buffer.from(`\r\n--${boundary[1]}`, "latin1"));
    const encoded = body.subarray(0, end < 0 ? body.length : end);
    return decodeQuotedPrintable(encoded).toString("utf-8");
}

export function sliceToAnchor(html: string, anchor: string, tagName?: string): string {
    const at = html.indexOf(anchor);
    if (at < 0) throw new Error(`anchor not found: ${anchor}`);

    let tag = tagName;
    let start = 0;
    if (tag) {
        const open = html.slice(0, at).match(new RegExp(`<${tag}\\b`, "i"));
        if (!open || open.index === undefined) throw new Error(`no <${tag}> before the anchor`);
        start = open.index;
    } else {
        TAG.lastIndex = 0;
        for (let match = TAG.exec(html); match && match.index < at; match = TAG.exec(html)) {
            if (match[1] === "" && match[3] !== "/") {
                start = match.index;
                tag = match[2];
            }
        }
        if (!tag) throw new Error("the anchor is not inside an element");
    }

    // Depth count on the anchor's own tag name: the subtree ends at whichever
    // closing tag brings it back to zero, not at the first `</tag>`.
    let depth = 0;
    TAG.lastIndex = start;
    for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
        if (match[2].toLowerCase() !== tag.toLowerCase()) continue;
        if (match[1] === "/") {
            depth -= 1;
            if (depth === 0) return html.slice(start, match.index + match[0].length);
        } else if (match[3] !== "/") {
            depth += 1;
        }
    }
    throw new Error(`unclosed <${tag}> — the capture is truncated`);
}

export function wrap(subtree: string): string {
    return [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head><meta charset="utf-8"><title>Booking List | powered by CourtReserve</title></head>',
        "<body>",
        subtree,
        "</body>",
        "</html>",
        "",
    ].join("\n");
}

function main(argv: string[]): void {
    const [capture, anchor = DEFAULT_ANCHOR, out, tag] = argv;
    if (!capture) {
        process.stderr.write("usage: recapture.ts <capture.mhtml> [anchor] [out.html] [tag]\n");
        process.exit(1);
    }
    const subtree = sliceToAnchor(htmlPart(readFileSync(capture)), anchor, tag);
    const fixture = wrap(subtree);
    if (out) writeFileSync(out, fixture);
    else process.stdout.write(fixture);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        process.stderr.write(`recapture: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    }
}
