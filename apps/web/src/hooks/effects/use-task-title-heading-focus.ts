"use client";

import { type RefObject, useEffect } from "react";

// Where someone is working: leave focus there.
const KEEP_FOCUS_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], input, textarea, select, [contenteditable="true"]';

// A task's own URL, not Edit or Archived.
const TASK_PAGE_PATH = /^\/tasks\/(?!archived(?:\/|$))[^/]+\/?$/;

let firstHeading = true;

/**
 * True for the first heading of a document that was loaded at a task's own
 * URL (refresh, new tab, pasted link). Reading starts at the top there
 * anyway, and moving focus would only draw the ring as a box around the
 * title. Every later task this document opens moves focus as usual.
 */
function isFreshTaskPageLoad(): boolean {
  if (!firstHeading) return false;
  firstHeading = false;
  const [entry] = performance.getEntriesByType("navigation");
  return entry ? TASK_PAGE_PATH.test(new URL(entry.name).pathname) : false;
}

/**
 * Focuses `TaskTitleHeading` once per `taskId` with `preventScroll` on client
 * navigation, skipping a fresh task-URL load and active controls matching
 * `KEEP_FOCUS_SELECTOR`.
 */
export function useTaskTitleHeadingFocus(
  heading: RefObject<HTMLHeadingElement | null>,
  taskId: string,
): void {
  // Once per task, not on every re-render: a rename or a status change must
  // not pull focus away from the control someone is using.
  useEffect(() => {
    if (isFreshTaskPageLoad()) return;
    if (document.activeElement?.closest(KEEP_FOCUS_SELECTOR)) return;
    heading.current?.focus({ preventScroll: true });
  }, [taskId]);
}
