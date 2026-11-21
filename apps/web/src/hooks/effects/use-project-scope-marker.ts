"use client";

import { useEffect, useSyncExternalStore } from "react";

/** A detail page's project, keyed to the detail path that reported it. */
export interface MarkedProject {
  path: string;
  projectId: string | null;
}

let marked: MarkedProject | null = null;
const listeners = new Set<() => void>();

function publish(next: MarkedProject | null): void {
  marked = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MarkedProject | null {
  return marked;
}

function getServerSnapshot(): MarkedProject | null {
  return null;
}

/**
 * Publishes the detail page's project while mounted and clears it on unmount
 * unless a newer page's marker has already taken over.
 */
export function useProjectScopeMarker(
  path: string | null,
  projectId: string | null,
): void {
  useEffect(() => {
    if (!path) {
      return;
    }
    const entry: MarkedProject = { path, projectId };
    publish(entry);
    return () => {
      // A newer page's marker may already have taken over.
      if (marked === entry) {
        publish(null);
      }
    };
  }, [path, projectId]);
}

export function useMarkedProjectSnapshot(): MarkedProject | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
