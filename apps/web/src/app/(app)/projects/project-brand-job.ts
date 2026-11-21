/**
 * Pending project DESIGN.md generation, kept in sessionStorage so the project
 * page can resume polling after the wizard closes. The latest failed
 * generation is kept the same way, so the Brand card still says why after a
 * reload. Client-only helpers.
 */

import { normalizeWebsiteUrl } from "@sokosumi/utils";

export interface PendingProjectBrandJob {
  jobId: string;
  jobToken: string;
  url: string;
}

/** The website the latest generation failed on, and when. */
export interface FailedProjectBrandGeneration {
  failedAt: string;
  /** Origin and path only, from `projectBrandWebsite`. */
  website: string;
}

function storageKey(projectId: string): string {
  return `sokosumi:project-brand-job:${projectId}`;
}

function autoStartAttemptedKey(projectId: string): string {
  return `sokosumi:project-brand-autostart:${projectId}`;
}

// Per viewer: another account signed in to this tab later must not see it.
function failureKey(projectId: string, viewerId: string): string {
  return `sokosumi:project-brand-failure:${viewerId}:${projectId}`;
}

/**
 * The part of a website that names a generation attempt: origin and path,
 * without sign-in details, query or fragment. `null` when not a website.
 */
export function projectBrandWebsite(url: string): string | null {
  const normalized = normalizeWebsiteUrl(url);
  if (!normalized) return null;
  const { origin, pathname } = new URL(normalized);
  return `${origin}${pathname}`;
}

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingProjectBrandJob(
  projectId: string,
  job: PendingProjectBrandJob,
): void {
  try {
    getStorage()?.setItem(storageKey(projectId), JSON.stringify(job));
  } catch {
    // Background generation still works when browser storage is unavailable.
  }
}

function readRaw(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** A JSON value that passes `isValid`, or `null`. */
function parseStored<T>(
  raw: string | null,
  isValid: (value: Partial<T>) => boolean,
): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && isValid(parsed)) {
      return parsed as T;
    }
  } catch {
    // corrupt
  }
  return null;
}

/** A stored JSON value that passes `isValid`; anything else is dropped. */
function readStored<T>(key: string, isValid: (value: Partial<T>) => boolean) {
  const raw = readRaw(key);
  const value = parseStored(raw, isValid);
  if (raw && !value) removeStored(key);
  return value;
}

function removeStored(key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // Nothing else to do when browser storage is unavailable.
  }
}

export function readPendingProjectBrandJob(
  projectId: string,
): PendingProjectBrandJob | null {
  return readStored<PendingProjectBrandJob>(
    storageKey(projectId),
    (job) =>
      typeof job.jobId === "string" &&
      typeof job.jobToken === "string" &&
      typeof job.url === "string",
  );
}

export function clearPendingProjectBrandJob(projectId: string): void {
  removeStored(storageKey(projectId));
}

export function saveFailedProjectBrandGeneration(
  projectId: string,
  viewerId: string,
  failure: FailedProjectBrandGeneration,
): void {
  try {
    getStorage()?.setItem(
      failureKey(projectId, viewerId),
      JSON.stringify(failure),
    );
  } catch {
    // The card still shows the failure until the page reloads.
  }
}

function isFailedGeneration(failure: Partial<FailedProjectBrandGeneration>) {
  return (
    typeof failure.website === "string" &&
    typeof failure.failedAt === "string" &&
    !Number.isNaN(Date.parse(failure.failedAt))
  );
}

export function readFailedProjectBrandGeneration(
  projectId: string,
  viewerId: string,
): FailedProjectBrandGeneration | null {
  return readStored(failureKey(projectId, viewerId), isFailedGeneration);
}

/** The viewer's stored failure as written: a `useSyncExternalStore`
 * snapshot, read with `parseFailedProjectBrandGeneration`. */
export function readFailedProjectBrandGenerationJson(
  projectId: string,
  viewerId: string,
): string | null {
  return readRaw(failureKey(projectId, viewerId));
}

export function parseFailedProjectBrandGeneration(
  json: string | null,
): FailedProjectBrandGeneration | null {
  return parseStored(json, isFailedGeneration);
}

export function clearFailedProjectBrandGeneration(
  projectId: string,
  viewerId: string,
): void {
  removeStored(failureKey(projectId, viewerId));
}

export function hasProjectBrandAutoStartAttempted(projectId: string): boolean {
  try {
    return getStorage()?.getItem(autoStartAttemptedKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function markProjectBrandAutoStartAttempted(projectId: string): void {
  try {
    getStorage()?.setItem(autoStartAttemptedKey(projectId), "1");
  } catch {
    // The in-flight guard still prevents duplicate starts in this mount.
  }
}

function attemptKey(projectId: string): string {
  return `sokosumi:project-brand-attempt:${projectId}`;
}

function readAttempt(projectId: string): string | null {
  try {
    return getStorage()?.getItem(attemptKey(projectId)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether some surface in this tab has a generation running for the project,
 * maybe a start still waiting for its job. ponytail: a tab reloaded mid-start
 * leaves it set, so auto-start stays off there; Generate still works.
 */
export function hasProjectBrandAttemptInFlight(projectId: string): boolean {
  return readAttempt(projectId) !== null;
}

const CHANGE_EVENT = "sokosumi:project-brand-change";

/** Hears this tab's writes for the project, such as a closed wizard's job. */
export function onProjectBrandStorageChange(
  projectId: string,
  listener: () => void,
): () => void {
  const handle = (event: Event) => {
    if ((event as CustomEvent<string>).detail === projectId) listener();
  };
  window.addEventListener(CHANGE_EVENT, handle);
  return () => window.removeEventListener(CHANGE_EVENT, handle);
}

let storageVersion = 0;

/** Counts this tab's announced writes: a `useSyncExternalStore` snapshot
 * for `onProjectBrandStorageChange`. */
export function getProjectBrandStorageVersion(): number {
  return storageVersion;
}

function notifyChange(projectId: string): void {
  storageVersion += 1;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: projectId }));
}

/**
 * The project's brand generation callbacks for `useDesignMdGeneration`, shared
 * by the wizard and the project pages so either one hands the other its
 * pending job and its latest failure. The latest attempt to start owns them:
 * an older one (a closed wizard, a provider that left) answering late
 * writes nothing. Without a viewer (session still loading) failures are not
 * kept, so callers start only once the viewer is known. `onFailureChange`
 * hears the new failure, or `null` when an attempt starts; a caller that has
 * left ignores it.
 */
export function projectBrandJobCallbacks(
  projectId: string,
  viewerId: string | undefined,
  onFailureChange?: (failure: FailedProjectBrandGeneration | null) => void,
) {
  const owns = (attemptId: string) => readAttempt(projectId) === attemptId;
  return {
    onFailed: ({ attemptId, url }: { attemptId: string; url: string }) => {
      const website = projectBrandWebsite(url);
      if (!website) return;
      const failure = { failedAt: new Date().toISOString(), website };
      // The hook reports only its own latest attempt, so the caller always
      // hears it, even when storage is unavailable.
      onFailureChange?.(failure);
      if (owns(attemptId) && viewerId) {
        saveFailedProjectBrandGeneration(projectId, viewerId, failure);
      }
    },
    onJobStarted: ({
      attemptId,
      ...job
    }: PendingProjectBrandJob & { attemptId: string }) => {
      if (!owns(attemptId)) return;
      savePendingProjectBrandJob(projectId, job);
      notifyChange(projectId);
    },
    onSettled: ({ attemptId }: { attemptId: string }) => {
      if (!owns(attemptId)) return;
      clearPendingProjectBrandJob(projectId);
      removeStored(attemptKey(projectId));
      notifyChange(projectId);
    },
    onStarted: ({ attemptId }: { attemptId: string }) => {
      try {
        getStorage()?.setItem(attemptKey(projectId), attemptId);
      } catch {
        // Without storage each surface only knows its own attempt.
      }
      if (viewerId) clearFailedProjectBrandGeneration(projectId, viewerId);
      onFailureChange?.(null);
      notifyChange(projectId);
    },
  };
}
