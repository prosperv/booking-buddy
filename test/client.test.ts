import { describe, expect, it } from "vitest";
import { CourtReserveClient } from "../src/index";
import type { Booking, ClientOptions, Credentials } from "../src/types";

/**
 * Constructing a CourtReserveClient never touches Playwright, so option
 * normalization and the pre-init guards are testable without a browser.
 */

// The options field is private; these tests read it deliberately to pin the
// normalization defaults, which are otherwise only observable via a real launch.
// `credentials` stays optional: it is resolved from the environment when the
// caller omits it, so "absent" is a real value here rather than a missing one.
type ResolvedOptions = Omit<Required<ClientOptions>, "credentials"> & { credentials?: Credentials };

function optionsOf(client: CourtReserveClient): ResolvedOptions {
    return (client as unknown as { options: ResolvedOptions }).options;
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
    return {
        bookingId: "58800347",
        dayOfWeek: "Mon",
        startTime: new Date(2026, 7, 10, 18, 0),
        endTime: new Date(2026, 7, 10, 20, 0),
        courtNumber: 3,
        courtLocation: "Bellevue Court",
        players: ["Viktor Axelsen", "Kento Momota"],
        ...overrides,
    };
}

describe("CourtReserveClient constructor", () => {
    it("applies defaults when no options are given", () => {
        const options = optionsOf(new CourtReserveClient());

        expect(options).toEqual({
            // Note: headless defaults to TRUE (env HEADLESS !== "false").
            headless: true,
            authPath: "./auth.json",
            profileDir: "./my-profile",
            manualLogin: false,
            debugPause: false,
            // Unset unless COURTRESERVE_USERNAME/PASSWORD are both exported;
            // test/setup.ts deletes them so a dev shell cannot change this.
            credentials: undefined,
        });
    });

    it("applies the same defaults for an empty options object", () => {
        expect(optionsOf(new CourtReserveClient({}))).toEqual(optionsOf(new CourtReserveClient()));
    });

    it("respects an explicit headless:false", () => {
        // Guards against a regression from `??` to `||`, which would coerce
        // this back to the true default.
        expect(optionsOf(new CourtReserveClient({ headless: false })).headless).toBe(false);
    });

    it("respects an explicit headless:true", () => {
        expect(optionsOf(new CourtReserveClient({ headless: true })).headless).toBe(true);
    });

    it("respects explicit manualLogin and debugPause flags", () => {
        const options = optionsOf(new CourtReserveClient({ manualLogin: true, debugPause: true }));

        expect(options.manualLogin).toBe(true);
        expect(options.debugPause).toBe(true);
    });

    it("overrides authPath and profileDir", () => {
        const options = optionsOf(
            new CourtReserveClient({ authPath: "./custom-auth.json", profileDir: "./custom-profile" }),
        );

        expect(options.authPath).toBe("./custom-auth.json");
        expect(options.profileDir).toBe("./custom-profile");
    });

    it("only overrides the options it is given", () => {
        const options = optionsOf(new CourtReserveClient({ authPath: "./only-this.json" }));

        expect(options.authPath).toBe("./only-this.json");
        expect(options.headless).toBe(true);
        expect(options.profileDir).toBe("./my-profile");
        expect(options.manualLogin).toBe(false);
    });

    it("keeps explicit credentials", () => {
        const credentials = { username: "player@example.com", password: "hunter2" };

        expect(optionsOf(new CourtReserveClient({ credentials })).credentials).toEqual(credentials);
    });

    it("has no credentials by default, so unattended login is opt-in", () => {
        // The env fallback reads the constants captured at import, which
        // test/setup.ts has cleared.
        expect(optionsOf(new CourtReserveClient()).credentials).toBeUndefined();
        expect(optionsOf(new CourtReserveClient({})).credentials).toBeUndefined();
    });
});

describe("CourtReserveClient before init", () => {
    it("rejects getCurrentBookings until init() has run", async () => {
        await expect(new CourtReserveClient().getCurrentBookings()).rejects.toThrow(
            "Client not initialized. Call init() first.",
        );
    });

    it("rejects getCurrentBookings even when filters are supplied", async () => {
        await expect(
            new CourtReserveClient().getCurrentBookings({ weekday: "Mon" }),
        ).rejects.toThrow("Client not initialized");
    });

    it("close() is a no-op when there is no context", async () => {
        await expect(new CourtReserveClient().close()).resolves.toBeUndefined();
    });

    it("close() is safe to call twice", async () => {
        const client = new CourtReserveClient();

        await client.close();
        await expect(client.close()).resolves.toBeUndefined();
    });
});

describe("CourtReserveClient.isLoggedIn", () => {
    it("rejects before init", async () => {
        await expect(new CourtReserveClient().isLoggedIn()).rejects.toThrow(
            "Client not initialized. Call init() first.",
        );
    });
});

describe("CourtReserveClient.ensureLoggedIn", () => {
    it("rejects before init", async () => {
        await expect(new CourtReserveClient().ensureLoggedIn()).rejects.toThrow(
            "Client not initialized. Call init() first.",
        );
    });

    it("rejects before init even when credentials are configured", async () => {
        const client = new CourtReserveClient({ credentials: { username: "player@example.com", password: "x" } });

        await expect(client.ensureLoggedIn()).rejects.toThrow("Client not initialized. Call init() first.");
    });
});

describe("CourtReserveClient.loginWithCredentials", () => {
    it("rejects before init", async () => {
        await expect(
            new CourtReserveClient().loginWithCredentials("user@example.com", "hunter2"),
        ).rejects.toThrow("Client not initialized. Call init() first.");
    });
});

describe("CourtReserveClient.getPlayersFromBooking", () => {
    it("returns the players on the booking", () => {
        const client = new CourtReserveClient();

        expect(client.getPlayersFromBooking(makeBooking())).toEqual([
            "Viktor Axelsen",
            "Kento Momota",
        ]);
    });

    it("returns an empty array for a booking with no players", () => {
        const client = new CourtReserveClient();

        expect(client.getPlayersFromBooking(makeBooking({ players: [] }))).toEqual([]);
    });
});

describe("CourtReserveClient.removePlayerFromBooking guards", () => {
    it("rejects before init", async () => {
        await expect(
            new CourtReserveClient().removePlayerFromBooking(makeBooking(), { name: "Kento Momota" }),
        ).rejects.toThrow("Client not initialized. Call init() first.");
    });

    it("rejects a booking without a bookingId", async () => {
        // bookingId is validated before the (missing) browser session, so this
        // does not need a real launch.
        const client = new CourtReserveClient();

        await expect(
            client.removePlayerFromBooking(makeBooking({ bookingId: "" }), { name: "Kento Momota" }),
        ).rejects.toThrow(/bookingId/);
    });

    it("rejects a batch of removals without a bookingId", async () => {
        const client = new CourtReserveClient();

        await expect(
            client.removePlayersFromBooking(makeBooking({ bookingId: "" }), [
                { name: "Kento Momota" },
                { name: "Chen Long" },
            ]),
        ).rejects.toThrow(/bookingId/);
    });
});

describe("CourtReserveClient.addPlayerToBooking guards", () => {
    it("rejects before init", async () => {
        await expect(
            new CourtReserveClient().addPlayerToBooking(makeBooking(), { name: "New Player" }),
        ).rejects.toThrow("Client not initialized. Call init() first.");
    });

    it("rejects a booking without a bookingId", async () => {
        // bookingId is validated before the (missing) browser session, so this
        // does not need a real launch.
        const client = new CourtReserveClient();

        await expect(
            client.addPlayerToBooking(makeBooking({ bookingId: "" }), { name: "New Player" }),
        ).rejects.toThrow(/bookingId/);
    });
});

describe("CourtReserveClient.swapPlayersOnBooking guards", () => {
    it("rejects before init", async () => {
        await expect(
            new CourtReserveClient().swapPlayersOnBooking(
                makeBooking(),
                [{ name: "Kento Momota" }],
                [{ name: "Chen Long" }],
            ),
        ).rejects.toThrow("Client not initialized. Call init() first.");
    });

    it("rejects a booking without a bookingId", async () => {
        // bookingId is validated before the (missing) browser session, so this
        // does not need a real launch.
        const client = new CourtReserveClient();

        await expect(
            client.swapPlayersOnBooking(
                makeBooking({ bookingId: "" }),
                [{ name: "Kento Momota" }],
                [{ name: "Chen Long" }],
            ),
        ).rejects.toThrow(/bookingId/);
    });
});
