import { describe, expect, it } from "vitest";

import {
  shouldClearTransitioningAfterFailures,
  TRANSITIONING_FAILURE_CLEAR_THRESHOLD,
  TRANSITIONING_MAX_AGE_MS,
} from "@/app/personal-assistant/components/hermes-transitioning";

describe("shouldClearTransitioningAfterFailures", () => {
  it("holds the flag through fewer than the threshold of failures", () => {
    expect(shouldClearTransitioningAfterFailures(0)).toBe(false);
    expect(
      shouldClearTransitioningAfterFailures(
        TRANSITIONING_FAILURE_CLEAR_THRESHOLD - 1,
      ),
    ).toBe(false);
  });

  it("clears at and beyond the threshold so dropped polls never latch it", () => {
    expect(
      shouldClearTransitioningAfterFailures(
        TRANSITIONING_FAILURE_CLEAR_THRESHOLD,
      ),
    ).toBe(true);
    expect(
      shouldClearTransitioningAfterFailures(
        TRANSITIONING_FAILURE_CLEAR_THRESHOLD + 5,
      ),
    ).toBe(true);
  });
});

describe("TRANSITIONING_MAX_AGE_MS", () => {
  it("is 8 minutes — 2× the orchestrator's 4-min roll cap", () => {
    expect(TRANSITIONING_MAX_AGE_MS).toBe(8 * 60_000);
  });
});
