import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const DRIVE_DIR = "drive";
const USERS_SUBDIR = "users";
const ORGANIZATIONS_SUBDIR = "organizations";

/**
 * Reserved basename for Drive folder marker blobs.
 * A folder marker is a zero-byte blob that indicates an empty folder exists.
 * Never shown to users; hidden from list results.
 */
export const DRIVE_FOLDER_MARKER_BASENAME = "__drive_folder__";

/**
 * Build Drive file prefix for a user.
 * Example: `drive/users/{userId}/`
 */
export function buildUserDriveFilePrefix(userId: string): string {
  return `${DRIVE_DIR}/${USERS_SUBDIR}/${userId}/`;
}

/**
 * Build Drive file prefix for an organization.
 * Example: `drive/organizations/{orgId}/`
 */
export function buildOrganizationDriveFilePrefix(
  organizationId: string,
): string {
  return `${DRIVE_DIR}/${ORGANIZATIONS_SUBDIR}/${organizationId}/`;
}

/**
 * Sanitize drive file name (reuse user upload sanitization).
 */
export function sanitizeDriveFileName(fileName: string): string {
  return sanitizeUserUploadFilename(fileName);
}

/**
 * Build user Drive file pathname.
 * Example: `drive/users/{userId}/report.pdf`
 */
export function buildUserDriveFilePathname(
  userId: string,
  fileName: string,
): string {
  return `${buildUserDriveFilePrefix(userId)}${sanitizeDriveFileName(fileName)}`;
}

/**
 * Build organization Drive file pathname.
 * Example: `drive/organizations/{orgId}/report.pdf`
 */
export function buildOrganizationDriveFilePathname(
  organizationId: string,
  fileName: string,
): string {
  return `${buildOrganizationDriveFilePrefix(organizationId)}${sanitizeDriveFileName(fileName)}`;
}

/**
 * True when `url` points at a blob owned by this user's drive prefix
 * (`drive/users/{userId}/...`). Used for ACL checks and best-effort deletes.
 */
export function isOwnedUserDriveFileUrl(url: string, userId: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\//, "");
    return pathname.startsWith(buildUserDriveFilePrefix(userId));
  } catch {
    return false;
  }
}

/**
 * True when `url` points at a blob owned by this organization's drive prefix
 * (`drive/organizations/{orgId}/...`). Used for ACL checks and best-effort deletes.
 */
export function isOwnedOrganizationDriveFileUrl(
  url: string,
  organizationId: string,
): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\//, "");
    return pathname.startsWith(
      buildOrganizationDriveFilePrefix(organizationId),
    );
  } catch {
    return false;
  }
}

/**
 * Max stored display name length for drive files (server-enforced).
 */
export const DRIVE_FILE_MAX_NAME_LENGTH = 255;

/**
 * Clamp drive file display name to max length.
 */
export function clampDriveFileName(name: string): string {
  if (name.length <= DRIVE_FILE_MAX_NAME_LENGTH) {
    return name;
  }
  return name.slice(0, DRIVE_FILE_MAX_NAME_LENGTH);
}

/**
 * Sanitize a folder name segment (no slashes, no leading/trailing dots).
 */
export function sanitizeDriveFolderName(name: string): string {
  return sanitizeUserUploadFilename(name);
}

/**
 * Normalize a folder path (trim, remove leading/trailing slashes, collapse multiple slashes).
 * Example: "//folder1//folder2//" → "folder1/folder2"
 */
export function normalizeDriveFolderPath(path: string): string {
  return path
    .trim()
    .split("/")
    .filter((seg) => seg.length > 0)
    .join("/");
}

/**
 * Build user Drive folder prefix (with trailing slash).
 * Example: `drive/users/{userId}/folder1/folder2/`
 */
export function buildUserDriveFolderPrefix(
  userId: string,
  folderPath: string,
): string {
  const normalized = normalizeDriveFolderPath(folderPath);
  if (!normalized) {
    return buildUserDriveFilePrefix(userId);
  }
  return `${buildUserDriveFilePrefix(userId)}${normalized}/`;
}

/**
 * Build organization Drive folder prefix (with trailing slash).
 * Example: `drive/organizations/{orgId}/folder1/folder2/`
 */
export function buildOrganizationDriveFolderPrefix(
  organizationId: string,
  folderPath: string,
): string {
  const normalized = normalizeDriveFolderPath(folderPath);
  if (!normalized) {
    return buildOrganizationDriveFilePrefix(organizationId);
  }
  return `${buildOrganizationDriveFilePrefix(organizationId)}${normalized}/`;
}

/**
 * Build user Drive file pathname with optional folder path.
 * Example: `drive/users/{userId}/folder1/report.pdf`
 */
export function buildUserDriveFilePathnameWithFolder(
  userId: string,
  folderPath: string,
  fileName: string,
): string {
  const folderPrefix = buildUserDriveFolderPrefix(userId, folderPath);
  return `${folderPrefix}${sanitizeDriveFileName(fileName)}`;
}

/**
 * Build organization Drive file pathname with optional folder path.
 * Example: `drive/organizations/{orgId}/folder1/report.pdf`
 */
export function buildOrganizationDriveFilePathnameWithFolder(
  organizationId: string,
  folderPath: string,
  fileName: string,
): string {
  const folderPrefix = buildOrganizationDriveFolderPrefix(
    organizationId,
    folderPath,
  );
  return `${folderPrefix}${sanitizeDriveFileName(fileName)}`;
}

/**
 * Build folder marker pathname for a user folder.
 * Example: `drive/users/{userId}/folder1/__drive_folder__`
 */
export function buildUserDriveFolderMarkerPathname(
  userId: string,
  folderPath: string,
): string {
  const folderPrefix = buildUserDriveFolderPrefix(userId, folderPath);
  return `${folderPrefix}${DRIVE_FOLDER_MARKER_BASENAME}`;
}

/**
 * Build folder marker pathname for an organization folder.
 * Example: `drive/organizations/{orgId}/folder1/__drive_folder__`
 */
export function buildOrganizationDriveFolderMarkerPathname(
  organizationId: string,
  folderPath: string,
): string {
  const folderPrefix = buildOrganizationDriveFolderPrefix(
    organizationId,
    folderPath,
  );
  return `${folderPrefix}${DRIVE_FOLDER_MARKER_BASENAME}`;
}

/**
 * Check if a pathname is a Drive folder marker.
 */
export function isDriveFolderMarker(pathname: string): boolean {
  return pathname.endsWith(`/${DRIVE_FOLDER_MARKER_BASENAME}`);
}

/**
 * Check if a filename conflicts with the reserved folder marker basename.
 */
export function isDriveFolderMarkerName(name: string): boolean {
  return name === DRIVE_FOLDER_MARKER_BASENAME;
}
