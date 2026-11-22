"use client";

import { type RefObject, useEffect } from "react";

/**
 * Restores keyboard focus to the moved sub-task's drag handle after
 * `TaskSubtaskList` commits a new row order, and clears `movedId`.
 */
export function useTaskSubtaskMoveFocus(
  handles: RefObject<Map<string, HTMLButtonElement>>,
  movedId: RefObject<string | null>,
  order: string,
): void {
  // Runs when the order changes.
  useEffect(() => {
    // React moves the row's node, which can drop focus on the way.
    if (movedId.current) handles.current.get(movedId.current)?.focus();
    movedId.current = null;
  }, [order]);
}
