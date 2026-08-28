import { describe, expect, it } from "vitest";

import {
  ensureAssignedSeatsWithinCapacity,
  ensurePurchasedSeatsSufficient,
  getSortedUniqueUserIds,
  getUnusedSeatCount,
  resolvePurchasedSeats,
} from "./organization-seats.js";

describe("organization-seats helpers", () => {
  it("resolvePurchasedSeats falls back to 1", () => {
    expect(resolvePurchasedSeats(null)).toBe(1);
    expect(resolvePurchasedSeats(0)).toBe(1);
    expect(resolvePurchasedSeats(5)).toBe(5);
  });

  it("getUnusedSeatCount never returns negative values", () => {
    expect(getUnusedSeatCount(10, 3)).toBe(7);
    expect(getUnusedSeatCount(3, 10)).toBe(0);
  });

  it("ensureAssignedSeatsWithinCapacity throws when over capacity", () => {
    expect(() => ensureAssignedSeatsWithinCapacity(6, 5)).toThrow(
      "Assigned seat count (6) exceeds purchased seats (5)",
    );
  });

  it("ensurePurchasedSeatsSufficient requires an integer of at least 1", () => {
    expect(() => ensurePurchasedSeatsSufficient(1)).not.toThrow();
    expect(() => ensurePurchasedSeatsSufficient(4)).not.toThrow();
    expect(() => ensurePurchasedSeatsSufficient(0)).toThrow(
      "Purchased seats must be an integer of at least 1",
    );
    expect(() => ensurePurchasedSeatsSufficient(1.5)).toThrow(
      "Purchased seats must be an integer of at least 1",
    );
  });

  it("getSortedUniqueUserIds deduplicates and sorts", () => {
    expect(getSortedUniqueUserIds(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});
