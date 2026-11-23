"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Measures the coworker thought body container's `offsetHeight` before paint
 * whenever `expanded`, `bodyText`, or `working` changes.
 */
export function useCoworkerThoughtLineHeight(
  traceRef: RefObject<HTMLDivElement | null>,
  expanded: boolean,
  bodyText: string | null | undefined,
  working: boolean,
): number {
  const [lineHeight, setLineHeight] = useState(0);

  useLayoutEffect(() => {
    if (traceRef.current) {
      setLineHeight(traceRef.current.offsetHeight);
    }
  }, [expanded, bodyText, working]);

  return lineHeight;
}
