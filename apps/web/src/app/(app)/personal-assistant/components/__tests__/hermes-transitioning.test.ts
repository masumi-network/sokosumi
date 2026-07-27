import { describe, expect, it } from "vitest";

import {
  shouldClearTransitioningAfterFailures,
  TRANSITIONING_FAILURE_CLEAR_THRESHOLD,
  TRANSITIONING_MAX_AGE_MS,
  withTransitioningCeiling,
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

describe("withTransitioningCeiling", () => {
  it("passes through when not suppressed", () => {
    const data = { transitioning: true, id: "a" };
    expect(withTransitioningCeiling(data, false)).toEqual({
      data,
      maxAgeSuppressed: false,
    });
  });

  it("forces transitioning false while suppressed and server still true", () => {
    const data = { transitioning: true, id: "a" };
    expect(withTransitioningCeiling(data, true)).toEqual({
      data: { transitioning: false, id: "a" },
      maxAgeSuppressed: true,
    });
  });

  it("lifts suppression when the server reports false", () => {
    const data = { transitioning: false, id: "a" };
    expect(withTransitioningCeiling(data, true)).toEqual({
      data,
      maxAgeSuppressed: false,
    });
  });

  it("keeps suppression armed across multiple true reasserts", () => {
    let suppressed = true;
    const first = withTransitioningCeiling({ transitioning: true }, suppressed);
    suppressed = first.maxAgeSuppressed;
    expect(first.data.transitioning).toBe(false);

    const second = withTransitioningCeiling(
      { transitioning: true },
      suppressed,
    );
    expect(second.data.transitioning).toBe(false);
    expect(second.maxAgeSuppressed).toBe(true);
  });

  it("allows a later true after server false lifts the ceiling", () => {
    let suppressed = true;
    const cleared = withTransitioningCeiling(
      { transitioning: false },
      suppressed,
    );
    suppressed = cleared.maxAgeSuppressed;
    expect(suppressed).toBe(false);

    const nextRoll = withTransitioningCeiling(
      { transitioning: true },
      suppressed,
    );
    expect(nextRoll.data.transitioning).toBe(true);
    expect(nextRoll.maxAgeSuppressed).toBe(false);
  });
});
