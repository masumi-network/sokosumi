"use client";

import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";

import {
  parseScopeVariant,
  SCOPE_VARIANT_PARAM,
  SCOPE_VARIANT_STORAGE_KEY,
  type ScopeVariantId,
} from "./scope-variants";

const CHANGE_EVENT = "sok-1202-scope-variant-change";

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(SCOPE_VARIANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Remembers a variant for the tab, so it survives navigation: app links do
 * not carry `?variant=`.
 */
export function storeScopeVariant(variant: ScopeVariantId) {
  try {
    window.sessionStorage.setItem(SCOPE_VARIANT_STORAGE_KEY, variant);
  } catch {
    // Private mode: the URL param still works for the page in hand.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function useChosenScopeVariant(): ScopeVariantId | null {
  const searchParams = useSearchParams();
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  return (
    parseScopeVariant(searchParams?.get(SCOPE_VARIANT_PARAM)) ??
    parseScopeVariant(stored)
  );
}

/** The active variant: the URL param first, then the tab's stored choice. */
export function useScopeVariant(): ScopeVariantId {
  return useChosenScopeVariant() ?? "current";
}

/**
 * True once a `?variant=` link opened in this tab. Until then the harness
 * stays out of sight, so the preview reads as main.
 */
export function useScopeVariantOptedIn(): boolean {
  return useChosenScopeVariant() !== null;
}

/** True when a new variant replaces today's project navigation. */
export function useReplacesOldProjectNavigation(): boolean {
  return useScopeVariant() !== "current";
}
