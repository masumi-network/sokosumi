"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Owns the expanded/collapsed state of `TaskFiles` and resets it before paint
 * when the route unmounts or is hidden under React `<Activity>`.
 */
export function useTaskFilesExpanded(): {
  expanded: boolean;
  toggle: () => void;
} {
  const [expanded, setExpanded] = useState(false);
  // Next retains inactive routes in Activity; reset when hidden, not on refresh.
  useLayoutEffect(() => {
    return () => setExpanded(false);
  }, []);

  return {
    expanded,
    toggle: () => setExpanded((value) => !value),
  };
}
