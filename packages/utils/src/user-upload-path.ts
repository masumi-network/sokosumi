const USER_UPLOADS_DIR = "users";

function trimLeadingTrailingDotsAndUnderscores(value: string): string {
  let start = 0;
  const len = value.length;
  while (start < len && (value[start] === "." || value[start] === "_")) {
    start++;
  }
  let end = len;
  while (end > start && (value[end - 1] === "." || value[end - 1] === "_")) {
    end--;
  }
  return value.slice(start, end);
}

export function buildUserUploadPrefix(userId: string): string {
  return `${USER_UPLOADS_DIR}/${userId}/`;
}

export function sanitizeUserUploadFilename(fileName: string): string {
  const sanitized = trimLeadingTrailingDotsAndUnderscores(
    fileName
      .trim()
      .replace(/[\\/]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .replace(/_+/g, "_"),
  );

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

/** True when the URL path contains this user's upload prefix (`users/{userId}/`). */
export function isOwnedUserUploadUrl(url: string, userId: string): boolean {
  if (!userId) return false;

  const marker = buildUserUploadPrefix(userId);
  try {
    return new URL(url).pathname.includes(marker);
  } catch {
    return false;
  }
}
