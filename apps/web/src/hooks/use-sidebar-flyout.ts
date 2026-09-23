"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

/**
 * Long enough that sweeping the pointer up the sidebar towards the logo does
 * not flash the panel open, short enough that aiming at the row feels direct.
 * Matches the chat participant hover card so both flyouts in the app answer
 * the pointer on the same beat.
 */
const FLYOUT_OPEN_DELAY_MS = 200;
const FLYOUT_CLOSE_DELAY_MS = 100;

/**
 * Opening the panel from the row, for a reader who is not holding a pointer.
 * Right matches the side the panel comes out on; down is what a menu button
 * answers to, and costs nothing to accept as well.
 */
const FLYOUT_OPEN_KEYS = new Set(["ArrowRight", "ArrowDown"]);

/**
 * A sidebar row that is a link to its page and a flyout beside it: Projects,
 * and the Threads entry (SOK-1159). The row keeps navigating on click and
 * Enter; the pointer opens the panel after a beat, the arrow keys open it
 * from the keyboard. One behaviour for both, so the two rows cannot drift.
 *
 * Spread `rowProps` on the row's link and `contentProps` on the
 * `PopoverContent` of a `modal={false}` Popover anchored to that row.
 * `enabled` false (no panel to show) leaves the row a plain link.
 */
export function useSidebarFlyout({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openedByPointer = useRef(false);
  const interactedOutside = useRef(false);

  function clearPending() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }

  // The pointer can leave with a timer still owing; unmounting behind it would
  // otherwise set state on a component that is gone.
  useMountEffect(() => clearPending);

  // Which way the panel was opened decides who owns focus: a pointer must not
  // pull it off whatever the reader was typing in, and a keyboard open is
  // worthless unless focus follows into the rows.
  function openForPointer() {
    clearPending();
    openTimer.current = setTimeout(() => {
      openedByPointer.current = true;
      setOpen(true);
    }, FLYOUT_OPEN_DELAY_MS);
  }

  function closeForPointer() {
    clearPending();
    closeTimer.current = setTimeout(
      () => setOpen(false),
      FLYOUT_CLOSE_DELAY_MS,
    );
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLAnchorElement>) {
    if (!enabled || !FLYOUT_OPEN_KEYS.has(event.key)) return;
    // Enter is left alone, so the row still navigates the way a link should.
    event.preventDefault();
    clearPending();
    openedByPointer.current = false;
    interactedOutside.current = false;
    setOpen(true);
  }

  return {
    open,
    setOpen,
    rowProps: {
      ref: rowRef,
      onPointerEnter: enabled ? openForPointer : undefined,
      onPointerLeave: enabled ? closeForPointer : undefined,
      onKeyDown: handleRowKeyDown,
      "aria-expanded": enabled ? open : undefined,
    },
    contentProps: {
      // A pointer open leaves focus where it was; a keyboard open sends it
      // into the rows, which is the whole point of opening that way.
      onOpenAutoFocus: (event: Event) => {
        if (openedByPointer.current) event.preventDefault();
      },
      // Radix would restore to a trigger there is not. Escape should land
      // back on the row; a click or focus outside should not — there is no
      // trigger, so Radix also no longer withholds that restore after an
      // outside interaction.
      onInteractOutside: () => {
        interactedOutside.current = true;
      },
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        if (interactedOutside.current) {
          interactedOutside.current = false;
          return;
        }
        if (!openedByPointer.current) rowRef.current?.focus();
      },
      onPointerEnter: clearPending,
      onPointerLeave: closeForPointer,
    },
  };
}
