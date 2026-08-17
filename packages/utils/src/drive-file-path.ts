import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const DRIVE_DIR = "drive";
const USERS_SUBDIR = "users";
const ORGANIZATIONS_SUBDIR = "organizations";

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
 * Build Drive file directory for a specific user file.
 * Example: `drive/users/{userId}/{fileId}/`
 */
export function buildUserDriveFileDirectory(
  userId: string,
  fileId: string,
): string {
  return `${buildUserDriveFilePrefix(userId)}${fileId}/`;
}

/**
 * Build Drive file directory for a specific organization file.
 * Example: `drive/organizations/{orgId}/{fileId}/`
 */
export function buildOrganizationDriveFileDirectory(
  organizationId: string,
  fileId: string,
): string {
  return `${buildOrganizationDriveFilePrefix(organizationId)}${fileId}/`;
}

/**
 * Sanitize drive file name (reuse user upload sanitization).
 */
export function sanitizeDriveFileName(fileName: string): string {
  return sanitizeUserUploadFilename(fileName);
}

/**
 * Build user Drive file pathname.
 * Example: `drive/users/{userId}/{fileId}/report.pdf`
 */
export function buildUserDriveFilePathname(
  userId: string,
  fileId: string,
  fileName: string,
): string {
  return `${buildUserDriveFileDirectory(userId, fileId)}${sanitizeDriveFileName(fileName)}`;
}

/**
 * Build organization Drive file pathname.
 * Example: `drive/organizations/{orgId}/{fileId}/report.pdf`
 */
export function buildOrganizationDriveFilePathname(
  organizationId: string,
  fileId: string,
  fileName: string,
): string {
  return `${buildOrganizationDriveFileDirectory(organizationId, fileId)}${sanitizeDriveFileName(fileName)}`;
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
