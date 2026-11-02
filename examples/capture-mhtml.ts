import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { BrowserContext, Page } from "playwright";
import { CourtReserveClient } from "../src";

const MAX_SLUG = 60;

/** Collapse a free-form string into a kebab-case slug, falling back to "" when empty. */
export function slugify(input: string): string {
    const lowered = input.toLowerCase().trim();
    const replaced = lowered.replace(/[^a-z0-9]+/g, "-");
    const trimmed = replaced.replace(/^-+|-+$/g, "");
    const collapsed = trimmed.replace(/-{2,}/g, "-");
    return collapsed.slice(0, MAX_SLUG).replace(/-+$/g, "");
}

/**
 * Derive a file-name slug for a page from its title (preferred) and URL.
 * Title wins: take the text before the first `|` or `–`, slugify it. Otherwise
 * use the last non-numeric, non-org-id URL path segment. Falls back to "page".
 */
export function pageSlug(title: string, url: string): string {
    const titlePart = title.split(/\||–/)[0] ?? "";
    const fromTitle = slugify(titlePart);
    if (fromTitle) return fromTitle;

    let segment = "";
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            const candidate = parts[i];
            if (candidate && !/^\d+$/.test(candidate) && candidate.length > 1) {
                segment = candidate;
                break;
            }
        }
    } catch {
        segment = "";
    }
    const fromUrl = slugify(segment);
    return fromUrl || "page";
}

/**
 * Pick a capture filename for `slug`, starting at ordinal `index`. The ordinal
 * is bumped while the candidate is already in `existing` so an earlier capture
 * is never silently overwritten.
 */
export function pickCaptureName(
    slug: string,
    index: number,
    existing: readonly string[],
): string {
    const set = new Set(existing);
    let ordinal = index;
    let name = `${ordinal}-${slug}.mhtml`;
    while (set.has(name)) {
        ordinal += 1;
        name = `${ordinal}-${slug}.mhtml`;
    }
    return name;
}

function printHelp(): void {
    console.log("Usage: npx tsx examples/capture-mhtml.ts [--out <dir>] [--force|-f] [-h|--help]");
    console.log("  --out <dir>   Directory for captures (default: test/data).");
    console.log("  --force, -f   Force a fresh manual login.");
    console.log("  -h, --help    Show this help.");
    console.log("");
    console.log("Keys while running:  y = save current page as MHTML,  x = save auth and exit,  Ctrl+C = save auth and exit.");
}

type Args = { outDir: string; forceLogin: boolean };

function parseArgs(argv: string[]): Args {
    const outIndex = argv.indexOf("--out");
    const outDir = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : "test/data";
    const forceLogin = argv.includes("--force") || argv.includes("-f");
    if (argv.includes("-h") || argv.includes("--help")) {
        printHelp();
        process.exit(0);
    }
    return { outDir, forceLogin };
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const outDir = path.resolve(args.outDir);

    if (!process.stdin.isTTY) {
        console.error("capture-mhtml requires an interactive terminal (TTY).");
        process.exit(1);
    }

    // Warn when captures would land outside test/data, since only that subtree is
    // gitignored for *.mhtml.
    const dataRoot = path.resolve("test/data");
    const insideData = outDir === dataRoot || outDir.startsWith(dataRoot + path.sep);
    if (!insideData) {
        console.warn(`warning: captures in ${outDir} are not gitignored by default (only test/data/**/*.mhtml is).`);
    }

    await fs.mkdir(outDir, { recursive: true });

    const client = new CourtReserveClient({
        headless: false,
        manualLogin: args.forceLogin,
    });
    await client.init();

    const context = client.getContext();
    const page = client.getPage();
    if (!context || !page) {
        await client.close().catch(() => undefined);
        throw new Error("client has no context/page — init() did not complete.");
    }

    // Track whichever tab the user last drove, not just the one init() opened.
    let active: Page = page;
    const track = (p: Page): void => {
        active = p;
        p.on("framenavigated", (frame) => {
            if (frame === p.mainFrame()) active = p;
        });
    };
    for (const p of context.pages()) track(p);
    context.on("page", track);

    const saved: string[] = [];
    let counter = 1;
    let busy = false;
    let saveQueue: Promise<void> = Promise.resolve();

    const restoreTerminal = (): void => {
        try {
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
        } catch {
            // ignore — stdin may already be restored
        }
        process.stdin.pause();
    };

    const shutdown = async (exitCode: number): Promise<void> => {
        restoreTerminal();
        console.log("");
        await waitForSaves().catch(() => undefined);
        try {
            const loggedIn = await client.isLoggedIn();
            console.log(loggedIn ? "session is logged in — auth saved" : "not logged in — auth not saved");
        } catch (err) {
            console.warn(`could not check login state: ${err instanceof Error ? err.message : err}`);
        }
        await client.close().catch((err) => {
            console.warn(`close failed: ${err instanceof Error ? err.message : err}`);
        });
        if (saved.length > 0) {
            console.log(`saved ${saved.length} capture(s):`);
            for (const name of saved) console.log(`  ${name}`);
        } else {
            console.log("no captures saved.");
        }
        process.exit(exitCode);
    };

    const saveCurrent = async (): Promise<void> => {
        const target = active;
        const cdp = await context.newCDPSession(target);
        try {
            const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
            const title = await target.title().catch(() => "");
            const url = target.url();
            const slug = pageSlug(title, url);
            const names = await fs.readdir(outDir).catch(() => [] as string[]);
            const filename = pickCaptureName(slug, counter, names);
            const filePath = path.join(outDir, filename);
            await fs.writeFile(filePath, data, "utf8");
            counter += 1;
            saved.push(filename);
            console.log(`saved ${filename} (${formatBytes(Buffer.byteLength(data, "utf8"))}) — ${url}`);
        } finally {
            await cdp.detach().catch(() => undefined);
        }
    };

    const enqueueSave = (): void => {
        if (busy) {
            console.log("…still saving previous capture, please wait");
            return;
        }
        busy = true;
        saveQueue = saveQueue.then(async () => {
            try {
                await saveCurrent();
            } catch (err) {
                console.error(`capture failed: ${err instanceof Error ? err.message : err}`);
            } finally {
                busy = false;
            }
        });
    };

    // ensure shutdown waits for any in-flight save
    const waitForSaves = (): Promise<void> => saveQueue;

    console.log("Capture tool ready. Browse the site in the window, then:");
    console.log("  y  — save the current page as MHTML");
    console.log("  x  — save auth/profile and exit");
    console.log("  Ctrl+C — save auth/profile and exit");

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (_str: string, key: readline.Key): void => {
        if (key && key.ctrl && key.name === "c") {
            void shutdown(130);
            return;
        }
        const name = key && key.name ? key.name.toLowerCase() : String(_str).toLowerCase();
        if (name === "y") {
            enqueueSave();
        } else if (name === "x") {
            void shutdown(0);
        }
    };
    process.stdin.on("keypress", onKeypress);

    // Keep the process alive; the keypress handler drives everything.
    await new Promise<void>(() => undefined);
}

if (require.main === module) {
    main().catch((error) => {
        try {
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
        } catch {
            // ignore
        }
        console.error("Error:", error);
        process.exit(1);
    });
}
