"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared by the header chip, which owns the sheet and the Create dialog, and
 * the sidebar row. The row can unmount under an open dialog: the sidebar is a
 * sheet on mobile, and the whole sidebar remounts when the width crosses md.
 * The header chip is always mounted, so the dialog lives there.
 */
const state = { sheetOpen: false, createOpen: false };
const listeners = new Set<() => void>();

function update(next: Partial<typeof state>) {
  Object.assign(state, next);
  for (const listener of listeners) listener();
}

export function setScopeSheetOpen(sheetOpen: boolean) {
  update({ sheetOpen });
}

export function setScopeCreateOpen(createOpen: boolean) {
  update({ createOpen });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openScopeSheet() {
  setScopeSheetOpen(true);
}

/** The switcher that opened Create project, to take focus back on cancel. */
let createOpener: HTMLElement | null = null;

/** Opens the chip's Create project dialog from anywhere. */
export function openScopeCreate(opener: HTMLElement | null = null) {
  createOpener = opener;
  setScopeCreateOpen(true);
}

export function useScopeSheetOpen() {
  return useSyncExternalStore(
    subscribe,
    () => state.sheetOpen,
    () => false,
  );
}

export function useScopeCreateOpen() {
  return useSyncExternalStore(
    subscribe,
    () => state.createOpen,
    () => false,
  );
}

export function getScopeCreateOpener() {
  return createOpener;
}

export function resetScopeDialogs() {
  createOpener = null;
  update({ sheetOpen: false, createOpen: false });
}
