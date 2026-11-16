import { useEffect, useRef } from "react";

/**
 * A control that leaves with its cause (a connect that finished) takes the focus with it: the next cause the
 * box shows gets it on `target` (its text), unless the reader put the focus somewhere else in the meantime.
 */
export function useSeoFocusHandoff(key: unknown, hidden: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLParagraphElement>(null);
  const shown = useRef({ key, hidden });
  const handoff = useRef(false);
  // Read in the render that changes the cause, before the commit removes the control that holds the focus: a
  // blur from a removed node says nothing reliable about where the focus was.
  if (shown.current.key !== key || shown.current.hidden !== hidden) {
    handoff.current ||= Boolean(box.current?.contains(document.activeElement));
    shown.current = { key, hidden };
  }
  useEffect(() => {
    if (hidden || !handoff.current) return;
    handoff.current = false;
    if (document.activeElement === document.body) target.current?.focus();
  }, [key, hidden]);
  return { box, target };
}
