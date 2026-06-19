import { describe, expect, it } from "vitest";

import { formatCreditsForDisplay } from "../credits";

describe("formatCreditsForDisplay", () => {
  it("truncates decimal values", () => {
    expect(formatCreditsForDisplay(2.4)).toBe(2);
    expect(formatCreditsForDisplay(2.5)).toBe(2);
    expect(formatCreditsForDisplay(2.9)).toBe(2);
  });
});
