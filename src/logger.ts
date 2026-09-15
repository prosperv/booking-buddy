import path from "node:path";
import pino from "pino";
import dayjs from "dayjs";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
    flush(): void;
};

export type LoggerOptions = {
    filePath?: string;
    level?: string;
    console?: boolean;
};

/**
 * Resolves the directory logs are written to: an explicit `override` wins,
 * then `LOG_PATH`, then `<cwd>/log`. The file name itself is always
 * predetermined by the caller via `defaultLogFile`.
 */
export function resolveLogDir(override?: string): string {
    return override ?? process.env.LOG_PATH ?? path.join(process.cwd(), "log");
}

/**
 * Builds a date-stamped log file path inside `dir` for a named logger (e.g.
 * `booking-buddy`, `bot`), yielding `<dir>/<name>-<YYYY-MM-DD>.log`. One file
 * per day, appended across that day's runs.
 */
export function defaultLogFile(dir: string, name: string): string {
    return path.join(dir, `${name}-${dayjs().format("YYYY-MM-DD")}.log`);
}

/**
 * Creates a JSON-lines logger that writes to `filePath` (when given) and, by
 * default, mirrors each line to the console so journald and interactive runs
 * keep working. File writes are synchronous so the tail of the log survives a
 * hard crash, and the file/directory are only created on the first write.
 * Pass `console: false` to silence the mirror (e.g. in tests).
 */
export function createLogger(options: LoggerOptions): Logger {
    const { filePath, level, console: mirror = true } = options;

    const resolvedLevel = level ?? process.env.LOG_LEVEL ?? "info";
    let initialized = false;
    let dest: ReturnType<typeof pino.destination> | undefined;
    let pinoLogger: pino.Logger | undefined;

    function ensure(): void {
        if (initialized || !filePath) return;
        initialized = true;
        dest = pino.destination({ dest: filePath, sync: true, mkdir: true });
        pinoLogger = pino(
            {
                level: resolvedLevel,
                base: undefined,
                timestamp: pino.stdTimeFunctions.isoTime,
                formatters: {
                    level: (label) => ({ level: label }),
                },
            },
            dest,
        );
    }

    function write(method: LogLevel, msg: string, fields?: Record<string, unknown>): void {
        if (filePath) {
            ensure();
            pinoLogger?.[method](fields ?? {}, msg);
        }

        if (mirror) {
            const line =
                fields && Object.keys(fields).length > 0 ? `${msg} ${JSON.stringify(fields)}` : msg;
            if (method === "warn" || method === "error") {
                console.error(line);
            } else {
                console.log(line);
            }
        }
    }

    return {
        debug: (msg, fields) => write("debug", msg, fields),
        info: (msg, fields) => write("info", msg, fields),
        warn: (msg, fields) => write("warn", msg, fields),
        error: (msg, fields) => write("error", msg, fields),
        flush: () => {
            try {
                dest?.flushSync();
            } catch {
                // Nothing to do; a sync destination flushes on every write.
            }
        },
    };
}
