import type {
  DriveFile,
  Member,
  Organization,
  Prisma,
  User,
} from "@sokosumi/database";

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
 * Require drive file read access and return the file.
 * Personal: owner only.
 * Org: any member can read.
 */
export async function requireDriveFileReadAccess(
  authContext: AuthenticationContext,
  fileId: string,
): Promise<
  DriveFile & {
    user: User | null;
    organization: (Organization & { members: Member[] }) | null;
  }
> {
  const userContext = await requireAuthorizedUserContext(authContext);

  const file = await prisma.driveFile.findUnique({
    where: { id: fileId },
    include: {
      user: true,
      organization: {
        include: {
          members: true,
        },
      },
    },
  });

  if (!file) {
    throw notFound("Drive file not found");
  }

  // Personal file: owner only
  if (file.userId) {
    if (file.userId !== userContext.userId) {
      throw forbidden("You can only access your own personal drive files");
    }
    return file;
  }

  // Org file: any member can read
  if (file.organizationId) {
    const isMember = file.organization?.members.some(
      (m) => m.userId === userContext.userId,
    );
    if (!isMember) {
      throw forbidden(
        "You can only access organization drive files if you are a member",
      );
    }
    return file;
  }

  throw notFound("Drive file has no owner");
}

/**
 * Require drive file write access (rename/delete).
 * Personal: owner only.
 * Org: uploader or org admin.
 */
export async function requireDriveFileWriteAccess(
  authContext: AuthenticationContext,
  fileId: string,
): Promise<
  DriveFile & {
    user: User | null;
    organization: (Organization & { members: Member[] }) | null;
  }
> {
  const userContext = await requireAuthorizedUserContext(authContext);

  const file = await prisma.driveFile.findUnique({
    where: { id: fileId },
    include: {
      user: true,
      organization: {
        include: {
          members: true,
        },
      },
    },
  });

  if (!file) {
    throw notFound("Drive file not found");
  }

  // Personal file: owner only
  if (file.userId) {
    if (file.userId !== userContext.userId) {
      throw forbidden("You can only modify your own personal drive files");
    }
    return file;
  }

  // Org file: uploader or org admin or org owner
  if (file.organizationId) {
    const member = file.organization?.members.find(
      (m) => m.userId === userContext.userId,
    );

    if (!member) {
      throw forbidden(
        "You can only modify organization drive files if you are a member",
      );
    }

    // Allow if uploader, admin, or owner
    const isUploader = file.uploadedByUserId === userContext.userId;
    const isAdmin = member.role === "admin";
    const isOwner = member.role === "owner";

    if (!isUploader && !isAdmin && !isOwner) {
      throw forbidden(
        "You can only modify files you uploaded or if you are an organization admin or owner",
      );
    }

    return file;
  }

  throw notFound("Drive file has no owner");
}

/**
 * List drive files for a user (personal drive).
 */
export async function listUserDriveFiles(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<DriveFile[]> {
  const client = tx ?? prisma;
  return client.driveFile.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * List drive files for an organization.
 * Caller must verify membership before calling.
 */
export async function listOrganizationDriveFiles(
  organizationId: string,
  tx?: Prisma.TransactionClient,
): Promise<DriveFile[]> {
  const client = tx ?? prisma;
  return client.driveFile.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
}
