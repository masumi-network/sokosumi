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
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

/** API / OpenAPI permission string for vendor workspace access. */
export const VendorPermissionApi = {
  WORKSPACE: "workspace",
} as const;

export type VendorPermissionApiValue =
  (typeof VendorPermissionApi)[keyof typeof VendorPermissionApi];

export function toApiVendorPermission(
  _permission: VendorPermission,
): VendorPermissionApiValue {
  return VendorPermissionApi.WORKSPACE;
}

function workspaceGrantUniqueWhere(vendorId: string, workspaceId: string) {
  return {
    vendorId_workspaceId: {
      vendorId,
      workspaceId,
    },
  } as const;
}

export function isGrantDeniedOrRevoked(status: VendorGrantStatus): boolean {
  return (
    status === VendorGrantStatus.DENIED || status === VendorGrantStatus.REVOKED
  );
}

function isTaskParked(task: Pick<Task, "pendingVendorGrantId">): boolean {
  return task.pendingVendorGrantId != null;
}

export function requireTaskNotParked(
  task: Pick<Task, "pendingVendorGrantId">,
): void {
  if (isTaskParked(task)) {
    throw forbidden(
      "Parked tasks cannot be modified until vendor workspace access is granted",
      { kind: "task_parked" },
    );
  }
}

export async function hasGrantedWorkspaceAccess(
  params: {
    vendorId: string;
    workspaceId: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const grant = await tx.vendorGrant.findUnique({
    where: workspaceGrantUniqueWhere(params.vendorId, params.workspaceId),
    select: { status: true },
  });

  return grant?.status === VendorGrantStatus.GRANTED;
}

export async function getWorkspaceGrant(
  params: {
    vendorId: string;
    workspaceId: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<Pick<VendorGrant, "id" | "status" | "permission"> | null> {
  return await tx.vendorGrant.findUnique({
    where: workspaceGrantUniqueWhere(params.vendorId, params.workspaceId),
    select: { id: true, status: true, permission: true },
  });
}

/**
 * Upsert PENDING when no row exists. Never reopens DENIED / REVOKED / GRANTED /
 * existing PENDING. Returns whether a new PENDING row was created.
 */
export async function requestWorkspaceGrant(
  params: {
    vendorId: string;
    workspaceId: string;
    requestedByUserId?: string | null;
    /** When false, caller must notify after the surrounding transaction commits. */
    notify?: boolean;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<{ grant: VendorGrant; created: boolean }> {
  const uniqueWhere = workspaceGrantUniqueWhere(
    params.vendorId,
    params.workspaceId,
  );

  const existing = await tx.vendorGrant.findUnique({
    where: uniqueWhere,
  });

  if (existing) {
    return { grant: existing, created: false };
  }

  try {
    const grant = await tx.vendorGrant.create({
      data: {
        vendorId: params.vendorId,
        workspaceId: params.workspaceId,
        permission: VendorPermission.workspace,
        status: VendorGrantStatus.PENDING,
        requestedByUserId: params.requestedByUserId ?? null,
      },
    });

    if (params.notify !== false) {
      await notifyWorkspaceApproversOfPendingGrant(
        {
          vendorId: params.vendorId,
          workspaceId: params.workspaceId,
          grantId: grant.id,
        },
        tx,
      );
    }

    return { grant, created: true };
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }

    const raced = await tx.vendorGrant.findUnique({
      where: uniqueWhere,
    });

    if (!raced) {
      throw error;
    }

    return { grant: raced, created: false };
  }
}

/**
 * Notify grant approvers for a workspace: org OWNER/ADMIN when the workspace
 * belongs to an organization, otherwise the personal workspace owner.
 */
export async function notifyWorkspaceApproversOfPendingGrant(
  params: {
    vendorId: string;
    workspaceId: string;
    grantId: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const workspace = await tx.workspace.findUnique({
    where: { id: params.workspaceId },
    select: { userId: true, organizationId: true },
  });

  if (!workspace) {
    return;
  }

  let recipientUserIds: string[] = [];

  if (workspace.organizationId) {
    const members = await tx.member.findMany({
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

  const vendor = await tx.vendor.findUnique({
    where: { id: params.vendorId },
    select: { name: true, slug: true },
  });

  await Promise.all(
    recipientUserIds.map((userId) =>
      createNotification(
        {
          userId,
          kind: NotificationKind.SYSTEM,
          referenceId: params.grantId,
          eventId: params.grantId,
          messageKey: "notifications.vendorGrant.pending",
          messageParams: {
            vendorName: vendor?.name ?? params.vendorId,
            vendorSlug: vendor?.slug ?? null,
            permission: VendorPermissionApi.WORKSPACE,
            workspaceId: params.workspaceId,
            organizationId: workspace.organizationId,
          },
          metadata: {
            vendorId: params.vendorId,
            workspaceId: params.workspaceId,
            organizationId: workspace.organizationId,
            permission: VendorPermissionApi.WORKSPACE,
          },
        },
        tx,
      ),
    ),
  );
}

type VendorGrantWithVendor = VendorGrant & {
  vendor: { name: string; slug: string };
};

/**
 * Create or upgrade the workspace grant to GRANTED and unpark linked tasks.
 */
export async function grantWorkspaceAccess(
  params: {
    vendorId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<VendorGrantWithVendor> {
  const now = new Date();
  const grant = await tx.vendorGrant.upsert({
    where: workspaceGrantUniqueWhere(params.vendorId, params.workspaceId),
    create: {
      vendorId: params.vendorId,
      workspaceId: params.workspaceId,
      permission: VendorPermission.workspace,
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

  await unparkTasksForGrant(grant.id, tx);

  return grant;
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
    data: {
      pendingVendorGrantId: null,
      status: TaskStatus.READY,
    },
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
 * Workspace list filter when coworker has GRANTED workspace access: all non-DRAFT
 * in workspace. Otherwise baseline sibling filter only.
 */
export function buildCoworkerTaskListAccessFilter(params: {
  coworkerId: string;
  vendorId: string;
  hasWorkspaceGrant: boolean;
}): Prisma.TaskWhereInput {
  if (params.hasWorkspaceGrant) {
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
): never {
  if (status === VendorGrantStatus.DENIED) {
    throw forbidden("Vendor workspace access was denied", {
      kind: "grant_denied",
      extensions: { permission: VendorPermissionApi.WORKSPACE },
    });
  }

  if (status === VendorGrantStatus.REVOKED) {
    throw forbidden("Vendor workspace access was revoked", {
      kind: "grant_revoked",
      extensions: { permission: VendorPermissionApi.WORKSPACE },
    });
  }

  throw forbidden("Vendor workspace access is required", {
    kind: "grant_required",
    extensions: { permission: VendorPermissionApi.WORKSPACE },
  });
}
