/**
 * Pending project DESIGN.md generation, kept in sessionStorage so the project
 * page can resume polling after the wizard closes. The latest failed
 * generation is kept the same way, so the Brand card still says why after a
 * reload. Client-only helpers.
 */

export interface PendingProjectBrandJob {
  jobId: string;
  jobToken: string;
  url: string;
}

/** The website the latest generation failed on, and when. */
export interface FailedProjectBrandGeneration {
  failedAt: string;
  url: string;
}

function storageKey(projectId: string): string {
  return `sokosumi:project-brand-job:${projectId}`;
}

function autoStartAttemptedKey(projectId: string): string {
  return `sokosumi:project-brand-autostart:${projectId}`;
}

function failureKey(projectId: string): string {
  return `sokosumi:project-brand-failure:${projectId}`;
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
  failure: FailedProjectBrandGeneration,
): void {
  try {
    getStorage()?.setItem(failureKey(projectId), JSON.stringify(failure));
  } catch {
    // The card still shows the failure until the page reloads.
  }
}

export function readFailedProjectBrandGeneration(
  projectId: string,
): FailedProjectBrandGeneration | null {
  return readStored<FailedProjectBrandGeneration>(
    failureKey(projectId),
    (failure) =>
      typeof failure.url === "string" &&
      typeof failure.failedAt === "string" &&
      !Number.isNaN(Date.parse(failure.failedAt)),
  );
}

export function clearFailedProjectBrandGeneration(projectId: string): void {
  removeStored(failureKey(projectId));
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
