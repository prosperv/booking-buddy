import { describe, expect, it } from "vitest";
import { credentialsFromEnv, shouldPromptManualLogin } from "../src/index";

/**
 * Both helpers are pure, so the whole "does this run re-login unattended?" decision
 * is testable without a browser: only the login form itself needs Chromium
 * (see test/functional/login.test.ts).
 */

describe("credentialsFromEnv", () => {
    it("returns the pair when both variables are set", () => {
        expect(
            credentialsFromEnv({
                COURTRESERVE_USERNAME: "player@example.com",
                COURTRESERVE_PASSWORD: "hunter2",
            }),
        ).toEqual({ username: "player@example.com", password: "hunter2" });
    });

    it("returns undefined for an unset pair", () => {
        expect(credentialsFromEnv({})).toBeUndefined();
    });

    it("returns undefined when only the username is set", () => {
        expect(credentialsFromEnv({ COURTRESERVE_USERNAME: "player@example.com" })).toBeUndefined();
    });

    it("returns undefined when only the password is set", () => {
        expect(credentialsFromEnv({ COURTRESERVE_PASSWORD: "hunter2" })).toBeUndefined();
    });

    it("treats blank values as unset, not as empty credentials", () => {
        // `EnvironmentFile=` and `export X=` both yield "", and `??` would let
        // that through as a real value.
        expect(credentialsFromEnv({ COURTRESERVE_USERNAME: "", COURTRESERVE_PASSWORD: "" })).toBeUndefined();
        expect(
            credentialsFromEnv({ COURTRESERVE_USERNAME: "player@example.com", COURTRESERVE_PASSWORD: "" }),
        ).toBeUndefined();
    });

    it("treats a whitespace-only value as unset", () => {
        expect(
            credentialsFromEnv({ COURTRESERVE_USERNAME: "   ", COURTRESERVE_PASSWORD: "hunter2" }),
        ).toBeUndefined();
        expect(
            credentialsFromEnv({ COURTRESERVE_USERNAME: "player@example.com", COURTRESERVE_PASSWORD: " " }),
        ).toBeUndefined();
    });

    it("trims the username but keeps the password verbatim", () => {
        // Padding is plausible in an env file; whitespace in a password is real.
        expect(
            credentialsFromEnv({
                COURTRESERVE_USERNAME: "  player@example.com  ",
                COURTRESERVE_PASSWORD: "  hunter2  ",
            }),
        ).toEqual({ username: "player@example.com", password: "  hunter2  " });
    });

    it("falls back to the imported env constants", () => {
        // test/setup.ts deletes both vars, so the default is unset here. This
        // pins that the constants are read at import like every other option.
        expect(credentialsFromEnv()).toBeUndefined();
    });
});

describe("shouldPromptManualLogin", () => {
    const prompt = (input: {
        hasSavedAuth: boolean;
        manualLogin: boolean;
        hasCredentials: boolean;
    }): boolean => shouldPromptManualLogin(input);

    it("prompts when a fresh login is explicitly requested", () => {
        expect(prompt({ hasSavedAuth: true, manualLogin: true, hasCredentials: false })).toBe(true);
        expect(prompt({ hasSavedAuth: false, manualLogin: true, hasCredentials: false })).toBe(true);
        // Even with credentials configured, `--force` / `manualLogin` wins, so a
        // desktop run can still log in interactively.
        expect(prompt({ hasSavedAuth: true, manualLogin: true, hasCredentials: true })).toBe(true);
        expect(prompt({ hasSavedAuth: false, manualLogin: true, hasCredentials: true })).toBe(true);
    });

    it("never prompts when there is a saved session to restore", () => {
        expect(prompt({ hasSavedAuth: true, manualLogin: false, hasCredentials: false })).toBe(false);
        expect(prompt({ hasSavedAuth: true, manualLogin: false, hasCredentials: true })).toBe(false);
    });

    it("skips the prompt when credentials can log in unattended", () => {
        // The systemd case: no auth.json and no TTY, so prompting would hang
        // until TimeoutStartSec.
        expect(prompt({ hasSavedAuth: false, manualLogin: false, hasCredentials: true })).toBe(false);
    });

    it("prompts when there is nothing to fall back on", () => {
        expect(prompt({ hasSavedAuth: false, manualLogin: false, hasCredentials: false })).toBe(true);
    });
});
