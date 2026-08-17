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
  getStorage()?.setItem(storageKey(projectId), JSON.stringify(job));
}

export function readPendingProjectBrandJob(
  projectId: string,
): PendingProjectBrandJob | null {
  const raw = getStorage()?.getItem(storageKey(projectId));
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
  getStorage()?.removeItem(storageKey(projectId));
}
