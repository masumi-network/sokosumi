import {
  type CoworkerWorkspaceAccess,
  CoworkerWorkspaceAccessStatus,
  MemberRole,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";
import {
  CORE_API_ERROR_KINDS,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";
import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";
import { badRequest, notFound } from "@/helpers/error";
import {
  createNotification,
  deletePendingCoworkerAccessNotifications,
} from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";
import { recordChannelMembershipStatus } from "@/routes/v1/chats/rooms/membership-status";
import type {
  CoworkerWorkspaceAccessDto,
  CoworkerWorkspaceAccessTargetBody,
} from "@/schemas/coworker-workspace-access.schema";

type MembershipStatusMessage = Awaited<
  ReturnType<typeof recordChannelMembershipStatus>
>[number];

export interface RevokeCoworkerWorkspaceAccessResult {
  access: CoworkerWorkspaceAccessWithCoworker;
  /** Channel timeline rows; publish after the creating transaction commits. */
  membershipStatusMessages: MembershipStatusMessage[];
}

export const coworkerWorkspaceAccessInclude = {
  coworker: {
    select: {
      name: true,
      slug: true,
    },
  },
  workspace: {
    select: {
      id: true,
      userId: true,
      organizationId: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      organization: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.CoworkerWorkspaceAccessInclude;

export type CoworkerWorkspaceAccessWithCoworker = CoworkerWorkspaceAccess & {
  coworker: {
    name: string;
    slug: string;
  };
  workspace: {
    id: string;
    userId: string | null;
    organizationId: string | null;
    user: { name: string; email: string } | null;
    organization: { name: string; slug: string } | null;
  };
};

export function accessUniqueWhere(coworkerId: string, workspaceId: string) {
  return {
    coworkerId_workspaceId: {
      coworkerId,
      workspaceId,
    },
  } as const;
}

export interface ResolveCoworkerAccessTargetOptions {
  /**
   * When true (create/propose), a missing organization workspace is upserted.
   * A missing personal workspace always 404s — never created here.
   * When false (force-revoke), missing workspaces 404 — no side-effect create.
   */
  createIfMissing?: boolean;
}

/**
 * Resolve create/revoke target to a workspace id.
 * Email / organizationSlug are exact lookups only (no public directory).
 */
export async function resolveCoworkerAccessTargetWorkspaceId(
  target: CoworkerWorkspaceAccessTargetBody,
  options: ResolveCoworkerAccessTargetOptions = {},
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const createIfMissing = options.createIfMissing ?? true;

  if (target.workspaceId) {
    const workspace = await tx.workspace.findUnique({
      where: { id: target.workspaceId },
      select: { id: true },
    });
    if (!workspace) {
      throw notFound("Workspace not found");
    }
    return workspace.id;
  }

  if (target.userId || target.email) {
    const user = target.userId
      ? await tx.user.findUnique({
          where: { id: target.userId },
          select: { id: true },
        })
      : await tx.user.findFirst({
          where: {
            email: {
              equals: target.email?.trim() ?? "",
              mode: "insensitive",
            },
          },
          select: { id: true },
        });
    if (!user) {
      throw notFound("User not found");
    }
    const existing = await tx.workspace.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      throw notFound("Workspace not found", {
        kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
      });
    }
    return existing.id;
  }

  if (target.organizationId || target.organizationSlug) {
    const organization = target.organizationId
      ? await tx.organization.findUnique({
          where: { id: target.organizationId },
          select: { id: true },
        })
      : await tx.organization.findFirst({
          where: {
            slug: {
              equals: target.organizationSlug?.trim() ?? "",
              mode: "insensitive",
            },
          },
          select: { id: true },
        });
    if (!organization) {
      throw notFound("Organization not found");
    }
    if (createIfMissing) {
      // Org branch of resolve upserts the org workspace; userId is unused.
      const workspace = await workspaceRepository.resolveWorkspaceForContext(
        organization.id,
        organization.id,
        tx,
      );
      return workspace.id;
    }
    const existing = await tx.workspace.findUnique({
      where: { organizationId: organization.id },
      select: { id: true },
    });
    if (!existing) {
      throw notFound("Workspace not found");
    }
    return existing.id;
  }

  throw badRequest(
    "Provide exactly one of workspaceId, userId, organizationId, email, or organizationSlug",
  );
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

export interface CoworkerWorkspaceAccessApiShapeOptions {
  /**
   * When false, personal workspace rows omit the owner's email from
   * `workspaceDisplayDetail` (use user id instead). Vendor-admin coworker
   * listings must pass false; platform admin and workspace-owner lists keep
   * the default (true).
   */
  revealPersonalEmail?: boolean;
}

function workspaceDisplayFields(
  workspace: CoworkerWorkspaceAccessWithCoworker["workspace"],
  options: CoworkerWorkspaceAccessApiShapeOptions = {},
): Pick<
  CoworkerWorkspaceAccessDto,
  "workspaceKind" | "workspaceDisplayName" | "workspaceDisplayDetail"
> {
  const revealPersonalEmail = options.revealPersonalEmail !== false;

  if (workspace.organization) {
    return {
      workspaceKind: "organization",
      workspaceDisplayName: workspace.organization.name,
      workspaceDisplayDetail: workspace.organization.slug,
    };
  }

  if (workspace.user) {
    return {
      workspaceKind: "user",
      workspaceDisplayName: workspace.user.name,
      workspaceDisplayDetail: revealPersonalEmail
        ? workspace.user.email
        : (workspace.userId ?? workspace.id),
    };
  }

  // Degenerate row: prefer organizationId as kind when set.
  if (workspace.organizationId) {
    return {
      workspaceKind: "organization",
      workspaceDisplayName: workspace.id,
      workspaceDisplayDetail: workspace.organizationId,
    };
  }

  return {
    workspaceKind: "user",
    workspaceDisplayName: workspace.id,
    workspaceDisplayDetail: workspace.userId ?? workspace.id,
  };
}

export function toCoworkerWorkspaceAccessApiShape(
  row: CoworkerWorkspaceAccessWithCoworker,
  options: CoworkerWorkspaceAccessApiShapeOptions = {},
): CoworkerWorkspaceAccessDto {
  return {
    id: row.id,
    coworkerId: row.coworkerId,
    coworkerName: row.coworker.name,
    coworkerSlug: row.coworker.slug,
    workspaceId: row.workspaceId,
    ...workspaceDisplayFields(row.workspace, options),
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedById: row.resolvedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findAccessByPair(
  coworkerId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient,
): Promise<CoworkerWorkspaceAccessWithCoworker | null> {
  return tx.coworkerWorkspaceAccess.findUnique({
    where: accessUniqueWhere(coworkerId, workspaceId),
    include: coworkerWorkspaceAccessInclude,
  });
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
    select: {
      userId: true,
      organizationId: true,
      organization: { select: { slug: true } },
    },
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

  const organizationSlug = workspace.organization?.slug ?? null;

  for (const userId of recipientUserIds) {
    await createNotification(
      {
        userId,
        kind: NotificationKind.SYSTEM,
        referenceId: params.accessId,
        eventId: params.accessId,
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        workspaceId: params.workspaceId,
        messageParams: {
          coworkerName: coworker?.name ?? params.coworkerId,
          coworkerSlug: coworker?.slug ?? null,
          workspaceId: params.workspaceId,
          organizationId: workspace.organizationId,
          organizationSlug,
        },
        metadata: {
          coworkerId: params.coworkerId,
          workspaceId: params.workspaceId,
          organizationId: workspace.organizationId,
          // Web deep-links use slug; org pages resolve by slug only.
          organizationSlug,
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
  /** When true, drop pending request notifications after the status change. */
  clearPendingNotifications?: boolean;
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

  const updated = await tx.coworkerWorkspaceAccess.update({
    where: { id: params.accessId },
    data: {
      status: params.to,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
    },
    include: coworkerWorkspaceAccessInclude,
  });

  if (params.clearPendingNotifications) {
    await deletePendingCoworkerAccessNotifications(updated.id, tx);
  }

  return updated;
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
      clearPendingNotifications: true,
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
      clearPendingNotifications: true,
    },
    tx,
  );
}

/**
 * Rooms that belong to a workspace for chat roster cleanup.
 * Org workspace → org rooms. Personal → personal rooms where the workspace
 * owner is a user member (personal rooms are not multi-tenant).
 */
function chatRoomWhereForWorkspace(workspace: {
  userId: string | null;
  organizationId: string | null;
}): Prisma.ChatRoomWhereInput | null {
  if (workspace.organizationId) {
    return { organizationId: workspace.organizationId };
  }
  if (workspace.userId) {
    return {
      organizationId: null,
      userMembers: { some: { userId: workspace.userId } },
    };
  }
  return null;
}

/**
 * After revoke: drop coworker chat memberships in rooms scoped to the
 * workspace, fail open mentions, and record channel "left" timeline rows.
 * Skip when the coworker remains usable (e.g. still globally whitelisted).
 * Same transaction as the status flip (callers pass `tx`). Callers must
 * publish returned status messages after commit.
 */
async function detachCoworkerChatMembershipsForWorkspace(
  params: {
    coworkerId: string;
    coworkerName: string;
    workspaceId: string;
    workspace: {
      userId: string | null;
      organizationId: string | null;
    };
  },
  tx: Prisma.TransactionClient,
): Promise<MembershipStatusMessage[]> {
  const stillUsable = await tx.coworker.findFirst({
    where: {
      id: params.coworkerId,
      ...buildCoworkerUsableInWorkspaceWhere(params.workspaceId),
    },
    select: { id: true },
  });
  if (stillUsable) {
    return [];
  }

  const roomWhere = chatRoomWhereForWorkspace(params.workspace);
  if (!roomWhere) {
    return [];
  }

  const memberships = await tx.chatRoomCoworkerMember.findMany({
    where: {
      coworkerId: params.coworkerId,
      room: roomWhere,
    },
    select: {
      roomId: true,
      room: { select: { kind: true } },
    },
  });

  // Match room roster PATCH: fail pending/sent mentions before membership gone.
  await tx.chatRoomMention.updateMany({
    where: {
      coworkerId: params.coworkerId,
      status: { in: ["pending", "sent"] },
      message: { room: roomWhere },
    },
    data: {
      status: "failed",
      error: "Coworker is no longer a member of this room",
    },
  });

  await tx.chatRoomCoworkerMember.deleteMany({
    where: {
      coworkerId: params.coworkerId,
      room: roomWhere,
    },
  });

  // Channel-only status rows (same as room leave / roster PATCH). Skip directs
  // before calling the recorder (it no-ops non-channels). Publish after commit
  // so open clients drop the coworker from the live roster timeline.
  const coworkerDisplayName = params.coworkerName.trim() || params.coworkerId;
  const statusMessages: MembershipStatusMessage[] = [];
  for (const membership of memberships.filter(
    (entry) => entry.room.kind === "channel",
  )) {
    const created = await recordChannelMembershipStatus(tx, {
      roomId: membership.roomId,
      roomKind: membership.room.kind,
      changes: [
        {
          action: "left",
          subject: {
            type: "coworker",
            id: params.coworkerId,
            name: coworkerDisplayName,
          },
        },
      ],
    });
    statusMessages.push(...created);
  }
  return statusMessages;
}

export async function revokeCoworkerWorkspaceAccess(
  params: {
    accessId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<RevokeCoworkerWorkspaceAccessResult> {
  const updated = await transitionCoworkerWorkspaceAccess(
    {
      ...params,
      from: CoworkerWorkspaceAccessStatus.GRANTED,
      to: CoworkerWorkspaceAccessStatus.REVOKED,
      wrongStatusMessage:
        "Only GRANTED coworker workspace access can be revoked",
    },
    tx,
  );

  const membershipStatusMessages =
    await detachCoworkerChatMembershipsForWorkspace(
      {
        coworkerId: updated.coworkerId,
        coworkerName: updated.coworker.name,
        workspaceId: updated.workspaceId,
        workspace: updated.workspace,
      },
      tx,
    );

  return { access: updated, membershipStatusMessages };
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
 * Force-revoke GRANTED access by (coworker, workspace). Route restricts to
 * platform admin or vendor admin for the coworker. Ops can undo a bad pilot
 * grant without requiring the workspace owner.
 */
export async function forceRevokeCoworkerWorkspaceAccessByPair(
  params: {
    coworkerId: string;
    workspaceId: string;
    resolvedById: string;
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<RevokeCoworkerWorkspaceAccessResult> {
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

  const updated = await tx.coworkerWorkspaceAccess.update({
    where: { id: locked.id },
    data: {
      status: CoworkerWorkspaceAccessStatus.REVOKED,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
    },
    include: coworkerWorkspaceAccessInclude,
  });

  const membershipStatusMessages =
    await detachCoworkerChatMembershipsForWorkspace(
      {
        coworkerId: updated.coworkerId,
        coworkerName: updated.coworker.name,
        workspaceId: updated.workspaceId,
        workspace: updated.workspace,
      },
      tx,
    );

  return { access: updated, membershipStatusMessages };
}
