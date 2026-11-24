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

/** Whether focus went nowhere: its element left the page. */
export function focusIsLost() {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * The focus a final remove hands to the start's Add by hand: for that
 * removal, on that page. The list's unmount ends it once the render that
 * shows the start is done, so a later start never takes it.
 */
let startFocus: { removal: string; href: string } | null = null;

export function handFocusToStart(removal: string) {
  startFocus = { removal, href: window.location.href };
}

/** That removal failed: its handoff, if still there, is void. */
export function dropStartFocus(removal: string) {
  if (startFocus?.removal === removal) startFocus = null;
}

/** The list left the page: a handoff ends with the render that removed it. */
export function endStartFocus() {
  queueMicrotask(() => {
    startFocus = null;
  });
}

/**
 * True once, when a handoff waits for this page and the member has not moved
 * focus on since.
 */
export function takeStartFocus() {
  const handoff = startFocus;
  startFocus = null;
  return handoff?.href === window.location.href && focusIsLost();
}
