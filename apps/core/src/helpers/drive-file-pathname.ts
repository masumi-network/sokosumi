import { buildUserDriveFilePrefix } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";

export interface ParsedDriveFilePathname {
  scope: "user" | "organization";
  ownerId: string;
}

/**
 * Parse a drive file pathname to extract scope and owner ID.
 * @param pathname - Blob pathname (e.g. "drive/users/{userId}/{filename}" or "drive/organizations/{orgId}/{filename}")
 * @param userId - Current user ID (for detecting user scope)
 * @returns Parsed scope and owner ID
 * @throws unprocessableEntity if pathname format is invalid
 */
export function parseDriveFilePathname(
  pathname: string,
  userId: string,
): ParsedDriveFilePathname {
  // Blob reads rebuild the pathname as a URL, which drops tabs and newlines,
  // reads "\" as "/" and resolves "." and ".." (also as %2e). Any of those
  // would let the path pass the checks below as the caller's own and still
  // read another owner's file.
  const segments = pathname.replace(/[\t\n\r]/g, "").split(/[/\\]/);
  if (segments.some((s) => s === "" || /^(\.|%2e){1,2}$/i.test(s))) {
    throw unprocessableEntity("Invalid pathname format");
  }

  const userPrefix = buildUserDriveFilePrefix(userId);
  const isUserFile = pathname.startsWith(userPrefix);

  if (isUserFile) {
    return {
      scope: "user",
      ownerId: userId,
    };
  }

  const pathParts = pathname.split("/");
  if (
    pathParts.length < 4 ||
    pathParts[0] !== "drive" ||
    pathParts[1] !== "organizations"
  ) {
    throw unprocessableEntity("Invalid pathname format");
  }

  const orgId = pathParts[2];
  return {
    scope: "organization",
    ownerId: orgId,
  };
}
