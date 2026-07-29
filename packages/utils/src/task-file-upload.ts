import { resolveUserUploadContentType } from "./user-upload-content-type.js";
import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const TASK_FILES_DIR = "tasks";

/** Max file size in bytes (50 MB) for task file uploads (server-enforced). */
export const TASK_FILE_MAX_SIZE_BYTES = 50 * 1024 * 1024;

/** Max stored display name length for task file uploads (server-enforced). */
export const TASK_FILE_MAX_NAME_LENGTH = 255;

/**
 * Content types allowed for user uploads but blocked for task files.
 * SVG is excluded because task files are public blobs linked from anonymous
 * share pages; opening a scriptable SVG in a new tab is a click-XSS risk.
 */
const TASK_FILE_DISALLOWED_CONTENT_TYPES = new Set(["image/svg+xml"]);

/** Extensions that map to disallowed task-file content types (defense in depth). */
const TASK_FILE_DISALLOWED_EXTENSIONS = new Set(["svg"]);

export function buildTaskFilePrefix(taskId: string): string {
  return `${TASK_FILES_DIR}/${taskId}/`;
}

export function sanitizeTaskFileFilename(fileName: string): string {
  return sanitizeUserUploadFilename(fileName);
}

function hasDisallowedTaskFileExtension(filename: string): boolean {
  const base = filename.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return false;
  }
  return TASK_FILE_DISALLOWED_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/**
 * Resolve task-file MIME like user uploads, then reject types unsafe on public
 * share surfaces (currently SVG). Rejects by resolved MIME and by `.svg`
 * extension so a spoofed allowlisted Content-Type cannot bypass the block.
 */
export function resolveTaskFileContentType(
  filename: string,
  declaredContentType: string,
): string | null {
  if (hasDisallowedTaskFileExtension(filename)) {
    return null;
  }
  const resolved = resolveUserUploadContentType(filename, declaredContentType);
  if (resolved == null) {
    return null;
  }
  if (TASK_FILE_DISALLOWED_CONTENT_TYPES.has(resolved)) {
    return null;
  }
  return resolved;
}

/**
 * Normalize a client-provided file name for DB storage: trim, fall back to
 * `"file"`, and clamp to {@link TASK_FILE_MAX_NAME_LENGTH}.
 */
export function clampTaskFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const base = trimmed.length > 0 ? trimmed : "file";
  if (base.length <= TASK_FILE_MAX_NAME_LENGTH) {
    return base;
  }
  return base.slice(0, TASK_FILE_MAX_NAME_LENGTH);
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
