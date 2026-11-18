"use client";

import { useEffect, useRef } from "react";

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
 * The task page's h1. Next announces a client navigation by the page title
 * only if it has changed by the time the page commits, and the task's title
 * streams in later, so opening a task was often silent. Focusing the heading
 * once per task makes screen readers read the task name every time.
 */
export function TaskTitleHeading({
  taskId,
  title,
}: {
  taskId: string;
  title: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  // Once per task, not on every re-render: a rename or a status change must
  // not pull focus away from the control someone is using.
  useEffect(() => {
    if (isFreshTaskPageLoad()) return;
    if (document.activeElement?.closest(KEEP_FOCUS_SELECTOR)) return;
    heading.current?.focus({ preventScroll: true });
  }, [taskId]);

  return (
    <h1
      ref={heading}
      tabIndex={-1}
      // Ring only for keyboard users, like the SEO verdict heading, with a
      // gap so the title never reads as a text field.
      className="focus-visible:outline-ring rounded-sm text-xl leading-tight font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {title}
    </h1>
  );
}
