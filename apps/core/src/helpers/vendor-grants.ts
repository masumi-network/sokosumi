import {
  type Prisma,
  VendorGrantScope,
  VendorGrantStatus,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { CoworkerAuthenticationContext } from "@/middleware/auth";

import { forbidden, notFound } from "./error";

export function isVendorGrantEnabled(): boolean {
  return getEnv().VENDOR_GRANT_ENABLED;
}

export function isTaskAwaitingVendorApproval(task: {
  pendingVendorGrantId?: string | null;
}): boolean {
  return task.pendingVendorGrantId != null;
}

export function requireTaskNotAwaitingVendorApproval(task: {
  pendingVendorGrantId?: string | null;
}) {
  if (isTaskAwaitingVendorApproval(task)) {
    throw forbidden(
      "Tasks awaiting vendor approval cannot be modified until vendor access is granted",
    );
  }
}

export function resolveRequiredGrantScope(
  actorVendorId: string,
  assigneeVendorId: string | null | undefined,
): VendorGrantScope {
  if (assigneeVendorId && assigneeVendorId === actorVendorId) {
    return VendorGrantScope.VENDOR;
  }

  return VendorGrantScope.WORKSPACE;
}

export async function hasAutonomyGrant(
  params: {
    vendorId: string;
    userId: string;
    workspaceId: string;
    scope: VendorGrantScope;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const grants = await tx.vendorGrant.findMany({
    where: {
      vendorId: params.vendorId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      status: VendorGrantStatus.GRANTED,
      scope: {
        in:
          params.scope === VendorGrantScope.VENDOR
            ? [VendorGrantScope.VENDOR, VendorGrantScope.WORKSPACE]
            : [VendorGrantScope.WORKSPACE],
      },
    },
    select: { id: true },
    take: 1,
  });

  return grants.length > 0;
}

const taskSiblingSelect = {
  coworkerId: true,
  status: true,
  pendingVendorGrantId: true,
  coworker: {
    select: {
      vendorId: true,
    },
  },
} as const;

type TaskForSiblingCheck = Prisma.TaskGetPayload<{
  select: typeof taskSiblingSelect;
}>;

export async function loadTaskForSiblingCheck(
  taskId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<TaskForSiblingCheck | null> {
  return await tx.task.findFirst({
    where: {
      id: taskId,
      workspaceId,
      archivedAt: null,
    },
    select: taskSiblingSelect,
  });
}

export function isVendorSiblingInWorkspace(
  actor: CoworkerAuthenticationContext,
  task: TaskForSiblingCheck,
): boolean {
  if (!actor.delegation) {
    return false;
  }

  if (task.pendingVendorGrantId !== null) {
    return false;
  }

  if (task.status === TaskStatus.DRAFT) {
    return false;
  }

  if (!task.coworkerId || !task.coworker?.vendorId) {
    return false;
  }

  if (task.coworkerId === actor.coworkerId) {
    return false;
  }

  return task.coworker.vendorId === actor.vendorId;
}

export async function loadActorVendorId(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const coworker = await tx.coworker.findUnique({
    where: { id: coworkerId },
    select: { vendorId: true },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }

  return coworker.vendorId;
}

export function buildSessionWorkspaceAwaitingVendorApprovalTaskFilter(
  ownerUserId: string,
): Prisma.TaskWhereInput {
  // Workspace lists hide awaiting-approval tasks from non-owners, but the task owner
  // must still see their own pending tasks (matches single-task read).
  return {
    OR: [{ pendingVendorGrantId: null }, { userId: ownerUserId }],
  };
}

export function buildDelegatedWorkspaceAwaitingVendorApprovalTaskFilter(
  assignedCoworkerId: string,
): Prisma.TaskWhereInput {
  // Delegated workspace lists hide awaiting-approval tasks from vendor siblings, but the
  // assigned coworker must still see their own pending tasks (matches single-task read).
  return {
    OR: [{ pendingVendorGrantId: null }, { coworkerId: assignedCoworkerId }],
  };
}

interface DelegatedCoworkerTaskListAccessParams {
  coworkerId: string;
  vendorId: string;
}

/**
 * Delegated coworker task lists mirror detail read access: assignee tasks plus
 * same-vendor siblings (non-DRAFT, not parked).
 */
export function buildDelegatedCoworkerTaskListAccessFilter(
  params: DelegatedCoworkerTaskListAccessParams,
): Prisma.TaskWhereInput {
  return {
    AND: [
      {
        OR: [
          { coworkerId: params.coworkerId },
          {
            pendingVendorGrantId: null,
            status: { not: TaskStatus.DRAFT },
            coworkerId: { not: params.coworkerId },
            coworker: {
              vendorId: params.vendorId,
            },
          },
        ],
      },
    ],
  };
}

export function isGrantDenied(status: VendorGrantStatus): boolean {
  return (
    status === VendorGrantStatus.DENIED || status === VendorGrantStatus.REVOKED
  );
}

export async function resolveAssigneeVendorId(
  coworkerId: string | null | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  if (!coworkerId) {
    return null;
  }

  const coworker = await tx.coworker.findUnique({
    where: { id: coworkerId },
    select: { vendorId: true },
  });

  return coworker?.vendorId ?? null;
}

export interface DelegatedVendorGrantState {
  scope: VendorGrantScope;
  existingGrant: { id: string; status: VendorGrantStatus } | null;
  granted: boolean;
}

export async function getDelegatedVendorGrantState(
  params: {
    actorVendorId: string;
    userId: string;
    workspaceId: string;
    assigneeCoworkerId: string | null | undefined;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<DelegatedVendorGrantState> {
  const assigneeVendorId = await resolveAssigneeVendorId(
    params.assigneeCoworkerId,
    tx,
  );
  const scope = resolveRequiredGrantScope(
    params.actorVendorId,
    assigneeVendorId,
  );

  const existingGrant = await tx.vendorGrant.findUnique({
    where: {
      vendorId_userId_workspaceId_scope: {
        vendorId: params.actorVendorId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        scope,
      },
    },
    select: { id: true, status: true },
  });

  if (existingGrant && isGrantDenied(existingGrant.status)) {
    throw forbidden("Vendor access was denied for this workspace", {
      kind: "grant_denied",
    });
  }

  const granted =
    existingGrant?.status === VendorGrantStatus.GRANTED ||
    (await hasAutonomyGrant(
      {
        vendorId: params.actorVendorId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        scope,
      },
      tx,
    ));

  return { scope, existingGrant, granted };
}

export async function requireDelegatedVendorAutonomyForAssignee(
  params: {
    actorVendorId: string;
    userId: string;
    workspaceId: string;
    assigneeCoworkerId: string | null | undefined;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const grantState = await getDelegatedVendorGrantState(params, tx);

  if (!grantState.granted) {
    throw forbidden("Vendor access is required for this workspace", {
      kind: "grant_denied",
    });
  }
}
