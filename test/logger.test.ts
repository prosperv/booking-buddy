import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dayjs from "dayjs";
import { createLogger, defaultLogFile, resolveLogDir } from "../src/logger";

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-buddy-log-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function readLines(filePath: string): Record<string, unknown>[] {
    return fs
        .readFileSync(filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
}

describe("createLogger", () => {
    it("writes one JSON line per event with time/level/msg/fields", () => {
        const filePath = path.join(makeTempDir(), "test.log");
        const logger = createLogger({ filePath, console: false });

        logger.info("hello", { a: 1 });
        logger.error("boom", { reason: "x" });
        logger.flush();

        const lines = readLines(filePath);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({ level: "info", msg: "hello", a: 1 });
        expect(lines[0].time).toBeTypeOf("string");
        expect(lines[1]).toMatchObject({ level: "error", msg: "boom", reason: "x" });
    });

    it("suppresses messages below the configured level", () => {
        const filePath = path.join(makeTempDir(), "test.log");
        const logger = createLogger({ filePath, level: "warn", console: false });

        logger.debug("hidden");
        logger.info("also hidden");
        logger.warn("seen");
        logger.flush();

        const lines = readLines(filePath);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ level: "warn", msg: "seen" });
    });

    it("appends across createLogger calls on the same file", () => {
        const filePath = path.join(makeTempDir(), "test.log");
        createLogger({ filePath, console: false }).info("first");
        createLogger({ filePath, console: false }).info("second");

        const lines = readLines(filePath);
        expect(lines.map((l) => l.msg)).toEqual(["first", "second"]);
    });

    it("mirrors to console by default but not when disabled", () => {
        const filePath = path.join(makeTempDir(), "test.log");
        const original = console.log;
        const calls: string[] = [];
        console.log = (msg: string) => calls.push(String(msg));
        try {
            createLogger({ filePath, console: false }).info("quiet");
            createLogger({ filePath }).info("loud");
        } finally {
            console.log = original;
        }
        expect(calls).toEqual(["loud"]);
    });
});

describe("resolveLogDir", () => {
    it("prefers the override, then LOG_PATH, then <cwd>/log", () => {
        expect(resolveLogDir("/tmp/custom")).toBe("/tmp/custom");

        process.env.LOG_PATH = "/tmp/env-log";
        try {
            expect(resolveLogDir(undefined)).toBe("/tmp/env-log");
        } finally {
            delete process.env.LOG_PATH;
        }

        expect(resolveLogDir(undefined)).toBe(path.join(process.cwd(), "log"));
    });
});

describe("defaultLogFile", () => {
    it("builds a date-stamped name inside the directory", () => {
        const file = defaultLogFile("/tmp/logs", "booking-buddy");
        expect(file).toBe(`/tmp/logs/booking-buddy-${dayjs().format("YYYY-MM-DD")}.log`);
    });
});
