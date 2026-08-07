import {
  Channel,
  GrantResumeStatus,
  MemberRole,
  NotificationKind,
  type Prisma,
  type Task,
  TaskStatus,
  type VendorGrant,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import {
  badRequest,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@/helpers/notification-feed";
import {
  createNotification,
  deletePendingVendorGrantNotifications,
} from "@/helpers/notifications";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

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

async function lockVendorGrantById(
  grantId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "vendor_grant" WHERE "id" = ${grantId}::uuid FOR UPDATE
  `;
}

async function lockWorkspaceGrantRow(
  params: { vendorId: string; workspaceId: string },
  tx: Prisma.TransactionClient,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "vendor_grant"
    WHERE "vendorId" = ${params.vendorId}::uuid
      AND "workspaceId" = ${params.workspaceId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export function isGrantDeniedOrRevoked(status: VendorGrantStatus): boolean {
  return (
    status === VendorGrantStatus.DENIED || status === VendorGrantStatus.REVOKED
  );
}

function isTaskParked(task: Pick<Task, "status">): boolean {
  return task.status === TaskStatus.GRANT_PENDING;
}

export function isGrantPendingTask(task: Pick<Task, "status">): boolean {
  return isTaskParked(task);
}

export function parseGrantResumeStatus(status: TaskStatus): GrantResumeStatus {
  if (status === TaskStatus.DRAFT) {
    return GrantResumeStatus.DRAFT;
  }
  if (status === TaskStatus.READY) {
    return GrantResumeStatus.READY;
  }
  throw unprocessableEntity(
    "Only DRAFT or READY may be requested when vendor workspace access is pending",
  );
}

function grantResumeStatusToTaskStatus(
  grantResumeStatus: GrantResumeStatus,
): TaskStatus {
  switch (grantResumeStatus) {
    case GrantResumeStatus.DRAFT:
      return TaskStatus.DRAFT;
    case GrantResumeStatus.READY:
      return TaskStatus.READY;
    default: {
      const _exhaustive: never = grantResumeStatus;
      throw badRequest(`Unknown grant resume status ${_exhaustive}`);
    }
  }
}

export function requireTaskNotParked(task: Pick<Task, "status">): void {
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
    notify?: boolean;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<{ grant: VendorGrant; created: boolean }> {
  const uniqueWhere = workspaceGrantUniqueWhere(
    params.vendorId,
    params.workspaceId,
  );

  const lockedRow = await lockWorkspaceGrantRow(
    { vendorId: params.vendorId, workspaceId: params.workspaceId },
    tx,
  );

  if (lockedRow) {
    const existing = await tx.vendorGrant.findUnique({
      where: { id: lockedRow.id },
    });
    if (existing) {
      return { grant: existing, created: false };
    }
  }

  try {
    await tx.$executeRaw`SAVEPOINT vendor_grant_create`;

    const grant = await tx.vendorGrant.create({
      data: {
        vendorId: params.vendorId,
        workspaceId: params.workspaceId,
        permission: VendorPermission.workspace,
        status: VendorGrantStatus.PENDING,
        requestedByUserId: params.requestedByUserId ?? null,
      },
    });

    await tx.$executeRaw`RELEASE SAVEPOINT vendor_grant_create`;

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

    await tx.$executeRaw`ROLLBACK TO SAVEPOINT vendor_grant_create`;

    const racedRow = await lockWorkspaceGrantRow(
      { vendorId: params.vendorId, workspaceId: params.workspaceId },
      tx,
    );
    const raced = racedRow
      ? await tx.vendorGrant.findUnique({ where: { id: racedRow.id } })
      : await tx.vendorGrant.findUnique({ where: uniqueWhere });

    if (!raced) {
      throw error;
    }

    return { grant: raced, created: false };
  }
}

export async function requestWorkspaceGrantCommitted(params: {
  vendorId: string;
  workspaceId: string;
  requestedByUserId?: string | null;
  notify?: boolean;
}): Promise<{ grant: VendorGrant; created: boolean }> {
  return prisma.$transaction(async (grantTx) =>
    requestWorkspaceGrant(params, grantTx),
  );
}

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

  for (const userId of recipientUserIds) {
    await createNotification(
      {
        userId,
        kind: NotificationKind.SYSTEM,
        referenceId: params.grantId,
        eventId: params.grantId,
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
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
    );
  }
}

export type VendorGrantWithVendor = VendorGrant & {
  vendor: { name: string; slug: string };
};

const vendorGrantWithVendorInclude = {
  vendor: { select: { name: true, slug: true } },
} as const;

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
    include: vendorGrantWithVendorInclude,
  });

  await lockVendorGrantById(grant.id, tx);
  await unparkTasksForGrant(grant.id, tx, params.resolvedById);
  await deletePendingVendorGrantNotifications(grant.id, tx);

  return grant;
}

export async function approveVendorGrantInWorkspace(
  params: {
    grantId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient,
): Promise<VendorGrantWithVendor> {
  await lockVendorGrantById(params.grantId, tx);

  const existing = await tx.vendorGrant.findFirst({
    where: { id: params.grantId, workspaceId: params.workspaceId },
    include: vendorGrantWithVendorInclude,
  });

  if (!existing) {
    throw notFound("Vendor grant not found");
  }

  switch (existing.status) {
    case VendorGrantStatus.GRANTED:
      await unparkTasksForGrant(existing.id, tx, params.resolvedById);
      await deletePendingVendorGrantNotifications(existing.id, tx);
      return existing;
    case VendorGrantStatus.PENDING:
    case VendorGrantStatus.DENIED:
    case VendorGrantStatus.REVOKED:
      break;
    default: {
      const _exhaustive: never = existing.status;
      throw badRequest(`Cannot approve grant in status ${_exhaustive}`);
    }
  }

  const now = new Date();
  const updated = await tx.vendorGrant.update({
    where: { id: params.grantId },
    data: {
      status: VendorGrantStatus.GRANTED,
      resolvedAt: now,
      resolvedById: params.resolvedById,
    },
    include: vendorGrantWithVendorInclude,
  });

  await unparkTasksForGrant(updated.id, tx, params.resolvedById);
  await deletePendingVendorGrantNotifications(updated.id, tx);

  return updated;
}

export async function denyVendorGrantInWorkspace(
  params: {
    grantId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient,
): Promise<VendorGrantWithVendor> {
  await lockVendorGrantById(params.grantId, tx);

  const existing = await tx.vendorGrant.findFirst({
    where: { id: params.grantId, workspaceId: params.workspaceId },
    include: vendorGrantWithVendorInclude,
  });

  if (!existing) {
    throw notFound("Vendor grant not found");
  }

  if (existing.status !== VendorGrantStatus.PENDING) {
    throw badRequest("Only PENDING grants can be denied");
  }

  const updated = await tx.vendorGrant.update({
    where: { id: params.grantId },
    data: {
      status: VendorGrantStatus.DENIED,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
    },
    include: vendorGrantWithVendorInclude,
  });

  await cancelParkedTasksForGrant(
    { grantId: updated.id, resolvedById: params.resolvedById },
    tx,
  );
  await deletePendingVendorGrantNotifications(updated.id, tx);

  return updated;
}

export async function revokeVendorGrantInWorkspace(
  params: {
    grantId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient,
): Promise<VendorGrantWithVendor> {
  await lockVendorGrantById(params.grantId, tx);

  const existing = await tx.vendorGrant.findFirst({
    where: { id: params.grantId, workspaceId: params.workspaceId },
    include: vendorGrantWithVendorInclude,
  });

  if (!existing) {
    throw notFound("Vendor grant not found");
  }

  if (existing.status !== VendorGrantStatus.GRANTED) {
    throw badRequest("Only GRANTED grants can be revoked");
  }

  const updated = await tx.vendorGrant.update({
    where: { id: params.grantId },
    data: {
      status: VendorGrantStatus.REVOKED,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
    },
    include: vendorGrantWithVendorInclude,
  });

  await cancelParkedTasksForGrant(
    { grantId: updated.id, resolvedById: params.resolvedById },
    tx,
  );

  return updated;
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
  resolvedById: string | null = null,
): Promise<number> {
  const parkedTasks = await tx.task.findMany({
    where: {
      pendingVendorGrantId: grantId,
      archivedAt: null,
      status: TaskStatus.GRANT_PENDING,
    },
    select: { id: true, grantResumeStatus: true },
  });

  let unparkedCount = 0;

  for (const task of parkedTasks) {
    const resumeStatus = task.grantResumeStatus
      ? grantResumeStatusToTaskStatus(task.grantResumeStatus)
      : TaskStatus.READY;

    const result = await tx.task.updateMany({
      where: {
        id: task.id,
        pendingVendorGrantId: grantId,
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: resumeStatus,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
    });

    if (result.count === 0) {
      continue;
    }

    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        status: resumeStatus,
        channel: Channel.SOKOSUMI,
        userId: resolvedById,
        comment: null,
        coworkerId: null,
      },
    });
    unparkedCount += 1;
  }

  return unparkedCount;
}

export async function cancelParkedTasksForGrant(
  params: {
    grantId: string;
    resolvedById?: string | null;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const parkedTasks = await tx.task.findMany({
    where: {
      pendingVendorGrantId: params.grantId,
      archivedAt: null,
      status: TaskStatus.GRANT_PENDING,
    },
    select: { id: true },
  });

  let canceledCount = 0;

  for (const task of parkedTasks) {
    const result = await tx.task.updateMany({
      where: {
        id: task.id,
        pendingVendorGrantId: params.grantId,
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: TaskStatus.CANCELED,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
    });

    if (result.count === 0) {
      continue;
    }

    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        status: TaskStatus.CANCELED,
        channel: Channel.SOKOSUMI,
        userId: params.resolvedById ?? null,
        comment: null,
        coworkerId: null,
      },
    });
    canceledCount += 1;
  }

  return canceledCount;
}

export function isBaselineCoworkerTaskAccess(params: {
  actorCoworkerId: string;
  actorVendorId: string;
  task: {
    assigneeId: string | null;
    status: string;
    assignee?: { vendorId: string } | null;
  };
}): boolean {
  if (params.task.status === TaskStatus.DRAFT) {
    return false;
  }

  if (params.task.assigneeId === params.actorCoworkerId) {
    return true;
  }

  if (
    params.task.assigneeId &&
    params.task.assignee?.vendorId === params.actorVendorId
  ) {
    return true;
  }

  return false;
}

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
      { assigneeId: params.coworkerId },
      {
        assigneeId: { not: params.coworkerId },
        assignee: { vendorId: params.vendorId },
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
