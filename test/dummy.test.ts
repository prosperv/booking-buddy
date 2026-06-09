import { describe, expect, it } from "vitest";

describe("dummy examples", () => {
  it("verifies simple array membership", () => {
    const players = ["Alice", "Bob", "Charlie"];
    expect(players).toContain("Bob");
  });

  it("checks basic object structure", () => {
    const booking = {
      dayOfWeek: "Sat",
      courtNumber: 3,
      players: ["Alice", "Bob"],
    };

    expect(booking).toMatchObject({ dayOfWeek: "Sat", courtNumber: 3 });
    expect(booking.players).toHaveLength(2);
  });
});
