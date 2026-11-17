import { expect, onTestFinished } from "vitest";

import { recordCoreError } from "@/lib/evlog";
import { expectCoreLog } from "@/test/core-log";

/**
 * Stands in for real background work (`waitUntil`) that reaches shared code:
 * its `recordCoreError` writes on the request's event while that request is
 * live, unless the work was started inside `runAsBackgroundWork`. Call it from
 * the mocked target, before its first `await`.
 */
export function probeBackgroundFailure(target: string): void {
  recordCoreError(
    { operation: "background_probe" },
    { message: `Probe failure inside ${target}`, why: "A probe" },
  );
}

/**
 * Declares the probe from `probeBackgroundFailure(target)` once, and checks
 * when the test ends that it landed on its own standalone event, not on the
 * request's wide event (which carries `method`).
 */
export function expectBackgroundProbe(target: string): void {
  const entries = expectCoreLog("error", `Probe failure inside ${target}`);
  onTestFinished(() => {
    expect(entries[0]?.event).toMatchObject({ operation: "background_probe" });
    expect(entries[0]?.event.method).toBeUndefined();
  });
}
