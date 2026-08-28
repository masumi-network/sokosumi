import { describe, expect, it } from "vitest";

import {
  formatConfidence,
  formatDurationMs,
  pickSafeClassification,
  shortId,
} from "../format";

describe("soko-bot format helpers", () => {
  it("formats durations at ms/s/min granularity", () => {
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(450)).toBe("450 ms");
    expect(formatDurationMs(1234)).toBe("1.2 s");
    expect(formatDurationMs(42_000)).toBe("42 s");
    expect(formatDurationMs(125_000)).toBe("2 min 5 s");
    expect(formatDurationMs(120_000)).toBe("2 min");
  });

  it("shortens long ids and passes short ones through", () => {
    expect(shortId(null)).toBeNull();
    expect(shortId("abc")).toBe("abc");
    expect(shortId("0123456789abcdef")).toBe("01234567…");
  });

  it("formats confidence as a percentage", () => {
    expect(formatConfidence(0.874)).toBe("87%");
    expect(formatConfidence("0.5")).toBeNull();
  });

  it("only surfaces safe classification fields", () => {
    const safe = pickSafeClassification({
      confidence: 0.9,
      rationaleSummary: "Explicit task reference",
      requestedOutcome: "Create a task",
      requiresApproval: false,
      requiresClarification: true,
      chainOfThought: "SECRET",
    });
    expect(safe).toEqual({
      confidence: "90%",
      rationaleSummary: "Explicit task reference",
      requestedOutcome: "Create a task",
      requiresClarification: true,
      requiresApproval: false,
    });
    expect(JSON.stringify(safe)).not.toContain("SECRET");
    expect(pickSafeClassification(null)).toEqual({
      confidence: null,
      rationaleSummary: null,
      requestedOutcome: null,
      requiresClarification: null,
      requiresApproval: null,
    });
  });
});

describe("soko-bot usage format helpers", () => {
  it("formats USD with sub-cent precision when needed", async () => {
    const { formatUsd } = await import("../format");
    expect(formatUsd(null)).toBeNull();
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1.234)).toBe("$1.23");
  });

  it("compacts token counts", async () => {
    const { formatTokens } = await import("../format");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(undefined)).toBeNull();
  });
});
