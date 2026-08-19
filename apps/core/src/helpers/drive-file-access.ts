import type { Organization } from "@sokosumi/database";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Require user drive file upload access (personal drive only, owner).
 * Throws 403 if not the owner.
 */
export async function requireUserDriveFileUploadAccess(
  authContext: AuthenticationContext,
  userId: string,
): Promise<void> {
  const userContext = await requireAuthorizedUserContext(authContext);

  if (userContext.userId !== userId) {
    throw forbidden("You can only upload to your own personal drive");
  }
}

/**
 * Require organization drive file upload access (any member).
 * Throws 403 if not a member of the organization.
 */
export async function requireOrganizationDriveFileUploadAccess(
  authContext: AuthenticationContext,
  organizationId: string,
): Promise<Organization> {
  const userContext = await requireAuthorizedUserContext(authContext);

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
 * Personal: owner only.
 * Org: any member.
 */
export async function requireDriveFileAccess(
  authContext: AuthenticationContext,
  scope: "user" | "organization",
  ownerId: string,
): Promise<void> {
  const userContext = await requireAuthorizedUserContext(authContext);

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
