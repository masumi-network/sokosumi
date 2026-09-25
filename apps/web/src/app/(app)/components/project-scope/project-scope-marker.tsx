"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { detailPageOf } from "./project-scope-href";

/** A detail page's project, keyed to the detail path that reported it. */
interface Marked {
  path: string;
  projectId: string | null;
}

let marked: Marked | null = null;
const listeners = new Set<() => void>();

function publish(next: Marked | null) {
  marked = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): Marked | null {
  return marked;
}

function serverSnapshot(): Marked | null {
  return null;
}

/**
 * SOK-1202 harness: a task or schedule detail page reports its item's
 * project, which its URL does not carry. Renders nothing.
 */
export function ProjectScopeMarker({
  projectId,
}: {
  projectId: string | null;
}) {
  const path = detailPageOf(usePathname())?.path ?? null;

  useEffect(() => {
    if (!path) return;
    const entry = { path, projectId };
    publish(entry);
    return () => {
      // A newer page's marker may already have taken over.
      if (marked === entry) publish(null);
    };
  }, [path, projectId]);

  return null;
}

/**
 * The project a detail page marked, for the detail page at `pathname` only.
 * Null anywhere else, or when that page's item has no project.
 */
export function useMarkedProjectId(pathname: string): string | null {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const path = detailPageOf(pathname)?.path;
  return current && current.path === path ? current.projectId : null;
}
