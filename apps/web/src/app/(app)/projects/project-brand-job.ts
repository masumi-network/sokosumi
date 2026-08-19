/**
 * Pending project DESIGN.md generation, kept in sessionStorage so the project
 * page can resume polling after the wizard closes. Client-only helpers.
 */

export interface PendingProjectBrandJob {
  jobId: string;
  jobToken: string;
  url: string;
}

function storageKey(projectId: string): string {
  return `sokosumi:project-brand-job:${projectId}`;
}

function autoStartAttemptedKey(projectId: string): string {
  return `sokosumi:project-brand-autostart:${projectId}`;
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

export function readPendingProjectBrandJob(
  projectId: string,
): PendingProjectBrandJob | null {
  let raw: string | null | undefined;
  try {
    raw = getStorage()?.getItem(storageKey(projectId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as PendingProjectBrandJob).jobId === "string" &&
      typeof (parsed as PendingProjectBrandJob).jobToken === "string" &&
      typeof (parsed as PendingProjectBrandJob).url === "string"
    ) {
      return parsed as PendingProjectBrandJob;
    }
  } catch {
    // fall through — corrupt entries are simply dropped
  }
  clearPendingProjectBrandJob(projectId);
  return null;
}

export function clearPendingProjectBrandJob(projectId: string): void {
  try {
    getStorage()?.removeItem(storageKey(projectId));
  } catch {
    // Nothing else to do when browser storage is unavailable.
  }
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
