const USER_UPLOADS_DIR = "users";

export function buildUserUploadPrefix(userId: string): string {
  return `${USER_UPLOADS_DIR}/${userId}/`;
}

export function sanitizeUserUploadFilename(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");

  return sanitized.length > 0 ? sanitized : "file";
}

export function buildUserUploadPathname(
  userId: string,
  fileName: string,
): string {
  return `${buildUserUploadPrefix(userId)}${sanitizeUserUploadFilename(
    fileName,
  )}`;
}
