import { afterEach, describe, expect, it, vi } from "vitest";

/** The queue starts the work a turn later, so let that turn happen. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

import {
  countPushTeardowns,
  isPushWorkPending,
  notePushTeardown,
  queuePushWork,
} from "./push-work-queue.client";

describe("queuePushWork", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs what is asked and hands back its answer", async () => {
    await expect(queuePushWork(async () => "done")).resolves.toBe("done");
  });

  /** The next run is usually the repair for the one that failed. */
  it("runs the next one after a run that failed", async () => {
    const failed = queuePushWork(async () => {
      throw new Error("no");
    });

    await expect(failed).rejects.toThrow("no");
    await expect(queuePushWork(async () => "after")).resolves.toBe("after");
  });

  /** A run answers the reader's request, not the run before it. */
  it("calls the work with no argument of its own", async () => {
    await queuePushWork(async () => "first");
    const work = vi.fn(async () => "second");

    await queuePushWork(work);

    expect(work).toHaveBeenCalledWith();
  });

  it("says work is pending only while a run is unfinished", async () => {
    let finish = () => {};
    const work = queuePushWork(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    expect(isPushWorkPending()).toBe(true);

    await tick();
    finish();
    await work;
    await tick();

    expect(isPushWorkPending()).toBe(false);
  });

  /** A rejected run is finished too, so it must not leave the queue busy. */
  it("stops saying pending after a run that failed", async () => {
    await queuePushWork(async () => {
      throw new Error("no");
    }).catch(() => {});
    await tick();

    expect(isPushWorkPending()).toBe(false);
  });

  /**
   * `pushManager.subscribe()` can stay pending for the life of the page when
   * the push service cannot be reached, and nothing rejects it. The wait is
   * kept anyway: a sign-out that waits pays the cap it already allows itself,
   * while one that gives up reads a browser mid-activation as a browser that
   * never had push, queues no teardown, and is subscribed again behind the
   * reader.
   */
  it("keeps saying pending for a run that never finishes", async () => {
    vi.useFakeTimers();
    // Never settles, on purpose: this is the hang under test. It stays queued
    // for the rest of the file, which is what the module would really be left
    // holding.
    void queuePushWork(() => new Promise<void>(() => {}));

    expect(isPushWorkPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(600_000);

    expect(isPushWorkPending()).toBe(true);
  });
});

describe("countPushTeardowns", () => {
  it("counts each time push is turned off", () => {
    const before = countPushTeardowns();

    notePushTeardown();

    expect(countPushTeardowns()).toBe(before + 1);
  });
});
