"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useHeaderSlotHost } from "@/app/components/header/use-header-room-slot-host";

// The workspace selector and account controls share the fixed-height app header.
const WIDE_HEADER_QUERY = "(min-width: 80rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE_HEADER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isWideHeader() {
  return window.matchMedia(WIDE_HEADER_QUERY).matches;
}

export function PageHeaderSearch({ children }: { children: ReactNode }) {
  const host = useHeaderSlotHost("[data-app-header-search-slot]");
  const wide = useSyncExternalStore(subscribe, isWideHeader, () => false);
  return host && wide ? createPortal(children, host) : children;
}
