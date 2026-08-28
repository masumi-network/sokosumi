import { describe, expect, it } from "vitest";

import {
  resolveMinimumOrganizationSeats,
  resolveTargetOrganizationSeats,
} from "./organization-seat-settings-fields";

describe("organization seat settings", () => {
  it("uses 1 as the purchased-seat minimum", () => {
    expect(resolveMinimumOrganizationSeats()).toBe(1);
  });

  it("does not raise the target to cover currently assigned seats", () => {
    expect(resolveTargetOrganizationSeats(5)).toBe(5);
    expect(resolveTargetOrganizationSeats(2)).toBe(2);
    expect(resolveTargetOrganizationSeats(0)).toBe(1);
  });
});
