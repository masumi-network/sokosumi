import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const TASK_FILES_DIR = "tasks";

/** Max file size in bytes (50 MB) for task file uploads (server-enforced). */
export const TASK_FILE_MAX_SIZE_BYTES = 50 * 1024 * 1024;

export function buildTaskFilePrefix(taskId: string): string {
  return `${TASK_FILES_DIR}/${taskId}/`;
}

export function sanitizeTaskFileFilename(fileName: string): string {
  return sanitizeUserUploadFilename(fileName);
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `tasks/{taskId}/report.pdf`
 */
export function buildTaskFilePathname(
  taskId: string,
  fileName: string,
): string {
  return `${buildTaskFilePrefix(taskId)}${sanitizeTaskFileFilename(fileName)}`;
}

/**
 * True when `url` points at a blob owned by this task's file prefix
 * (`tasks/{taskId}/…`). Used for best-effort rollback deletes.
 */
export function isOwnedTaskFileUrl(url: string, taskId: string): boolean {
  try {
    const { pathname } = new URL(url);
    // Vercel Blob public URLs embed the store pathname after the host.
    const decoded = decodeURIComponent(pathname.replace(/^\/+/, ""));
    const prefix = buildTaskFilePrefix(taskId);
    return decoded === prefix.slice(0, -1) || decoded.startsWith(prefix);
  } catch {
    return false;
  }
}
