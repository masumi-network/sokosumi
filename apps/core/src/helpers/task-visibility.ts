import { type Prisma, TaskStatus, TaskVisibility } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

export type SokoBotPacketAudience = "OWNER" | "TEAMMATE" | "ASSISTANT";

/**
 * Human reader for a private Task or Task Schedule is its owner (the member
 * under whose user context it was created). Creator FKs can be re-pointed on
 * user deletion; ownerId is the durable private-reader identity (SOK-1046).
 */
export function buildHumanTaskVisibilityWhere(
  userId: string,
): Prisma.TaskWhereInput & Prisma.TaskScheduleWhereInput {
  return {
    OR: [
      { visibility: TaskVisibility.PUBLIC },
      { visibility: TaskVisibility.PRIVATE, ownerId: userId },
    ],
  };
}

/**
 * Nested Task relation filter for Job (and similar) human lists.
 */
export function buildHumanParentTaskVisibilityWhere(
  userId: string,
): Prisma.TaskWhereInput {
  return buildHumanTaskVisibilityWhere(userId);
}

/**
 * Jobs with no parent Task stay visible. Jobs under a Task follow the human
 * reader rule so a private parent cannot leak through the Job list.
 */
export function buildHumanJobParentVisibilityWhere(
  userId: string,
): Prisma.JobWhereInput {
  return {
    OR: [
      { taskId: null },
      { task: { is: buildHumanParentTaskVisibilityWhere(userId) } },
    ],
  };
}

/**
 * The columns that decide who is responsible for work. A row loaded without
 * a relation filter carries them all; no include is needed.
 */
export interface ResponsibleUserColumns {
  /** Set only for private work (ADR 0056). */
  ownerId?: string | null;
  creatorUserId?: string | null;
  /** A Coworker or Soko Bot Creator is never responsible. */
  creatorCoworkerId?: string | null;
  creatorSokoBotId?: string | null;
  requestedByUserId?: string | null;
}

/**
 * Who is responsible for a Task, Task Schedule or Job (ADR 0056): the Owner,
 * else the person Creator, else the Requester, else nobody. Worked out, never
 * stored. Work a Soko Bot started on its own, or work whose person Creator
 * deleted their account, has nobody.
 */
export function resolveResponsibleUserId(
  work: ResponsibleUserColumns,
): string | null {
  return work.ownerId ?? work.creatorUserId ?? work.requestedByUserId ?? null;
}

/**
 * Prisma filter for work `userId` is responsible for: the database twin of
 * `resolveResponsibleUserId`. Every "mine" filter, reach check and sweep that
 * selects work by its responsible person uses this, never `ownerId` directly.
 * While the Owner column is required, every row has an Owner, so the Owner is
 * the responsible person; the Creator and Requester branches join here once
 * the column becomes nullable.
 */
export function buildResponsibleUserWhere(
  userId: string,
): Prisma.TaskWhereInput &
  Prisma.TaskScheduleWhereInput &
  Prisma.JobWhereInput {
  return { ownerId: userId };
}

export function isPrivateTaskVisibleToHuman(
  task: Pick<
    { visibility: TaskVisibility; ownerId: string },
    "visibility" | "ownerId"
  >,
  userId: string,
): boolean {
  if (task.visibility !== TaskVisibility.PRIVATE) {
    return true;
  }
  return task.ownerId === userId;
}

/**
 * Soko Bot context / board loads: public Tasks, plus private Tasks owned by
 * this bot's human owner. Assigned-to-self private Tasks of other owners stay
 * out of the packet (vendor-family readers are coworkers, not other bots).
 */
export function buildSokoBotOwnerTaskVisibilityWhere(
  ownerUserId: string,
): Prisma.TaskWhereInput {
  return buildHumanTaskVisibilityWhere(ownerUserId);
}

export function readSokoBotPacketAudience(
  packet: unknown,
): SokoBotPacketAudience | undefined {
  if (!packet || typeof packet !== "object") {
    return undefined;
  }
  if (
    !("trigger" in packet) ||
    !packet.trigger ||
    typeof packet.trigger !== "object"
  ) {
    return undefined;
  }
  const trigger = packet.trigger;
  if (
    !("askedBy" in trigger) ||
    !trigger.askedBy ||
    typeof trigger.askedBy !== "object"
  ) {
    return undefined;
  }
  const askedBy = trigger.askedBy;
  if (!("kind" in askedBy)) {
    return undefined;
  }
  const kind = askedBy.kind;
  if (kind === "OWNER" || kind === "TEAMMATE" || kind === "ASSISTANT") {
    return kind;
  }
  return undefined;
}

/**
 * Owner turns keep the owner's private Tasks. Every other audience, including
 * a missing or unclassified packet audience, is public-only (fail closed).
 */
export function buildSokoBotAudienceTaskVisibilityWhere(
  ownerUserId: string,
  audience: SokoBotPacketAudience | undefined,
): Prisma.TaskWhereInput {
  if (audience === "OWNER") {
    return buildSokoBotOwnerTaskVisibilityWhere(ownerUserId);
  }
  return { visibility: TaskVisibility.PUBLIC };
}

export function buildSokoBotAudienceJobParentTaskWhere(
  ownerUserId: string,
  audience: SokoBotPacketAudience | undefined,
): Prisma.JobWhereInput {
  return {
    OR: [
      { taskId: null },
      {
        task: {
          is: buildSokoBotAudienceTaskVisibilityWhere(ownerUserId, audience),
        },
      },
    ],
  };
}

/**
 * Coworker list access: GRANTED must not open other members' private Tasks.
 * Baseline assignee / same-vendor sibling still applies to private Tasks.
 */
export function buildCoworkerPrivateTaskVisibilityWhere(params: {
  coworkerId: string;
  vendorId: string;
}): Prisma.TaskWhereInput & Prisma.TaskScheduleWhereInput {
  return {
    OR: [
      { visibility: TaskVisibility.PUBLIC },
      { visibility: TaskVisibility.PRIVATE, assigneeId: params.coworkerId },
      {
        visibility: TaskVisibility.PRIVATE,
        assigneeId: { not: params.coworkerId },
        assignee: { vendorId: params.vendorId },
      },
    ],
  };
}

export function isPrivateTaskVisibleToCoworker(
  task: {
    visibility: TaskVisibility;
    assigneeId: string | null;
    assignee?: { vendorId: string } | null;
  },
  params: { coworkerId: string; vendorId: string },
): boolean {
  if (task.visibility !== TaskVisibility.PRIVATE) {
    return true;
  }
  if (task.assigneeId === params.coworkerId) {
    return true;
  }
  if (task.assigneeId != null && task.assignee?.vendorId === params.vendorId) {
    return true;
  }
  return false;
}

/**
 * Coworker Job lists: Jobs on Tasks assigned to this coworker, plus Jobs on
 * private Tasks assigned to a same-vendor sibling (the vendor-family reader
 * set already used for Task detail).
 */
export function buildCoworkerJobParentTaskWhere(params: {
  coworkerId: string;
  vendorId: string;
}): Prisma.JobWhereInput {
  return {
    task: {
      is: {
        OR: [
          { assigneeId: params.coworkerId },
          {
            visibility: TaskVisibility.PRIVATE,
            assignee: { vendorId: params.vendorId },
          },
        ],
      },
    },
  };
}

export interface CoworkerTaskAccessSqlParams {
  coworkerId: string;
  vendorId: string;
  hasWorkspaceGrant: boolean;
}

function buildCoworkerVendorFamilySql(
  coworkerId: string,
  vendorId: string,
): PrismaRaw.Sql {
  return PrismaRaw.sql`
    (
      t."assigneeId" = ${coworkerId}
      OR (
        t."assigneeId" IS DISTINCT FROM ${coworkerId}
        AND EXISTS (
          SELECT 1
          FROM coworker c
          WHERE c.id = t."assigneeId"
            AND c."vendorId" = ${vendorId}::uuid
        )
      )
    )
  `;
}

export function buildCoworkerTaskAccessSql(
  params: CoworkerTaskAccessSqlParams,
): PrismaRaw.Sql {
  const vendorFamily = buildCoworkerVendorFamilySql(
    params.coworkerId,
    params.vendorId,
  );

  if (params.hasWorkspaceGrant) {
    // GRANTED opens public non-draft Tasks, but private stays on vendor family.
    return PrismaRaw.sql`
      AND t.status != ${TaskStatus.DRAFT}::"TaskStatus"
      AND (
        t.visibility = ${TaskVisibility.PUBLIC}::"TaskVisibility"
        OR (
          t.visibility = ${TaskVisibility.PRIVATE}::"TaskVisibility"
          AND ${vendorFamily}
        )
      )
    `;
  }

  return PrismaRaw.sql`
    AND t.status != ${TaskStatus.DRAFT}::"TaskStatus"
    AND ${vendorFamily}
  `;
}

export function buildHumanTaskVisibilitySql(userId: string): PrismaRaw.Sql {
  return PrismaRaw.sql`
    AND (
      t.visibility = ${TaskVisibility.PUBLIC}::"TaskVisibility"
      OR (
        t.visibility = ${TaskVisibility.PRIVATE}::"TaskVisibility"
        AND t."ownerId" = ${userId}
      )
    )
  `;
}
