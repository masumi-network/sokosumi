"use client";

import { useSyncExternalStore } from "react";

/**
 * The reader's project visit log, newest first, stored per browser, user, and
 * workspace. The sidebar's Projects disclosure ranks by this so the list
 * stops reshuffling under the reader: Core sorts projects by latest activity,
 * which means a teammate's task can move your sidebar.
 *
 * Visits are derived and per-device on purpose — losing them on another
 * browser costs nothing, unlike a pin the reader placed by hand. They must
 * not leak across users or workspaces on a shared browser: the query is
 * already scoped; this log matches that key.
 *
 * The project detail route records a visit; everything else only reads.
 */
const RECENT_PROJECTS_STORAGE_PREFIX = "sokosumi.sidebar.recent-projects.v1";

/** Deep enough to outlive the row cap as projects come and go. */
const RECENT_PROJECTS_CAP = 20;

const NO_PROJECTS: readonly string[] = [];

const listeners = new Set<() => void>();
let cachedKey: string | null = null;
let cachedRaw: string | null = null;
let cachedIds: readonly string[] = NO_PROJECTS;

export interface RecentProjectsScope {
  userId: string;
  organizationId: string | null;
}

export function recentProjectsStorageKey(scope: RecentProjectsScope): string {
  return `${RECENT_PROJECTS_STORAGE_PREFIX}:${scope.userId}:${scope.organizationId ?? ""}`;
}

function isRecentProjectsStorageKey(key: string | null): boolean {
  return (
    key === null ||
    key === RECENT_PROJECTS_STORAGE_PREFIX ||
    key.startsWith(`${RECENT_PROJECTS_STORAGE_PREFIX}:`)
  );
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
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

/** Re-parses only when the stored string or scope key changes. */
function readSnapshot(key: string): readonly string[] {
  const raw = readRaw(key);
  if (key !== cachedKey || raw !== cachedRaw) {
    cachedKey = key;
    cachedRaw = raw;
    cachedIds = parseIds(raw);
  }
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
  if (isRecentProjectsStorageKey(event.key)) {
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

/** Distinct project ids for this user and workspace, most recently opened first. */
export function useRecentProjectIds(
  scope: RecentProjectsScope | null,
): readonly string[] {
  const key = scope ? recentProjectsStorageKey(scope) : null;
  return useSyncExternalStore(
    subscribe,
    () => (key === null ? NO_PROJECTS : readSnapshot(key)),
    getServerSnapshot,
  );
}

export function recordProjectVisit(
  projectId: string,
  scope: RecentProjectsScope,
): void {
  const key = recentProjectsStorageKey(scope);
  const next = appendProjectVisit(readSnapshot(key), projectId);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Incognito / blocked storage — ignore.
  }
  notifyListeners();
}
