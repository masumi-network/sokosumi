import { describe, expect, it } from "vitest";

import {
  drivePixelOpacity,
  drivePixelOpacityAtPhase,
  formatBeautifulElapsed,
} from "../coworker-thought-ui";

describe("formatBeautifulElapsed", () => {
  it("matches Beautiful UI tenths under a minute", () => {
    expect(formatBeautifulElapsed(0)).toBe("0.0s");
    expect(formatBeautifulElapsed(10_400)).toBe("10.4s");
    expect(formatBeautifulElapsed(59_900)).toBe("59.9s");
  });

  it("formats a minute and above as m s.s", () => {
    expect(formatBeautifulElapsed(60_000)).toBe("1m 0.0s");
    expect(formatBeautifulElapsed(75_500)).toBe("1m 15.5s");
  });
});

describe("drivePixelOpacityAtPhase", () => {
  it("is dim at start and end of cycle", () => {
    expect(drivePixelOpacityAtPhase(0)).toBeCloseTo(0.15, 2);
    expect(drivePixelOpacityAtPhase(0.8)).toBeCloseTo(0.15, 2);
  });

  it("is bright mid-peak", () => {
    expect(drivePixelOpacityAtPhase(0.3)).toBeCloseTo(1, 2);
  });
});

describe("drivePixelOpacity", () => {
  it("offsets cells so the wave moves left to right", () => {
    // At t=200ms with 140ms step, col0 is ahead of col2 on the first row.
    const left = drivePixelOpacity(200, 0, 1000);
    const right = drivePixelOpacity(200, 280, 1000);
    expect(left).toBeGreaterThan(right);
  });
});
