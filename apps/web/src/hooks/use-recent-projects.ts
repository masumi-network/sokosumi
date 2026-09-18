"use client";

import { useSyncExternalStore } from "react";

/**
 * The reader's project visit log, newest first, stored per browser.
 *
 * The sidebar's Projects disclosure ranks by this so the list stops
 * reshuffling under the reader: Core sorts projects by latest activity, which
 * means a teammate's task can move your sidebar. Visits are derived and
 * per-device on purpose — losing them on another browser costs nothing, unlike
 * a pin the reader placed by hand.
 *
 * The project detail route records a visit; everything else only reads.
 */
const RECENT_PROJECTS_STORAGE_KEY = "sokosumi.sidebar.recent-projects.v1";

/** Deep enough to outlive the row cap as projects come and go. */
const RECENT_PROJECTS_CAP = 20;

const NO_PROJECTS: readonly string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedIds: readonly string[] = NO_PROJECTS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseIds(raw: string | null): readonly string[] {
  if (!raw) return NO_PROJECTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_PROJECTS;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return NO_PROJECTS;
  }
}

/** Re-parses only when the stored string changes, so the snapshot stays referentially stable. */
function syncCache(): void {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIds = parseIds(raw);
  }
}

function getSnapshot(): readonly string[] {
  syncCache();
  return cachedIds;
}

function getServerSnapshot(): readonly string[] {
  return NO_PROJECTS;
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleStorage(event: StorageEvent): void {
  if (event.key === null || event.key === RECENT_PROJECTS_STORAGE_KEY) {
    notifyListeners();
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

/** Newest visit first, each project once. Pure — no storage. */
export function appendProjectVisit(
  log: readonly string[],
  projectId: string,
  cap: number = RECENT_PROJECTS_CAP,
): string[] {
  return [projectId, ...log.filter((id) => id !== projectId)].slice(0, cap);
}

/** Distinct project ids, most recently opened first. */
export function useRecentProjectIds(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function recordProjectVisit(projectId: string): void {
  syncCache();
  const next = appendProjectVisit(cachedIds, projectId);
  try {
    localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Incognito / blocked storage — ignore.
  }
  notifyListeners();
}
