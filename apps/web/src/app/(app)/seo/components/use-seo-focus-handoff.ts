import { useEffect, useRef } from "react";

/**
 * A control that leaves with its cause (a connect that finished) takes the focus with it: the next cause the
 * box shows gets it on `target` (its text), unless the reader acted somewhere else in the meantime.
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
    if (!handoff.current) return;
    if (hidden) {
      // A press or a focus anywhere while the line waits is the reader's next step: the handoff is over. Not in
      // a dialog: the line's own control opens one, and the work there is the same step.
      const drop = (event: Event) => {
        if ((event.target as Element | null)?.closest?.('[role="dialog"]'))
          return;
        handoff.current = false;
      };
      document.addEventListener("pointerdown", drop, true);
      document.addEventListener("focusin", drop, true);
      return () => {
        document.removeEventListener("pointerdown", drop, true);
        document.removeEventListener("focusin", drop, true);
      };
    }
    handoff.current = false;
    // The page stays where the reader scrolled it.
    if (document.activeElement === document.body)
      target.current?.focus({ preventScroll: true });
  }, [key, hidden]);
  // A control that opens a dialog hands the focus over too: the dialog gives it back to a control that may be
  // gone by then.
  const arm = () => {
    handoff.current = true;
  };
  return { box, target, arm };
}
