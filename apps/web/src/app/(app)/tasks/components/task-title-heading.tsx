"use client";

import { useEffect, useRef } from "react";

// Where someone is working: leave focus there.
const KEEP_FOCUS_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], input, textarea, select, [contenteditable="true"]';

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
    if (document.activeElement?.closest(KEEP_FOCUS_SELECTOR)) return;
    heading.current?.focus({ preventScroll: true });
  }, [taskId]);

  return (
    <h1
      ref={heading}
      tabIndex={-1}
      // Ring only for keyboard users, like the SEO verdict heading.
      className="focus-visible:outline-ring rounded-sm text-xl leading-tight font-semibold tracking-tight focus-visible:outline-2"
    >
      {title}
    </h1>
  );
}
