import { describe, expect, it } from "vitest";

import {
  BREAKER_SAMPLE_SIZE,
  GLOBAL_INPUT_TOKENS_PER_MINUTE,
  GLOBAL_MAX_CONCURRENT,
  JevScheduler,
  PER_WORKSPACE_INPUT_TOKENS_PER_DAY,
  PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
  PER_WORKSPACE_USD_PER_DAY,
} from "./jev-scheduler";

function fixedClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("JevScheduler", () => {
  it("bounds a burst by the bucket capacity", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    let admitted = 0;
    for (let i = 0; i < 40; i += 1) {
      const decision = scheduler.tryAdmit({
        workspaceId: "w1",
        workClass: "interactive",
        inputTokens: 100,
      });
      if (decision.admitted) {
        admitted += 1;
        scheduler.settle("ok");
      }
    }

    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(40);
  });

  it("refills over time so a sustained rate is allowed", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    while (
      scheduler.tryAdmit({
        workspaceId: "w1",
        workClass: "interactive",
        inputTokens: 10,
      }).admitted
    ) {
      scheduler.settle("ok");
    }

    clock.advance(1_000);
    const afterRefill = scheduler.tryAdmit({
      workspaceId: "w1",
      workClass: "interactive",
      inputTokens: 10,
    });
    expect(afterRefill.admitted).toBe(true);
  });

  it("does not let background work borrow the interactive share", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    let backgroundAdmitted = 0;
    for (let i = 0; i < 40; i += 1) {
      const decision = scheduler.tryAdmit({
        workspaceId: "w1",
        workClass: "background",
        inputTokens: 10,
      });
      if (!decision.admitted) {
        expect(decision.reason).toBe("background-share");
        break;
      }
      backgroundAdmitted += 1;
      scheduler.settle("ok");
    }

    // The interactive class still has its own capacity left.
    const interactive = scheduler.tryAdmit({
      workspaceId: "w1",
      workClass: "interactive",
      inputTokens: 10,
    });
    expect(interactive.admitted).toBe(true);
    expect(backgroundAdmitted).toBeLessThan(40);
  });

  it("caps concurrency at the global maximum", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    let admitted = 0;
    for (let i = 0; i < GLOBAL_MAX_CONCURRENT + 10; i += 1) {
      // Refill between attempts so the rate bucket is not what stops us.
      clock.advance(1_000);
      const decision = scheduler.tryAdmit({
        workspaceId: `w${i}`,
        workClass: "interactive",
        inputTokens: 10,
      });
      if (decision.admitted) {
        admitted += 1;
      } else {
        expect(decision.reason).toBe("global-concurrency");
        break;
      }
    }

    expect(admitted).toBe(GLOBAL_MAX_CONCURRENT);
    expect(scheduler.concurrentRequests).toBe(GLOBAL_MAX_CONCURRENT);
  });

  it("denies a request that would exceed the workspace token budget", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    const decision = scheduler.tryAdmit({
      workspaceId: "w1",
      workClass: "interactive",
      inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE + 1,
    });
    expect(decision).toEqual({
      admitted: false,
      reason: "workspace-token-budget",
    });
  });

  it("denies a request that would exceed the global token budget", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    const decision = scheduler.tryAdmit({
      workspaceId: "w1",
      workClass: "interactive",
      inputTokens: GLOBAL_INPUT_TOKENS_PER_MINUTE + 1,
    });
    expect(decision).toEqual({
      admitted: false,
      reason: "global-token-budget",
    });
  });

  it("opens the breaker after a majority of failures and probes later", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    for (let i = 0; i < BREAKER_SAMPLE_SIZE; i += 1) {
      clock.advance(1_000);
      const decision = scheduler.tryAdmit({
        workspaceId: "w1",
        workClass: "interactive",
        inputTokens: 10,
      });
      expect(decision.admitted).toBe(true);
      scheduler.settle("failed");
    }

    expect(scheduler.isBreakerOpen()).toBe(true);
    clock.advance(1_000);
    expect(
      scheduler.tryAdmit({
        workspaceId: "w1",
        workClass: "interactive",
        inputTokens: 10,
      }),
    ).toEqual({ admitted: false, reason: "breaker-open" });

    clock.advance(60_000);
    expect(
      scheduler.tryAdmit({
        workspaceId: "w1",
        workClass: "interactive",
        inputTokens: 10,
      }).admitted,
    ).toBe(true);
  });

  it("charges a dispatched request even when it failed", () => {
    const clock = fixedClock();
    const scheduler = new JevScheduler(clock.now);

    scheduler.tryAdmit({
      workspaceId: "w1",
      workClass: "interactive",
      inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE - 10,
    });
    scheduler.settle("failed");

    // The tokens are gone for this minute: no refund on failure.
    const second = scheduler.tryAdmit({
      workspaceId: "w1",
      workClass: "interactive",
      inputTokens: 100,
    });
    expect(second).toEqual({
      admitted: false,
      reason: "workspace-token-budget",
    });
  });
});

describe("the two daily budgets are in the same universe", () => {
  /**
   * `PER_WORKSPACE_USD_PER_DAY` was 25 and could not be reached.
   *
   * The token cap is the primary control and the dollar cap is the
   * backstop, but the backstop sat forty times above anything the primary
   * control permits, so it was decoration. Two rounds of review argued
   * about the figure without either side noticing it could never fire.
   *
   * The price comes from a production measurement this repository already
   * records for the same model over the same Gateway — see
   * `task-tag-classification.service.ts` — fitted to about $0.0105 per
   * million code points. The ledger counts code points, so both caps are
   * in one unit and no tokenizer assumption sits in between.
   *
   * This is the relationship, not the numbers: a backstop has to be
   * reachable, and it has to leave room for the price being wrong. Raising
   * the dollar cap back to 25, or cutting the token cap without touching
   * it, turns this red.
   */
  const USD_PER_MILLION_CODE_POINTS = 0.0105;

  const tokenCapWorthUsd =
    (PER_WORKSPACE_INPUT_TOKENS_PER_DAY / 1_000_000) *
    USD_PER_MILLION_CODE_POINTS;

  it("prices the token cap where the review priced it", () => {
    // Guards the arithmetic the rest of this describe rests on.
    expect(tokenCapWorthUsd).toBeCloseTo(0.63, 2);
  });

  it("keeps the dollar backstop above what the tokens allow", () => {
    // Below this it would fire before the primary control, which inverts
    // which one is load-bearing.
    expect(PER_WORKSPACE_USD_PER_DAY).toBeGreaterThan(tokenCapWorthUsd);
  });

  it("keeps it close enough to be reachable", () => {
    /**
     * The failure being fixed. Headroom absorbs a wrong price — the
     * stated error bar is a factor of two — but a backstop forty times
     * above the thing it backs up is not a control.
     */
    expect(PER_WORKSPACE_USD_PER_DAY / tokenCapWorthUsd).toBeLessThan(5);
    expect(PER_WORKSPACE_USD_PER_DAY / tokenCapWorthUsd).toBeGreaterThan(2);
  });
});
