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

/** A stored JSON value that passes `isValid`; anything else is dropped. */
function readStored<T>(key: string, isValid: (value: Partial<T>) => boolean) {
  let raw: string | null | undefined;
  try {
    raw = getStorage()?.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && isValid(parsed)) {
      return parsed as T;
    }
  } catch {
    // fall through — corrupt entries are simply dropped
  }
  removeStored(key);
  return null;
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

export function readFailedProjectBrandGeneration(
  projectId: string,
  viewerId: string,
): FailedProjectBrandGeneration | null {
  return readStored<FailedProjectBrandGeneration>(
    failureKey(projectId, viewerId),
    (failure) =>
      typeof failure.website === "string" &&
      typeof failure.failedAt === "string" &&
      !Number.isNaN(Date.parse(failure.failedAt)),
  );
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

/**
 * The project's brand generation callbacks for `useDesignMdGeneration`, shared
 * by the wizard and the project pages so either one hands the other its
 * pending job and its latest failure. Without a viewer (session still
 * loading) failures are not kept. `onFailureChange` hears the new failure,
 * or `null` when an attempt starts.
 */
export function projectBrandJobCallbacks(
  projectId: string,
  viewerId: string | undefined,
  onFailureChange?: (failure: FailedProjectBrandGeneration | null) => void,
) {
  return {
    onFailed: ({ url }: { url: string }) => {
      const website = projectBrandWebsite(url);
      if (!viewerId || !website) return;
      const failure = { failedAt: new Date().toISOString(), website };
      saveFailedProjectBrandGeneration(projectId, viewerId, failure);
      onFailureChange?.(failure);
    },
    onJobStarted: (job: PendingProjectBrandJob) =>
      savePendingProjectBrandJob(projectId, job),
    onSettled: () => clearPendingProjectBrandJob(projectId),
    onStarted: () => {
      if (viewerId) clearFailedProjectBrandGeneration(projectId, viewerId);
      onFailureChange?.(null);
    },
  };
}
