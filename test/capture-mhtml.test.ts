import { describe, expect, it } from "vitest";
import { pageSlug, pickCaptureName, slugify } from "../examples/capture-mhtml";

describe("slugify", () => {
    it("lowercases and replaces non-alphanumerics with dashes", () => {
        expect(slugify("My Reservations | powered by CourtReserve")).toBe("my-reservations-powered-by-courtreserve");
    });

    it("collapses repeated dashes and trims edges", () => {
        expect(slugify("  ---a---b---  ")).toBe("a-b");
    });

    it("returns empty for an all-punctuation input", () => {
        expect(slugify("!!!")).toBe("");
    });

    it("caps the result", () => {
        const long = "a".repeat(100);
        expect(slugify(long).length).toBeLessThanOrEqual(60);
    });
});

describe("pageSlug", () => {
    it("prefers the title before the pipe", () => {
        expect(pageSlug("My Reservations | powered by CourtReserve", "https://app.courtreserve.com/Online/Bookings/List/7031")).toBe("my-reservations");
    });

    it("falls back to the last non-numeric URL segment", () => {
        expect(pageSlug("", "https://app.courtreserve.com/Online/Reservations/UpdateMyReservation/7031?reservationId=123")).toBe("updatemyreservation");
    });

    it("returns 'page' when nothing usable is available", () => {
        expect(pageSlug("", "https://app.courtreserve.com/7031")).toBe("page");
    });

    it("handles an en dash separator in the title", () => {
        expect(pageSlug("Reservation Detail – CourtReserve", "https://example.com/")).toBe("reservation-detail");
    });
});

describe("pickCaptureName", () => {
    it("uses the requested ordinal when free", () => {
        expect(pickCaptureName("my-reservations", 1, [])).toBe("1-my-reservations.mhtml");
    });

    it("bumps the ordinal past existing files", () => {
        expect(pickCaptureName("my-reservations", 1, ["1-my-reservations.mhtml"])).toBe("2-my-reservations.mhtml");
    });

    it("keeps bumping until a free ordinal is found", () => {
        expect(pickCaptureName("my-reservations", 1, ["1-my-reservations.mhtml", "2-my-reservations.mhtml"])).toBe("3-my-reservations.mhtml");
    });

    it("does not bump for a different slug", () => {
        expect(pickCaptureName("edit-modal", 1, ["1-my-reservations.mhtml"])).toBe("1-edit-modal.mhtml");
    });
});