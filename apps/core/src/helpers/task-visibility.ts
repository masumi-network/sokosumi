import { type Prisma, TaskStatus, TaskVisibility } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { internalServerError } from "@/helpers/error";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";

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

export function isPrivateTaskVisibleToHuman(
  task: { visibility: TaskVisibility; ownerId: string | null },
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
 * What a shared Soko Bot may read. Its workspace is always pinned: nothing in
 * the schema ties a bot's Project to the bot's workspace.
 */
export interface SokoBotScope {
  sokoBotId: string;
  workspaceId: string;
  /** Set for a project bot; null for a workspace bot. */
  projectId: string | null;
}

interface SokoBotScopeColumns {
  id: string;
  userId: string | null;
  workspaceId: string;
  projectId?: string | null;
}

function scopeColumnsOf(bot: SokoBotScopeColumns): SokoBotScope {
  // A row selected without the column must not widen a project bot to its
  // whole workspace.
  if (bot.projectId === undefined)
    throw internalServerError("A shared Soko Bot's scope needs its projectId");
  return {
    sokoBotId: bot.id,
    workspaceId: bot.workspaceId,
    projectId: bot.projectId,
  };
}

/** The scope of a shared bot, or null for a personal bot. */
export function sokoBotSharedScopeOf(
  bot: SokoBotScopeColumns,
): SokoBotScope | null {
  return isPersonalSokoBot(bot) ? null : scopeColumnsOf(bot);
}

/** What a bot sees on its own: a personal bot its owner's Tasks, a shared bot its scope. */
export function buildSokoBotTaskWhere(
  bot: SokoBotScopeColumns,
): Prisma.TaskWhereInput {
  return isPersonalSokoBot(bot)
    ? buildSokoBotOwnerTaskVisibilityWhere(bot.userId)
    : buildSokoBotScopeTaskWhere(scopeColumnsOf(bot));
}

/**
 * A shared bot sees PUBLIC Tasks only: a project bot those of its Project, a
 * workspace bot every one in its workspace. Never a member's private Task.
 */
export function buildSokoBotScopeTaskWhere(
  scope: SokoBotScope,
): Prisma.TaskWhereInput {
  return {
    workspaceId: scope.workspaceId,
    visibility: TaskVisibility.PUBLIC,
    ...(scope.projectId === null ? {} : { projectId: scope.projectId }),
  };
}

/** A shared bot's Jobs: its own hires, plus Jobs on a Task it can see. */
export function buildSokoBotScopeJobWhere(
  scope: SokoBotScope,
): Prisma.JobWhereInput {
  return {
    workspaceId: scope.workspaceId,
    OR: [
      {
        sokoBotDelegations: { some: { turn: { sokoBotId: scope.sokoBotId } } },
      },
      { task: { is: buildSokoBotScopeTaskWhere(scope) } },
    ],
  };
}

/**
 * Who reads through a Soko Bot turn: a personal bot's owner, or a shared
 * bot's scope. `userId` is the person the turn acts for; a shared bot acting
 * on its own has none (ADR 0057), and reads by scope either way.
 */
export type SokoBotTurnReader =
  | {
      userId: string;
      audience: SokoBotPacketAudience | undefined;
      sharedScope: null;
    }
  | {
      userId: string | null;
      audience: SokoBotPacketAudience | undefined;
      sharedScope: SokoBotScope;
    };

/**
 * The audience a shared bot answers. It has no owner, so it answers as
 * TEAMMATE unless another assistant asks: an OWNER, missing or malformed
 * audience never opens an owner path.
 */
export function sharedSokoBotAudience(
  audience: SokoBotPacketAudience | undefined,
): "TEAMMATE" | "ASSISTANT" {
  return audience === "ASSISTANT" ? "ASSISTANT" : "TEAMMATE";
}

/** A turn reader. A shared bot has no owner, so it never reads as OWNER. */
export function sokoBotTurnReader(
  userId: string | null,
  audience: SokoBotPacketAudience | undefined,
  sharedScope: SokoBotScope | null,
): SokoBotTurnReader {
  if (sharedScope !== null)
    return { userId, audience: sharedSokoBotAudience(audience), sharedScope };
  if (userId === null)
    throw new Error("A personal Soko Bot turn always acts for its owner");
  return { userId, audience, sharedScope };
}

/** A shared bot reads its scope; a personal bot reads by audience. */
export function buildSokoBotReaderTaskWhere(
  reader: SokoBotTurnReader,
): Prisma.TaskWhereInput {
  return reader.sharedScope
    ? buildSokoBotScopeTaskWhere(reader.sharedScope)
    : buildSokoBotAudienceTaskVisibilityWhere(reader.userId, reader.audience);
}

/** A shared bot reads its scope; a personal bot reads its owner's Jobs. */
export function buildSokoBotReaderJobWhere(
  reader: SokoBotTurnReader,
): Prisma.JobWhereInput {
  return reader.sharedScope
    ? buildSokoBotScopeJobWhere(reader.sharedScope)
    : {
        ownerId: reader.userId,
        ...buildSokoBotAudienceJobParentTaskWhere(
          reader.userId,
          reader.audience,
        ),
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
