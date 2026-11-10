import type { Organization } from "@sokosumi/database";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import {
  hiddenDataRoomFolders,
  insideHiddenRoom,
  touchesHiddenRoom,
} from "@/lib/data-room-visibility";
import prisma from "@/lib/db/prisma";
import { driveOwnerOf } from "@/lib/drive-blob";
import { resolveFileActor } from "@/lib/files/actor";
import type { AuthenticationContext, UserContext } from "@/middleware/auth";

const PERSONAL_DRIVE_WORKSPACE_MESSAGE =
  "My Drive is only available in a personal workspace";
const ORGANIZATION_DRIVE_WORKSPACE_MESSAGE =
  "Organization Drive is only available in an organization workspace";
const ACTIVE_ORGANIZATION_DRIVE_MESSAGE =
  "You can only access the Drive for the active organization workspace";

/**
 * Session and X-Context actors have an active workspace.
 * User API keys and OAuth tokens do not — they keep ownership / membership only.
 */
function shouldBindDriveStoreToWorkspace(userContext: UserContext): boolean {
  if (userContext.source === "context") {
    return true;
  }

  return (
    userContext.authenticationMethod !== "api_key" &&
    userContext.authenticationMethod !== "oauth"
  );
}

/**
 * Drive store must match the active workspace.
 * Personal workspace (`organizationId` null) is My Drive.
 * Organization workspace is that organization's Drive only.
 * Pure check for callers that already hold the workspace (e.g. Social post media refs).
 */
export function assertDriveStoreMatchesWorkspace(
  userContext: Pick<UserContext, "organizationId">,
  scope: "user" | "organization",
  ownerId: string,
): void {
  if (scope === "user") {
    if (userContext.organizationId !== null) {
      throw forbidden(PERSONAL_DRIVE_WORKSPACE_MESSAGE);
    }
    return;
  }

  if (userContext.organizationId === null) {
    throw forbidden(ORGANIZATION_DRIVE_WORKSPACE_MESSAGE);
  }

  if (userContext.organizationId !== ownerId) {
    throw forbidden(ACTIVE_ORGANIZATION_DRIVE_MESSAGE);
  }
}

function bindDriveStoreToWorkspace(
  userContext: UserContext,
  scope: "user" | "organization",
  ownerId: string,
): void {
  if (!shouldBindDriveStoreToWorkspace(userContext)) {
    return;
  }

  assertDriveStoreMatchesWorkspace(userContext, scope, ownerId);
}

/**
 * Bind a Drive store (`me` / `org`) to the active workspace.
 * Session and X-Context actors cannot list or copy across stores.
 * User API keys and OAuth skip the bind.
 */
export function requireDriveStoreMatchesActiveWorkspace(
  userContext: UserContext,
  scope: "user" | "organization",
  ownerId: string,
): void {
  bindDriveStoreToWorkspace(userContext, scope, ownerId);
}

/**
 * Require user drive file upload access (personal drive only, owner).
 * Throws 403 if not the owner, or if a bound workspace is not personal.
 */
export async function requireUserDriveFileUploadAccess(
  authContext: AuthenticationContext,
  userId: string,
): Promise<void> {
  const userContext = await requireAuthorizedUserContext(authContext);
  bindDriveStoreToWorkspace(userContext, "user", userId);

  if (userContext.userId !== userId) {
    throw forbidden("You can only upload to your own personal drive");
  }
}

/**
 * Require organization drive file upload access (any member of the active org).
 * Throws 403 if a bound workspace is not this organization, or if not a member.
 */
export async function requireOrganizationDriveFileUploadAccess(
  authContext: AuthenticationContext,
  organizationId: string,
  paths: DrivePathsReached = {},
): Promise<Organization> {
  const userContext = await requireAuthorizedUserContext(authContext);
  bindDriveStoreToWorkspace(userContext, "organization", organizationId);

  const member = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId: userContext.userId,
        organizationId,
      },
    },
    include: {
      organization: true,
    },
  });

  if (!member) {
    throw notFound("Organization not found or you are not a member");
  }

  await requireVisibleDrivePaths(userContext, organizationId, paths);
  return member.organization;
}

/** The path within its store of a Drive pathname, as the access gate takes it. */
export function drivePathOf(pathname: string): string {
  return driveOwnerOf(pathname)?.path ?? pathname;
}

/** Paths within a store that an operation reaches. */
export interface DrivePathsReached {
  /** Files or folders read, renamed, moved or deleted. */
  changes?: readonly string[];
  /** Folders something is written into. */
  into?: readonly string[];
}

/**
 * Refuses paths in organization data rooms this caller is not in: 404 inside
 * one, so a room's files look like they are not there, and 403 for changing a
 * folder that holds one, which cannot be moved or deleted around its people.
 */
async function requireVisibleDrivePaths(
  userContext: UserContext,
  organizationId: string,
  paths: DrivePathsReached,
): Promise<string[]> {
  const hidden = await hiddenDataRoomFolders(
    organizationId,
    resolveFileActor(userContext, { organizationId }),
  );
  for (const path of [...(paths.changes ?? []), ...(paths.into ?? [])])
    if (insideHiddenRoom(hidden, path)) throw notFound("File not found");
  for (const path of paths.changes ?? [])
    if (touchesHiddenRoom(hidden, path))
      throw forbidden("This folder holds a data room you are not in");
  return hidden;
}

/**
 * Require drive file access for operations (list, download, rename, delete).
 * Personal: owner only, and only in a personal workspace when the actor is bound.
 * Org: any member; bound actors must be in that organization workspace. A
 * data room's folder is for its people only: `paths` are refused when they
 * reach into one the caller is not in, and listings drop the returned
 * `hiddenRoomFolders`.
 */
export async function requireDriveFileAccess(
  authContext: AuthenticationContext,
  scope: "user" | "organization",
  ownerId: string,
  paths: DrivePathsReached = {},
): Promise<{ hiddenRoomFolders: string[] }> {
  const userContext = await requireAuthorizedUserContext(authContext);
  bindDriveStoreToWorkspace(userContext, scope, ownerId);

  if (scope === "user") {
    // Personal drive: owner only
    if (userContext.userId !== ownerId) {
      throw forbidden("You can only access your own personal drive files");
    }
    return { hiddenRoomFolders: [] };
  }

  // Organization drive: any member
  const member = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId: userContext.userId,
        organizationId: ownerId,
      },
    },
  });

  if (!member) {
    throw forbidden(
      "You can only access organization drive files if you are a member",
    );
  }

  return {
    hiddenRoomFolders: await requireVisibleDrivePaths(
      userContext,
      ownerId,
      paths,
    ),
  };
}
