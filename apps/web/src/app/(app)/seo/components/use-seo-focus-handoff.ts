import { useRef } from "react";

import { useEventListener } from "@/hooks/effects/use-event-listener";
import { useSeoFocusHandoffDialogReturn } from "@/hooks/effects/use-seo-focus-handoff-dialog-return";
import { useSeoFocusHandoffTarget } from "@/hooks/effects/use-seo-focus-handoff-target";

/**
 * A control that leaves with its cause (a connect that finished) takes the focus with it: the next cause the
 * box shows gets it on `target` (its text), unless the reader acted somewhere else in the meantime.
 */
export function useSeoFocusHandoff(
  key: unknown,
  hidden: boolean,
  /** The dialog the line's control opens is open. */
  dialogOpen: boolean,
) {
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
  // A press or a focus anywhere is the reader's next step, a focus back on the line too: a pending handoff is
  // over. Not in a dialog: the line's own control opens one, and the work there is the same step, in its
  // menus, confirms and popovers too, which sit outside it in a portal. Its overlay is outside: a press there
  // is a cancel.
  const drop = (event: Event) => {
    if (
      (event.target as Element | null)?.closest?.(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]',
      )
    )
      return;
    handoff.current = false;
  };
  useEventListener("document", "pointerdown", drop, true);
  useEventListener("document", "focusin", drop, true);
  useSeoFocusHandoffTarget(handoff, target, key, hidden);
  // The dialog has no trigger to give the focus back to. A control still in place after it closed means nothing
  // changed: the focus goes back to it, as to a trigger, and the handoff is over.
  useSeoFocusHandoffDialogReturn(handoff, box, dialogOpen);
  // A control that opens a dialog hands the focus over too: the dialog gives it back to a control that may be
  // gone by then.
  const arm = () => {
    handoff.current = true;
  };
  return { box, target, arm };
}
