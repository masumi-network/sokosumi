"use client";

import { useEffect, useSyncExternalStore } from "react";

const scopeListeners = new Set<() => void>();
let activeStorageKey: string | null = null;
let workspaceTransition: {
  pathname: string;
  projectId: string | null;
} | null = null;

function subscribeScope(listener: () => void) {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

function readRememberedScope(key: string | null): string | null {
  if (!key) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRememberedScope(key: string | null, projectId: string | null) {
  if (!key || readRememberedScope(key) === projectId) return;
  try {
    if (projectId) sessionStorage.setItem(key, projectId);
    else sessionStorage.removeItem(key);
  } catch {
    // Blocked storage must not prevent navigation or explicit selection.
    return;
  }
  for (const listener of scopeListeners) listener();
}

interface UseRememberedProjectScopeOptions {
  storageKey: string | null;
  hasRouteScope: boolean;
  pathname: string;
  routeProjectId: string | null;
}

/**
 * Subscribes to and synchronizes the active user/workspace's remembered
 * project scope in `sessionStorage`, holding off writes while a workspace
 * switch briefly retains the previous workspace's URL.
 */
export function useRememberedProjectScope({
  storageKey,
  hasRouteScope,
  pathname,
  routeProjectId,
}: UseRememberedProjectScopeOptions): {
  rememberedProjectId: string | null;
  rememberProjectId: (nextProjectId: string | null) => void;
} {
  const rememberedProjectId = useSyncExternalStore(
    subscribeScope,
    () => readRememberedScope(storageKey),
    () => null,
  );

  // Synchronize the browser preference only on pages that own a scope.
  // Chats and loading detail pages must not erase the last selection.
  useEffect(() => {
    if (!storageKey) return;
    // Workspace switching briefly retains the previous workspace's URL.
    // Ignore it, and the guard's cleanup, until a new project or page is chosen.
    if (activeStorageKey && activeStorageKey !== storageKey) {
      workspaceTransition = { pathname, projectId: routeProjectId };
    }
    activeStorageKey = storageKey;
    if (
      workspaceTransition &&
      (workspaceTransition.pathname !== pathname ||
        (routeProjectId !== null &&
          routeProjectId !== workspaceTransition.projectId))
    ) {
      workspaceTransition = null;
    }
    if (hasRouteScope && !workspaceTransition) {
      writeRememberedScope(storageKey, routeProjectId);
    }
  }, [hasRouteScope, pathname, routeProjectId, storageKey]);

  return {
    rememberedProjectId,
    rememberProjectId: (nextProjectId: string | null) => {
      writeRememberedScope(storageKey, nextProjectId);
    },
  };
}
