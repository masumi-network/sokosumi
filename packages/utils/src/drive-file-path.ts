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

export function buildUserDriveFilePrefix(userId: string): string {
  return `${DRIVE_DIR}/${USERS_SUBDIR}/${userId}/`;
}

export function buildOrganizationDriveFilePrefix(
  organizationId: string,
): string {
  return `${DRIVE_DIR}/${ORGANIZATIONS_SUBDIR}/${organizationId}/`;
}

export function sanitizeDriveFileName(fileName: string): string {
  return sanitizeUserUploadFilename(fileName);
}

export function buildUserDriveFilePathname(
  userId: string,
  fileName: string,
): string {
  return `${buildUserDriveFilePrefix(userId)}${sanitizeDriveFileName(fileName)}`;
}

export function buildOrganizationDriveFilePathname(
  organizationId: string,
  fileName: string,
): string {
  return `${buildOrganizationDriveFilePrefix(organizationId)}${sanitizeDriveFileName(fileName)}`;
}

/** Server-enforced max stored display name length. */
export const DRIVE_FILE_MAX_NAME_LENGTH = 255;

export function clampDriveFileName(name: string): string {
  if (name.length <= DRIVE_FILE_MAX_NAME_LENGTH) {
    return name;
  }
  return name.slice(0, DRIVE_FILE_MAX_NAME_LENGTH);
}

export function sanitizeDriveFolderName(name: string): string {
  return sanitizeUserUploadFilename(name);
}

export function normalizeDriveFolderPath(path: string): string {
  return path
    .trim()
    .split("/")
    .filter((seg) => seg.length > 0)
    .join("/");
}

/** Rejects "." and ".." segments. Empty path (root) is valid. */
export function validateDriveFolderPath(normalizedPath: string): string | null {
  if (!normalizedPath) {
    return null;
  }

  const segments = normalizedPath.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return 'Folder path cannot contain "." or ".." segments';
    }
  }

  return null;
}

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

export function buildUserDriveFilePathnameWithFolder(
  userId: string,
  folderPath: string,
  fileName: string,
): string {
  const folderPrefix = buildUserDriveFolderPrefix(userId, folderPath);
  return `${folderPrefix}${sanitizeDriveFileName(fileName)}`;
}

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

export function buildUserDriveFolderMarkerPathname(
  userId: string,
  folderPath: string,
): string {
  const folderPrefix = buildUserDriveFolderPrefix(userId, folderPath);
  return `${folderPrefix}${DRIVE_FOLDER_MARKER_BASENAME}`;
}

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

export function isDriveFolderMarker(pathname: string): boolean {
  return pathname.endsWith(`/${DRIVE_FOLDER_MARKER_BASENAME}`);
}

export function isDriveFolderMarkerName(name: string): boolean {
  return name === DRIVE_FOLDER_MARKER_BASENAME;
}
