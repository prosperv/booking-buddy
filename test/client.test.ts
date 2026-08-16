import { describe, expect, it } from "vitest";
import { CourtReserveClient } from "../src/index";
import type { Booking, ClientOptions } from "../src/types";

/**
 * Constructing a CourtReserveClient never touches Playwright, so option
 * normalization and the pre-init guards are testable without a browser.
 */

// The options field is private; these tests read it deliberately to pin the
// normalization defaults, which are otherwise only observable via a real launch.
function optionsOf(client: CourtReserveClient): Required<ClientOptions> {
    return (client as unknown as { options: Required<ClientOptions> }).options;
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
    return {
        bookingId: "58800347",
        dayOfWeek: "Mon",
        startTime: new Date(2026, 7, 10, 18, 0),
        endTime: new Date(2026, 7, 10, 20, 0),
        courtNumber: 3,
        courtLocation: "Bellevue Court",
        players: ["Prosper Van", "Peter Nguyen"],
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

describe("CourtReserveClient.getPlayersFromBooking", () => {
    it("returns the players on the booking", () => {
        const client = new CourtReserveClient();

        expect(client.getPlayersFromBooking(makeBooking())).toEqual([
            "Prosper Van",
            "Peter Nguyen",
        ]);
    });

    it("returns an empty array for a booking with no players", () => {
        const client = new CourtReserveClient();

        expect(client.getPlayersFromBooking(makeBooking({ players: [] }))).toEqual([]);
    });
});

describe("CourtReserveClient unimplemented player mutations", () => {
    // These will fail once the methods are implemented, which is the point:
    // they flag that real coverage is now required.
    it("addPlayerToBooking throws until implemented", async () => {
        await expect(
            new CourtReserveClient().addPlayerToBooking(makeBooking(), { name: "New Player" }),
        ).rejects.toThrow(/Not yet implemented/);
    });

    it("removePlayerFromBooking throws until implemented", async () => {
        await expect(
            new CourtReserveClient().removePlayerFromBooking(makeBooking(), { name: "Prosper Van" }),
        ).rejects.toThrow(/Not yet implemented/);
    });
});
