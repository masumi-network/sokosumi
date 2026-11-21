"use client";

import { type RefObject, useEffect, useRef } from "react";

export function useSeoWorklistFocus(
  root: RefObject<HTMLDivElement | null>,
  filterLine: RefObject<HTMLFieldSetElement | null>,
  list: RefObject<HTMLUListElement | null>,
  focusStrategy: boolean,
  setShownStrategy: (shown: boolean) => void,
) {
  // Read in each render, before its commit: a new check can take away the filter, the row or the whole filter
  // line that has the focus.
  const hadFocus = useRef(false);
  hadFocus.current = Boolean(root.current?.contains(document.activeElement));
  // A focus that left with its control goes to All, or to the first row when the filter line left too.
  useEffect(() => {
    if (focusStrategy) {
      const target = list.current?.querySelector<HTMLButtonElement>(
        "[data-strategy-row] button",
      );
      target?.scrollIntoView?.({ block: "nearest" });
      target?.focus({ preventScroll: true });
      setShownStrategy(false);
      return;
    }
    if (!hadFocus.current || document.activeElement !== document.body) return;
    hadFocus.current = false;
    (
      filterLine.current?.querySelector<HTMLButtonElement>("button") ??
      list.current?.querySelector<HTMLElement>("button, summary")
    )?.focus();
  });
}
