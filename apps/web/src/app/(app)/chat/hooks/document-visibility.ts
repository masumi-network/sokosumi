"use client";

import { useSyncExternalStore } from "react";

export function subscribeVisibility(onStoreChange: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

export function getDocumentVisibilityState(): DocumentVisibilityState {
  return typeof document !== "undefined" ? document.visibilityState : "visible";
}

export function useDocumentVisibilityState(): DocumentVisibilityState {
  return useSyncExternalStore(
    subscribeVisibility,
    getDocumentVisibilityState,
    (): DocumentVisibilityState => "visible",
  );
}

export function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}
