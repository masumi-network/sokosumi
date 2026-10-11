import {
  CoworkerWorkspaceAccessStatus,
  MemberRole,
  type Prisma,
} from "@sokosumi/database";
import { badRequest, notFound } from "@/helpers/error";
import { deletePendingCoworkerAccessNotifications } from "@/helpers/notifications";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import {
  accessUniqueWhere,
  type CoworkerWorkspaceAccessWithCoworker,
  coworkerWorkspaceAccessInclude,
  findAccessByPair,
  isCoworkerAccessTerminal,
} from "./coworker-workspace-access";

/** Personal owners and organization owners/admins can enable their own Vendor's Coworker. */
async function userCanGrantCoworkerWorkspaceAccess(
  userId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true, organizationId: true },
  });
  if (!workspace) return false;
  if (workspace.userId === userId) return true;
  if (!workspace.organizationId) return false;
  const membership = await tx.member.findFirst({
    where: { organizationId: workspace.organizationId, userId },
    select: { role: true },
  });
  return (
    membership?.role === MemberRole.OWNER ||
    membership?.role === MemberRole.ADMIN
  );
}

export interface UpsertCoworkerWorkspaceAccessParams {
  coworkerId: string;
  workspaceId: string;
  actorUserId: string;
  /** Platform admin (hasAdminRole) */
  isPlatformAdmin: boolean;
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
  const access = await tx.coworkerWorkspaceAccess.upsert({
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

  await deletePendingCoworkerAccessNotifications(access.id, tx);
  return access;
}

export interface PendingCoworkerAccessNotify {
  coworkerId: string;
  workspaceId: string;
  accessId: string;
}

export interface UpsertCoworkerWorkspaceAccessResult {
  access: CoworkerWorkspaceAccessWithCoworker;
  /**
   * Set only when this call created a new PENDING row. Callers should notify
   * after the surrounding transaction commits (do not notify on `tx`).
   */
  pendingNotify: PendingCoworkerAccessNotify | null;
}

function upsertResult(
  access: CoworkerWorkspaceAccessWithCoworker,
  pendingNotify: PendingCoworkerAccessNotify | null = null,
): UpsertCoworkerWorkspaceAccessResult {
  return { access, pendingNotify };
}

/**
 * Propose or directly grant coworker workspace access based on actor role.
 *
 * Status resolution:
 * 1. Workspace missing → notFound
 * 2. Coworker missing/archived → notFound
 * 3. Platform admin → GRANTED (reopen terminal allowed)
 * 4. Else require vendor admin on coworker.vendorId
 * 5. Personal owner or organization owner/admin → GRANTED (reopen terminal allowed; check before terminal block)
 * 6. Else terminal existing → badRequest (proposal only)
 * 7. Else PENDING (idempotent for existing PENDING/GRANTED)
 *
 * Does **not** send notifications. When `pendingNotify` is set, the caller
 * must invoke notifyWorkspaceApproversOfPendingCoworkerAccess after
 * the transaction commits.
 */
export async function upsertCoworkerWorkspaceAccess(
  params: UpsertCoworkerWorkspaceAccessParams,
  tx: Prisma.TransactionClient = prisma,
): Promise<UpsertCoworkerWorkspaceAccessResult> {
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
      await deletePendingCoworkerAccessNotifications(existing.id, tx);
      return upsertResult(existing);
    }

    return upsertResult(
      await upsertGrantedAccess(
        {
          coworkerId: params.coworkerId,
          workspaceId: params.workspaceId,
          actorUserId: params.actorUserId,
        },
        tx,
      ),
    );
  }

  await requireVendorAdminMembership(params.actorUserId, coworker.vendorId, tx);

  const canGrant = await userCanGrantCoworkerWorkspaceAccess(
    params.actorUserId,
    params.workspaceId,
    tx,
  );

  if (canGrant) {
    if (existing?.status === CoworkerWorkspaceAccessStatus.GRANTED) {
      await deletePendingCoworkerAccessNotifications(existing.id, tx);
      return upsertResult(existing);
    }

    return upsertResult(
      await upsertGrantedAccess(
        {
          coworkerId: params.coworkerId,
          workspaceId: params.workspaceId,
          actorUserId: params.actorUserId,
        },
        tx,
      ),
    );
  }

  if (existing) {
    if (isCoworkerAccessTerminal(existing.status)) {
      throw badRequest("Cannot re-request after deny/revoke");
    }

    // PENDING or GRANTED — idempotent return without re-notify
    return upsertResult(existing);
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
    return upsertResult(raced);
  }

  return upsertResult(access, {
    coworkerId: params.coworkerId,
    workspaceId: params.workspaceId,
    accessId: access.id,
  });
}
