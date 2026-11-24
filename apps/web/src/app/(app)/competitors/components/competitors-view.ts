import type { ProjectCompetitors } from "@sokosumi/core-client";

/**
 * Whether Findings can only show the example: nothing found, no check yet,
 * and the check off.
 */
export function showsExample({ signals, check }: ProjectCompetitors) {
  return (
    !signals.some((signal) => signal.kind !== "SOCIAL") &&
    !check.lastCheckedAt &&
    !check.on
  );
}

let focusStartAdd = false;

/**
 * Whether the start's Add by hand takes focus when it shows: the member
 * removed the last competitor, so the Remove they were on is gone.
 */
export function setStartAddFocus(on: boolean) {
  focusStartAdd = on;
}

/** True once after `setStartAddFocus(true)`. */
export function takeStartAddFocus() {
  const take = focusStartAdd;
  focusStartAdd = false;
  return take;
}
