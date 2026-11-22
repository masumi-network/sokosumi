"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Returns focus to the first button inside the SEO focus-handoff container when
 * its dialog closes without replacing the control and focus fell to `document.body`.
 */
export function useSeoFocusHandoffDialogReturn(
  handoff: RefObject<boolean>,
  box: RefObject<HTMLDivElement | null>,
  dialogOpen: boolean,
): void {
  // The dialog has no trigger to give the focus back to. A control still in place after it closed means nothing
  // changed: the focus goes back to it, as to a trigger, and the handoff is over.
  const wasOpen = useRef(dialogOpen);
  useEffect(() => {
    const closed = wasOpen.current && !dialogOpen;
    wasOpen.current = dialogOpen;
    if (!closed || !handoff.current) return;
    const control = box.current?.querySelector<HTMLElement>("button");
    if (!control || document.activeElement !== document.body) return;
    handoff.current = false;
    control.focus({ preventScroll: true });
  }, [dialogOpen]);
}
