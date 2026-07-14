import {
  MemberRole,
  NotificationKind,
  type Prisma,
  type Task,
  type VendorGrant,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { forbidden } from "@/helpers/error";
import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

/** API / OpenAPI permission strings (`resource:action`). */
export const VendorPermissionApi = {
  TASK_READ: "task:read",
  TASK_COMMENT: "task:comment",
  TASK_CREATE: "task:create",
} as const;

export type VendorPermissionApiValue =
  (typeof VendorPermissionApi)[keyof typeof VendorPermissionApi];

const API_TO_PRISMA: Record<VendorPermissionApiValue, VendorPermission> = {
  [VendorPermissionApi.TASK_READ]: VendorPermission.task_read,
  [VendorPermissionApi.TASK_COMMENT]: VendorPermission.task_comment,
  [VendorPermissionApi.TASK_CREATE]: VendorPermission.task_create,
};

const PRISMA_TO_API: Record<VendorPermission, VendorPermissionApiValue> = {
  [VendorPermission.task_read]: VendorPermissionApi.TASK_READ,
  [VendorPermission.task_comment]: VendorPermissionApi.TASK_COMMENT,
  [VendorPermission.task_create]: VendorPermissionApi.TASK_CREATE,
};

export function toPrismaVendorPermission(
  permission: VendorPermissionApiValue,
): VendorPermission {
  return API_TO_PRISMA[permission];
}

export function toApiVendorPermission(
  permission: VendorPermission,
): VendorPermissionApiValue {
  return PRISMA_TO_API[permission];
}

export function isGrantDeniedOrRevoked(status: VendorGrantStatus): boolean {
  return (
    status === VendorGrantStatus.DENIED || status === VendorGrantStatus.REVOKED
  );
}

export function isTaskParked(
  task: Pick<Task, "pendingVendorGrantId">,
): boolean {
  return task.pendingVendorGrantId != null;
}

export function requireTaskNotParked(
  task: Pick<Task, "pendingVendorGrantId">,
): void {
  if (isTaskParked(task)) {
    throw forbidden(
      "Parked tasks cannot be modified until vendor create access is granted",
      { kind: "task_parked" },
    );
  }
}

export async function hasGrantedVendorPermission(
  params: {
    vendorId: string;
    workspaceId: string;
    permission: VendorPermission;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const grant = await tx.vendorGrant.findUnique({
    where: {
      vendorId_workspaceId_permission: {
        vendorId: params.vendorId,
        workspaceId: params.workspaceId,
        permission: params.permission,
      },
    },
    select: { status: true },
  });

  return grant?.status === VendorGrantStatus.GRANTED;
}

export async function getVendorGrant(
  params: {
    vendorId: string;
    workspaceId: string;
    permission: VendorPermission;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<Pick<VendorGrant, "id" | "status" | "permission"> | null> {
  return await tx.vendorGrant.findUnique({
    where: {
      vendorId_workspaceId_permission: {
        vendorId: params.vendorId,
        workspaceId: params.workspaceId,
        permission: params.permission,
      },
    },
    select: { id: true, status: true, permission: true },
  });
}

/**
 * Upsert PENDING when no row exists. Never reopens DENIED / REVOKED / GRANTED /
 * existing PENDING. Returns whether a new PENDING row was created.
 */
export async function upsertPendingVendorGrant(
  params: {
    vendorId: string;
    workspaceId: string;
    permission: VendorPermission;
    requestedByUserId?: string | null;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<{ grant: VendorGrant; created: boolean }> {
  const existing = await tx.vendorGrant.findUnique({
    where: {
      vendorId_workspaceId_permission: {
        vendorId: params.vendorId,
        workspaceId: params.workspaceId,
        permission: params.permission,
      },
    },
  });

  if (existing) {
    return { grant: existing, created: false };
  }

  const grant = await tx.vendorGrant.create({
    data: {
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      permission: params.permission,
      status: VendorGrantStatus.PENDING,
      requestedByUserId: params.requestedByUserId ?? null,
    },
  });

  return { grant, created: true };
}

/**
 * First out-of-scope read: PENDING task:read + bundled PENDING task:comment
 * when comment has no row yet.
 */
export async function requestReadGrantWithBundledComment(
  params: {
    vendorId: string;
    workspaceId: string;
    requestedByUserId?: string | null;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const read = await upsertPendingVendorGrant(
    {
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      permission: VendorPermission.task_read,
      requestedByUserId: params.requestedByUserId,
    },
    tx,
  );

  const comment = await upsertPendingVendorGrant(
    {
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      permission: VendorPermission.task_comment,
      requestedByUserId: params.requestedByUserId,
    },
    tx,
  );

  if (read.created || comment.created) {
    await notifyWorkspaceApproversOfPendingGrant({
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      primaryGrantId: read.grant.id,
      permissions: [
        VendorPermissionApi.TASK_READ,
        VendorPermissionApi.TASK_COMMENT,
      ],
      bundled: true,
    });
  }
}

export async function requestCommentGrant(
  params: {
    vendorId: string;
    workspaceId: string;
    requestedByUserId?: string | null;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const result = await upsertPendingVendorGrant(
    {
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      permission: VendorPermission.task_comment,
      requestedByUserId: params.requestedByUserId,
    },
    tx,
  );

  if (result.created) {
    await notifyWorkspaceApproversOfPendingGrant({
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      primaryGrantId: result.grant.id,
      permissions: [VendorPermissionApi.TASK_COMMENT],
      bundled: false,
    });
  }
}

export async function requestCreateGrant(
  params: {
    vendorId: string;
    workspaceId: string;
    requestedByUserId?: string | null;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<VendorGrant> {
  const result = await upsertPendingVendorGrant(
    {
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      permission: VendorPermission.task_create,
      requestedByUserId: params.requestedByUserId,
    },
    tx,
  );

  if (result.created) {
    await notifyWorkspaceApproversOfPendingGrant({
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      primaryGrantId: result.grant.id,
      permissions: [VendorPermissionApi.TASK_CREATE],
      bundled: false,
    });
  }

  return result.grant;
}

/**
 * Notify grant approvers for a workspace: org OWNER/ADMIN when the workspace
 * belongs to an organization, otherwise the personal workspace owner.
 */
async function notifyWorkspaceApproversOfPendingGrant(params: {
  vendorId: string;
  workspaceId: string;
  primaryGrantId: string;
  permissions: VendorPermissionApiValue[];
  bundled: boolean;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: params.workspaceId },
    select: { userId: true, organizationId: true },
  });

  if (!workspace) {
    return;
  }

  let recipientUserIds: string[] = [];

  if (workspace.organizationId) {
    const members = await prisma.member.findMany({
      where: {
        organizationId: workspace.organizationId,
        role: { in: [MemberRole.OWNER, MemberRole.ADMIN] },
      },
      select: { userId: true },
    });
    recipientUserIds = members.map((member) => member.userId);
  } else if (workspace.userId) {
    recipientUserIds = [workspace.userId];
  }

  if (recipientUserIds.length === 0) {
    return;
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id: params.vendorId },
    select: { name: true, slug: true },
  });

  await Promise.all(
    recipientUserIds.map((userId) =>
      createNotification({
        userId,
        kind: NotificationKind.SYSTEM,
        referenceId: params.primaryGrantId,
        eventId: params.primaryGrantId,
        messageKey: params.bundled
          ? "notifications.vendorGrant.pendingReadComment"
          : "notifications.vendorGrant.pending",
        messageParams: {
          vendorName: vendor?.name ?? params.vendorId,
          vendorSlug: vendor?.slug ?? null,
          permissions: params.permissions,
          workspaceId: params.workspaceId,
          organizationId: workspace.organizationId,
        },
        metadata: {
          vendorId: params.vendorId,
          workspaceId: params.workspaceId,
          organizationId: workspace.organizationId,
          permissions: params.permissions,
        },
      }),
    ),
  );
}

type VendorGrantWithVendor = VendorGrant & {
  vendor: { name: string; slug: string };
};

/**
 * Upsert one or more GRANTED rows for the same vendor+workspace in one call.
 * Preserves per-permission upsert semantics; unparks tasks when task:create
 * is included. Callers should wrap in a transaction when atomicity is required.
 */
export async function upsertGrantedVendorPermissions(
  params: {
    vendorId: string;
    workspaceId: string;
    permissions: VendorPermissionApiValue[];
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<VendorGrantWithVendor[]> {
  const now = new Date();
  const grants: VendorGrantWithVendor[] = [];

  for (const apiPermission of params.permissions) {
    const permission = toPrismaVendorPermission(apiPermission);
    const upserted = await tx.vendorGrant.upsert({
      where: {
        vendorId_workspaceId_permission: {
          vendorId: params.vendorId,
          workspaceId: params.workspaceId,
          permission,
        },
      },
      create: {
        vendorId: params.vendorId,
        workspaceId: params.workspaceId,
        permission,
        status: VendorGrantStatus.GRANTED,
        resolvedAt: now,
        resolvedById: params.resolvedById,
      },
      update: {
        status: VendorGrantStatus.GRANTED,
        resolvedAt: now,
        resolvedById: params.resolvedById,
      },
      include: {
        vendor: { select: { name: true, slug: true } },
      },
    });

    if (upserted.permission === VendorPermission.task_create) {
      await unparkTasksForGrant(upserted.id, tx);
    }

    grants.push(upserted);
  }

  return grants;
}

export function toVendorGrantApiShape(grant: VendorGrantWithVendor) {
  return {
    id: grant.id,
    vendorId: grant.vendorId,
    vendorName: grant.vendor.name,
    vendorSlug: grant.vendor.slug,
    workspaceId: grant.workspaceId,
    permission: toApiVendorPermission(grant.permission),
    status: grant.status,
    requestedByUserId: grant.requestedByUserId,
    resolvedAt: grant.resolvedAt,
    resolvedById: grant.resolvedById,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}

export async function unparkTasksForGrant(
  grantId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const result = await tx.task.updateMany({
    where: { pendingVendorGrantId: grantId },
    data: { pendingVendorGrantId: null },
  });
  return result.count;
}

export async function cancelParkedTasksForGrant(
  grantId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const result = await tx.task.updateMany({
    where: { pendingVendorGrantId: grantId },
    data: {
      status: TaskStatus.CANCELED,
      pendingVendorGrantId: null,
    },
  });
  return result.count;
}

export function isBaselineCoworkerTaskAccess(params: {
  actorCoworkerId: string;
  actorVendorId: string;
  task: {
    coworkerId: string | null;
    status: string;
    coworker?: { vendorId: string } | null;
  };
}): boolean {
  if (params.task.status === TaskStatus.DRAFT) {
    return false;
  }

  if (params.task.coworkerId === params.actorCoworkerId) {
    return true;
  }

  if (
    params.task.coworkerId &&
    params.task.coworker?.vendorId === params.actorVendorId
  ) {
    return true;
  }

  return false;
}

/**
 * Workspace list filter when coworker has GRANTED task:read: all non-DRAFT
 * in workspace. Otherwise baseline sibling filter only.
 */
export function buildCoworkerTaskListAccessFilter(params: {
  coworkerId: string;
  vendorId: string;
  hasReadGrant: boolean;
}): Prisma.TaskWhereInput {
  if (params.hasReadGrant) {
    return {
      status: { not: TaskStatus.DRAFT },
    };
  }

  return {
    status: { not: TaskStatus.DRAFT },
    OR: [
      { coworkerId: params.coworkerId },
      {
        coworkerId: { not: params.coworkerId },
        coworker: { vendorId: params.vendorId },
      },
    ],
  };
}

export function throwGrantAccessError(
  status: VendorGrantStatus | null | undefined,
  permission: VendorPermissionApiValue,
): never {
  if (status === VendorGrantStatus.DENIED) {
    throw forbidden("Vendor permission was denied for this workspace", {
      kind: "grant_denied",
      extensions: { permission },
    });
  }

  if (status === VendorGrantStatus.REVOKED) {
    throw forbidden("Vendor permission was revoked for this workspace", {
      kind: "grant_revoked",
      extensions: { permission },
    });
  }

  throw forbidden("Vendor permission is required for this workspace", {
    kind: "grant_required",
    extensions: { permission },
  });
}
