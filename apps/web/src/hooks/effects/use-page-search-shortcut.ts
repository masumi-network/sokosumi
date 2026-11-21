"use client";

import { type RefObject, useEffect } from "react";
import { OPEN_SURFACE_SELECTOR } from "@/lib/utils/is-editable-keyboard-target";

function isAvailable(field: HTMLInputElement): boolean {
  return (
    !field.disabled &&
    !field.closest('[hidden], [inert], [aria-hidden="true"]') &&
    (field.checkVisibility?.({ visibilityProperty: true }) ?? true)
  );
}

/** Resolve the live field on each press: some routes retain hidden tabs or mobile toolbars. */
function activeSearchField(): HTMLInputElement | undefined {
  const fields = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      "input[data-page-search-input]",
    ),
  ).filter(isAvailable);
  const active = document.activeElement;
  return (
    fields.find((field) => field === active) ??
    fields.find((field) => field.closest("section")?.contains(active)) ??
    fields[0]
  );
}

export function usePageSearchShortcut(
  ref: RefObject<HTMLInputElement | null>,
  { focusOnMount = false }: { focusOnMount?: boolean } = {},
) {
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.dataset.pageSearchInput = "";
    const active = document.activeElement;
    if (
      focusOnMount &&
      isAvailable(input) &&
      (!active ||
        active === document.body ||
        active.matches("main, h1, [data-route-announcer]") ||
        (active.matches("a, button") &&
          active.closest("nav, [data-sidebar]") &&
          !active.closest(OPEN_SURFACE_SELECTOR)))
    ) {
      input.focus({ preventScroll: true });
    }
    function handleKey(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.key?.toLowerCase() !== "f" ||
        event.metaKey === event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        document.activeElement?.closest(OPEN_SURFACE_SELECTOR) ||
        activeSearchField() !== input
      )
        return;
      event.preventDefault();
      input?.focus();
      input?.select();
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      delete input.dataset.pageSearchInput;
      window.removeEventListener("keydown", handleKey);
    };
  }, [ref, focusOnMount]);
}
