import {
  type CoworkerWorkspaceAccess,
  CoworkerWorkspaceAccessStatus,
  MemberRole,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { createNotification } from "@/helpers/notifications";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { CoworkerWorkspaceAccessDto } from "@/schemas/coworker-workspace-access.schema";

export interface UpsertCoworkerWorkspaceAccessParams {
  coworkerId: string;
  workspaceId: string;
  actorUserId: string;
  /** Platform admin (hasAdminRole) */
  isPlatformAdmin: boolean;
}

export const coworkerWorkspaceAccessInclude = {
  coworker: {
    select: {
      name: true,
      slug: true,
    },
  },
} satisfies Prisma.CoworkerWorkspaceAccessInclude;

export type CoworkerWorkspaceAccessWithCoworker = CoworkerWorkspaceAccess & {
  coworker: {
    name: string;
    slug: string;
  };
};

function accessUniqueWhere(coworkerId: string, workspaceId: string) {
  return {
    coworkerId_workspaceId: {
      coworkerId,
      workspaceId,
    },
  } as const;
}

function toIsoDateTime(value: Date): string {
  return value.toISOString();
}

async function lockCoworkerWorkspaceAccessById(
  accessId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "coworker_workspace_access" WHERE "id" = ${accessId}::uuid FOR UPDATE
  `;
}

export function isCoworkerAccessTerminal(
  status: CoworkerWorkspaceAccessStatus,
): boolean {
  return (
    status === CoworkerWorkspaceAccessStatus.DENIED ||
    status === CoworkerWorkspaceAccessStatus.REVOKED
  );
}

export function toCoworkerWorkspaceAccessApiShape(
  row: CoworkerWorkspaceAccessWithCoworker,
): CoworkerWorkspaceAccessDto {
  return {
    id: row.id,
    coworkerId: row.coworkerId,
    coworkerName: row.coworker.name,
    coworkerSlug: row.coworker.slug,
    workspaceId: row.workspaceId,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    resolvedAt: row.resolvedAt ? toIsoDateTime(row.resolvedAt) : null,
    resolvedById: row.resolvedById,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

/**
 * Personal workspace: actor is the workspace user. Org workspace: any active
 * organization membership for workspace.organizationId.
 */
export async function userBelongsToWorkspace(
  userId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true, organizationId: true },
  });

  if (!workspace) {
    return false;
  }

  if (workspace.userId === userId) {
    return true;
  }

  if (!workspace.organizationId) {
    return false;
  }

  const membership = await tx.member.findFirst({
    where: {
      organizationId: workspace.organizationId,
      userId,
    },
    select: { id: true },
  });

  return membership != null;
}

async function findAccessByPair(
  coworkerId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient,
): Promise<CoworkerWorkspaceAccessWithCoworker | null> {
  return tx.coworkerWorkspaceAccess.findUnique({
    where: accessUniqueWhere(coworkerId, workspaceId),
    include: coworkerWorkspaceAccessInclude,
  });
}

async function upsertGrantedAccess(
  params: {
    coworkerId: string;
    workspaceId: string;
    actorUserId: string;
  },
  tx: Prisma.TransactionClient,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  const now = new Date();
  return tx.coworkerWorkspaceAccess.upsert({
    where: accessUniqueWhere(params.coworkerId, params.workspaceId),
    create: {
      coworkerId: params.coworkerId,
      workspaceId: params.workspaceId,
      status: CoworkerWorkspaceAccessStatus.GRANTED,
      requestedByUserId: params.actorUserId,
      resolvedAt: now,
      resolvedById: params.actorUserId,
    },
    update: {
      status: CoworkerWorkspaceAccessStatus.GRANTED,
      requestedByUserId: params.actorUserId,
      resolvedAt: now,
      resolvedById: params.actorUserId,
    },
    include: coworkerWorkspaceAccessInclude,
  });
}

/**
 * Propose or directly grant coworker workspace access based on actor role.
 *
 * Status resolution:
 * 1. Workspace missing → notFound
 * 2. Coworker missing/archived → notFound
 * 3. Platform admin → GRANTED (reopen terminal allowed)
 * 4. Else require vendor admin on coworker.vendorId
 * 5. Actor belongs to workspace → GRANTED (reopen terminal allowed; check before terminal block)
 * 6. Else terminal existing → badRequest (foreign propose only)
 * 7. Else PENDING (idempotent for existing PENDING/GRANTED)
 */
export async function upsertCoworkerWorkspaceAccess(
  params: UpsertCoworkerWorkspaceAccessParams,
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  const workspace = await tx.workspace.findUnique({
    where: { id: params.workspaceId },
    select: { id: true, userId: true, organizationId: true },
  });

  if (!workspace) {
    throw notFound("Workspace not found");
  }

  const coworker = await tx.coworker.findFirst({
    where: {
      id: params.coworkerId,
      archivedAt: null,
    },
    select: { id: true, vendorId: true },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }

  const existing = await findAccessByPair(
    params.coworkerId,
    params.workspaceId,
    tx,
  );

  if (params.isPlatformAdmin) {
    if (existing?.status === CoworkerWorkspaceAccessStatus.GRANTED) {
      return existing;
    }

    return upsertGrantedAccess(
      {
        coworkerId: params.coworkerId,
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
      },
      tx,
    );
  }

  await requireVendorAdminMembership(params.actorUserId, coworker.vendorId);

  const belongs = await userBelongsToWorkspace(
    params.actorUserId,
    params.workspaceId,
    tx,
  );

  if (belongs) {
    if (existing?.status === CoworkerWorkspaceAccessStatus.GRANTED) {
      return existing;
    }

    return upsertGrantedAccess(
      {
        coworkerId: params.coworkerId,
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
      },
      tx,
    );
  }

  if (existing) {
    if (isCoworkerAccessTerminal(existing.status)) {
      throw badRequest("Cannot re-request after deny/revoke");
    }

    // PENDING or GRANTED — idempotent return
    return existing;
  }

  let access: CoworkerWorkspaceAccessWithCoworker;
  try {
    access = await tx.coworkerWorkspaceAccess.create({
      data: {
        coworkerId: params.coworkerId,
        workspaceId: params.workspaceId,
        status: CoworkerWorkspaceAccessStatus.PENDING,
        requestedByUserId: params.actorUserId,
        resolvedAt: null,
        resolvedById: null,
      },
      include: coworkerWorkspaceAccessInclude,
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }

    const raced = await findAccessByPair(
      params.coworkerId,
      params.workspaceId,
      tx,
    );

    if (!raced) {
      throw error;
    }

    if (isCoworkerAccessTerminal(raced.status)) {
      throw badRequest("Cannot re-request after deny/revoke");
    }

    // Concurrent create won — idempotent return without re-notify
    return raced;
  }

  try {
    await notifyWorkspaceApproversOfPendingCoworkerAccess(
      {
        coworkerId: params.coworkerId,
        workspaceId: params.workspaceId,
        accessId: access.id,
      },
      tx,
    );
  } catch (error) {
    console.error(
      "Failed to notify workspace approvers of pending coworker access:",
      error,
    );
  }

  return access;
}

export async function notifyWorkspaceApproversOfPendingCoworkerAccess(
  params: {
    coworkerId: string;
    workspaceId: string;
    accessId: string;
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

  const coworker = await tx.coworker.findUnique({
    where: { id: params.coworkerId },
    select: { name: true, slug: true },
  });

  for (const userId of recipientUserIds) {
    await createNotification(
      {
        userId,
        kind: NotificationKind.SYSTEM,
        referenceId: params.accessId,
        eventId: params.accessId,
        messageKey: "notifications.coworkerAccess.pending",
        messageParams: {
          coworkerName: coworker?.name ?? params.coworkerId,
          coworkerSlug: coworker?.slug ?? null,
          workspaceId: params.workspaceId,
          organizationId: workspace.organizationId,
        },
        metadata: {
          coworkerId: params.coworkerId,
          workspaceId: params.workspaceId,
          organizationId: workspace.organizationId,
        },
      },
      tx,
    );
  }
}

interface TransitionCoworkerWorkspaceAccessParams {
  accessId: string;
  workspaceId: string;
  resolvedById: string;
  from: CoworkerWorkspaceAccessStatus;
  to: CoworkerWorkspaceAccessStatus;
  wrongStatusMessage: string;
}

async function transitionCoworkerWorkspaceAccess(
  params: TransitionCoworkerWorkspaceAccessParams,
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  await lockCoworkerWorkspaceAccessById(params.accessId, tx);

  const existing = await tx.coworkerWorkspaceAccess.findFirst({
    where: { id: params.accessId, workspaceId: params.workspaceId },
  });

  if (!existing) {
    throw notFound("Coworker workspace access not found");
  }

  if (existing.status !== params.from) {
    throw badRequest(params.wrongStatusMessage);
  }

  return tx.coworkerWorkspaceAccess.update({
    where: { id: params.accessId },
    data: {
      status: params.to,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
    },
    include: coworkerWorkspaceAccessInclude,
  });
}

export async function approveCoworkerWorkspaceAccess(
  params: {
    accessId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  return transitionCoworkerWorkspaceAccess(
    {
      ...params,
      from: CoworkerWorkspaceAccessStatus.PENDING,
      to: CoworkerWorkspaceAccessStatus.GRANTED,
      wrongStatusMessage:
        "Only PENDING coworker workspace access can be approved",
    },
    tx,
  );
}

export async function denyCoworkerWorkspaceAccess(
  params: {
    accessId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  return transitionCoworkerWorkspaceAccess(
    {
      ...params,
      from: CoworkerWorkspaceAccessStatus.PENDING,
      to: CoworkerWorkspaceAccessStatus.DENIED,
      wrongStatusMessage:
        "Only PENDING coworker workspace access can be denied",
    },
    tx,
  );
}

export async function revokeCoworkerWorkspaceAccess(
  params: {
    accessId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  return transitionCoworkerWorkspaceAccess(
    {
      ...params,
      from: CoworkerWorkspaceAccessStatus.GRANTED,
      to: CoworkerWorkspaceAccessStatus.REVOKED,
      wrongStatusMessage:
        "Only GRANTED coworker workspace access can be revoked",
    },
    tx,
  );
}

export async function listCoworkerAccessForWorkspace(
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker[]> {
  return tx.coworkerWorkspaceAccess.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: coworkerWorkspaceAccessInclude,
  });
}

/**
 * Platform admin only: force-revoke GRANTED access by (coworker, workspace).
 * Ops can undo a bad pilot grant without requiring the workspace owner.
 */
export async function forceRevokeCoworkerWorkspaceAccessByPair(
  params: {
    coworkerId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<CoworkerWorkspaceAccessWithCoworker> {
  const existing = await findAccessByPair(
    params.coworkerId,
    params.workspaceId,
    tx,
  );

  if (!existing) {
    throw notFound("Coworker workspace access not found");
  }

  await lockCoworkerWorkspaceAccessById(existing.id, tx);

  const locked = await tx.coworkerWorkspaceAccess.findUnique({
    where: { id: existing.id },
    include: coworkerWorkspaceAccessInclude,
  });

  if (!locked) {
    throw notFound("Coworker workspace access not found");
  }

  if (locked.status !== CoworkerWorkspaceAccessStatus.GRANTED) {
    throw badRequest("Only GRANTED coworker workspace access can be revoked");
  }

  return tx.coworkerWorkspaceAccess.update({
    where: { id: locked.id },
    data: {
      status: CoworkerWorkspaceAccessStatus.REVOKED,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
    },
    include: coworkerWorkspaceAccessInclude,
  });
}
