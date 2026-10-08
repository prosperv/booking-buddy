import { courtreservePassword, courtreserveUsername } from "./constants";
import type { Credentials } from "./types";

type CredentialEnv = {
    COURTRESERVE_USERNAME?: string;
    COURTRESERVE_PASSWORD?: string;
};

/**
 * Reads the unattended-login credentials from the environment, or `undefined`
 * when they are not configured. Defaults to the values read at import by
 * `src/constants.ts`, like every other option; the parameter exists so the
 * decision is testable without a browser.
 *
 * Both variables must be present and non-blank: a half-configured pair is no
 * better than none, and `process.env` yields `""` rather than `undefined` for a
 * variable set to an empty value. The username is trimmed because an
 * `EnvironmentFile=` line can carry padding around the value; the password is
 * taken verbatim, since leading or trailing whitespace in a password is real.
 */
export function credentialsFromEnv(
    env: CredentialEnv = {
        COURTRESERVE_USERNAME: courtreserveUsername,
        COURTRESERVE_PASSWORD: courtreservePassword,
    },
): Credentials | undefined {
    const username = env.COURTRESERVE_USERNAME?.trim();
    const password = env.COURTRESERVE_PASSWORD;
    if (!username || !password?.trim()) {
        return undefined;
    }
    return { username, password };
}

/**
 * Whether `init()` should fall through to the interactive manual-login prompt.
 *
 * An explicit `manualLogin` always wins, so a desktop run can still force a
 * fresh login even with credentials configured. Otherwise a saved session is
 * restored and never prompts. The remaining case — no saved session — prompts
 * only when there is nothing to log in with unattended, because on a headless
 * host (systemd) the prompt blocks forever with no TTY to press Enter on.
 */
export function shouldPromptManualLogin(input: {
    hasSavedAuth: boolean;
    manualLogin: boolean;
    hasCredentials: boolean;
}): boolean {
    if (input.manualLogin) {
        return true;
    }
    if (input.hasSavedAuth) {
        return false;
    }
    return !input.hasCredentials;
}
