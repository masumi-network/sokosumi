import type { Organization } from "@sokosumi/database";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext, UserContext } from "@/middleware/auth";

const PERSONAL_DRIVE_WORKSPACE_MESSAGE =
  "My Drive is only available in a personal workspace";
const ORGANIZATION_DRIVE_WORKSPACE_MESSAGE =
  "Organization Drive is only available in an organization workspace";
const ACTIVE_ORGANIZATION_DRIVE_MESSAGE =
  "You can only access the Drive for the active organization workspace";

/**
 * Drive store must match the active workspace.
 * Personal workspace (`organizationId` null) is My Drive.
 * Organization workspace is that organization's Drive only.
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

/**
 * Require user drive file upload access (personal drive only, owner).
 * Throws 403 if not the owner or if the active workspace is not personal.
 */
export async function requireUserDriveFileUploadAccess(
  authContext: AuthenticationContext,
  userId: string,
): Promise<void> {
  const userContext = await requireAuthorizedUserContext(authContext);
  assertDriveStoreMatchesWorkspace(userContext, "user", userId);

  if (userContext.userId !== userId) {
    throw forbidden("You can only upload to your own personal drive");
  }
}

/**
 * Require organization drive file upload access (any member of the active org).
 * Throws 403 if the store is not the active workspace, or if not a member.
 */
export async function requireOrganizationDriveFileUploadAccess(
  authContext: AuthenticationContext,
  organizationId: string,
): Promise<Organization> {
  const userContext = await requireAuthorizedUserContext(authContext);
  assertDriveStoreMatchesWorkspace(userContext, "organization", organizationId);

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

  return member.organization;
}

/**
 * Require drive file access for operations (list, download, rename, delete).
 * Personal: owner only, and only in a personal workspace.
 * Org: any member of the active organization workspace.
 */
export async function requireDriveFileAccess(
  authContext: AuthenticationContext,
  scope: "user" | "organization",
  ownerId: string,
): Promise<void> {
  const userContext = await requireAuthorizedUserContext(authContext);
  assertDriveStoreMatchesWorkspace(userContext, scope, ownerId);

  if (scope === "user") {
    // Personal drive: owner only
    if (userContext.userId !== ownerId) {
      throw forbidden("You can only access your own personal drive files");
    }
    return;
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
}
