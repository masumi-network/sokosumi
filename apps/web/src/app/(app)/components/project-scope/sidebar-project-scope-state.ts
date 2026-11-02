"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";

/**
 * Shared by the header chip, which owns the sheet and the Create dialog, and
 * the sidebar row. The row can unmount under an open dialog: the sidebar is a
 * sheet on mobile, and the whole sidebar remounts when the width crosses md.
 * The header chip is always mounted, so the dialog lives there.
 *
 * It is also how any page asks for a project: a page or action that needs one
 * opens this same selector (the header's menu from md, the sheet below it)
 * through `openProjectScope`, rather than drawing a project list of its own.
 */

/** Why the selector opened, when a page or an action asked for it. */
export interface ProjectScopeRequest {
  /**
   * The page or action cannot go on without a project: the selector opens as
   * a modal over a dimmed page that takes no clicks, and an outside click
   * does not close it. Esc (and the sheet's ×) still do, back to the page,
   * which keeps showing why it needs a project and the button that asks again.
   */
  required?: boolean;
  /** One line above the list saying what the project is for. */
  reason?: string;
  /** Replaces the default choice, which switches the page's scope. */
  onSelect?: (projectId: string) => void;
  /** Runs when the reader closes the selector without choosing. */
  onDismiss?: () => void;
}

const state: {
  sheetOpen: boolean;
  menuOpen: boolean;
  createOpen: boolean;
  request: ProjectScopeRequest | null;
} = { sheetOpen: false, menuOpen: false, createOpen: false, request: null };
const listeners = new Set<() => void>();

function update(next: Partial<typeof state>) {
  Object.assign(state, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Closes the selector. A request still waiting is dismissed. */
function dismissProjectScope() {
  const request = state.request;
  update({ sheetOpen: false, menuOpen: false, request: null });
  request?.onDismiss?.();
}

/** The sheet's own trigger and close. Opening by hand carries no request. */
export function setScopeSheetOpen(sheetOpen: boolean) {
  if (sheetOpen) update({ sheetOpen, request: null });
  else dismissProjectScope();
}

/** The header menu's own trigger and close. */
export function setScopeMenuOpen(menuOpen: boolean) {
  if (menuOpen) update({ menuOpen, request: null });
  else dismissProjectScope();
}

export function openScopeSheet() {
  setScopeSheetOpen(true);
}

/**
 * Opens the main project selector from anywhere: the header's menu from md,
 * the bottom sheet below it. Returns a cancel for the opener's unmount, which
 * closes the selector only while it is still this request's.
 */
export function openProjectScope(request: ProjectScopeRequest = {}) {
  const desktop = window.innerWidth >= MOBILE_BREAKPOINT;
  update({ menuOpen: desktop, sheetOpen: !desktop, request });
  return () => {
    if (state.request !== request) return;
    update({ sheetOpen: false, menuOpen: false, request: null });
  };
}

/** A choice in the selector: the request's own, or the scope switch. */
export function selectProjectScope(
  projectId: string,
  switchScope: (projectId: string) => void,
) {
  const request = state.request;
  update({ request: null });
  (request?.onSelect ?? switchScope)(projectId);
}

/** The switcher that opened Create project, to take focus back on cancel. */
let createOpener: HTMLElement | null = null;
/** The request Create project took over from the selector, if any. */
let createRequest: ProjectScopeRequest | null = null;

/** Opens the chip's Create project dialog from the selector. */
export function openScopeCreate(opener: HTMLElement | null = null) {
  createOpener = opener;
  createRequest = state.request;
  update({ createOpen: true, request: null });
}

/** Create project closed. Without a project made, its request is dismissed. */
export function setScopeCreateOpen(createOpen: boolean) {
  if (createOpen) {
    update({ createOpen });
    return;
  }
  const request = createRequest;
  createRequest = null;
  update({ createOpen });
  request?.onDismiss?.();
}

/** The new project answers the request Create took over, or switches scope. */
export function selectCreatedProject(
  projectId: string,
  switchScope: (projectId: string) => void,
) {
  const request = createRequest;
  createRequest = null;
  (request?.onSelect ?? switchScope)(projectId);
}

export function useScopeSheetOpen() {
  return useSyncExternalStore(
    subscribe,
    () => state.sheetOpen,
    () => false,
  );
}

export function useScopeMenuOpen() {
  return useSyncExternalStore(
    subscribe,
    () => state.menuOpen,
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

/** The request the open selector is answering, or null. */
export function useScopeRequest() {
  return useSyncExternalStore(
    subscribe,
    () => state.request,
    () => null,
  );
}

export function getScopeCreateOpener() {
  return createOpener;
}

export function resetScopeDialogs() {
  createOpener = null;
  createRequest = null;
  update({
    sheetOpen: false,
    menuOpen: false,
    createOpen: false,
    request: null,
  });
}
