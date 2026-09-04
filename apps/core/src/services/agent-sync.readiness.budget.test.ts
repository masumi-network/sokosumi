import { describe, expect, it } from "vitest";

import {
  READINESS_ATTEMPT_TIMEOUT_MS,
  READINESS_BACKOFF_MS,
  READINESS_TOTAL_TIMEOUT_MS,
} from "./agent-sync.readiness.js";

/**
 * The retry budget is three numbers that only work as a set, and none of them
 * is reachable from a behavioural test: AbortSignal.timeout does not go
 * through the global setTimeout, so vitest's fake timers cannot wind it
 * forward. These assert the relationships the comments in the source promise,
 * which is what breaks if any single number is tuned on its own.
 */
describe("readiness retry budget", () => {
  it("lets a hanging node have a second attempt but not a third", () => {
    // "a node that hangs gets two attempts and no more" — the ceiling has to
    // outlast one attempt and fall short of two.
    expect(READINESS_TOTAL_TIMEOUT_MS).toBeGreaterThan(
      READINESS_ATTEMPT_TIMEOUT_MS,
    );
    expect(READINESS_TOTAL_TIMEOUT_MS).toBeLessThan(
      READINESS_ATTEMPT_TIMEOUT_MS * 2,
    );
  });

  it("leaves room for every backoff a fast-failing node would spend", () => {
    // "a fast-failing node fits all four attempts and the backoff inside it".
    const totalBackoff = READINESS_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    expect(totalBackoff).toBeLessThan(READINESS_TOTAL_TIMEOUT_MS);
  });

  it("has one backoff step per retry", () => {
    // A missing step would silently fall back to the last one, so a shortened
    // array would change the pacing without failing anything else.
    expect(READINESS_BACKOFF_MS).toHaveLength(3);
  });
});
