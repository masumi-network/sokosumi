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
 */
function assertDriveStoreMatchesWorkspace(
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

  return member.organization;
}

/**
 * Require drive file access for operations (list, download, rename, delete).
 * Personal: owner only, and only in a personal workspace when the actor is bound.
 * Org: any member; bound actors must be in that organization workspace.
 */
export async function requireDriveFileAccess(
  authContext: AuthenticationContext,
  scope: "user" | "organization",
  ownerId: string,
): Promise<void> {
  const userContext = await requireAuthorizedUserContext(authContext);
  bindDriveStoreToWorkspace(userContext, scope, ownerId);

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
