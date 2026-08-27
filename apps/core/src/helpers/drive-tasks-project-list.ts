import { TaskFileOrigin, TaskFileStatus, TaskStatus } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

import prisma from "@/lib/db/prisma";

export interface DriveProjectTaskRow {
  id: string;
  name: string;
  latestFileUpdatedAt: Date;
}

interface CoworkerTaskAccessSqlParams {
  coworkerId: string;
  vendorId: string;
  hasWorkspaceGrant: boolean;
}

export type FetchProjectTasksPageResult =
  | {
      ok: true;
      rows: DriveProjectTaskRow[];
      totalCount: number;
    }
  | {
      ok: false;
      reason: "invalid_cursor";
    };

function buildCoworkerTaskAccessSql(
  params: CoworkerTaskAccessSqlParams,
): PrismaRaw.Sql {
  if (params.hasWorkspaceGrant) {
    return PrismaRaw.sql`AND t.status != ${TaskStatus.DRAFT}::"TaskStatus"`;
  }

  return PrismaRaw.sql`
    AND t.status != ${TaskStatus.DRAFT}::"TaskStatus"
    AND (
      t."assigneeId" = ${params.coworkerId}
      OR (
        t."assigneeId" IS DISTINCT FROM ${params.coworkerId}
        AND EXISTS (
          SELECT 1
          FROM coworker c
          WHERE c.id = t."assigneeId"
            AND c."vendorId" = ${params.vendorId}::uuid
        )
      )
    )
  `;
}

function buildProjectTaskFilters(params: {
  workspaceId: string;
  projectId: string | null;
  assigneeId?: string;
  coworkerAccess?: CoworkerTaskAccessSqlParams;
}): {
  assigneeFilter: PrismaRaw.Sql;
  projectFilter: PrismaRaw.Sql;
  coworkerFilter: PrismaRaw.Sql;
  baseWhere: PrismaRaw.Sql;
} {
  const assigneeFilter = params.assigneeId
    ? PrismaRaw.sql`AND t."assigneeId" = ${params.assigneeId}`
    : PrismaRaw.empty;
  const projectFilter =
    params.projectId === null
      ? PrismaRaw.sql`AND t."projectId" IS NULL`
      : PrismaRaw.sql`AND t."projectId" = ${params.projectId}::uuid`;
  const coworkerFilter = params.coworkerAccess
    ? buildCoworkerTaskAccessSql(params.coworkerAccess)
    : PrismaRaw.empty;

  const baseWhere = PrismaRaw.sql`
    FROM task t
    INNER JOIN (
      SELECT
        tf."taskId",
        MAX(tf."updatedAt") AS "latestFileUpdatedAt"
      FROM task_file tf
      WHERE tf.status = ${TaskFileStatus.READY}::"TaskFileStatus"
        AND tf.origin = ${TaskFileOrigin.TASK_OUTPUT}::"TaskFileOrigin"
        AND tf."fileUrl" IS NOT NULL
      GROUP BY tf."taskId"
    ) lf ON lf."taskId" = t.id
    WHERE t."archivedAt" IS NULL
      AND t."workspaceId" = ${params.workspaceId}::uuid
      ${projectFilter}
      ${assigneeFilter}
      ${coworkerFilter}
  `;

  return {
    assigneeFilter,
    projectFilter,
    coworkerFilter,
    baseWhere,
  };
}

async function resolveProjectTaskCursorSortKey(
  taskId: string,
  filters: ReturnType<typeof buildProjectTaskFilters> & {
    workspaceId: string;
    projectId: string | null;
    assigneeId?: string;
    coworkerAccess?: CoworkerTaskAccessSqlParams;
  },
): Promise<{ latestFileUpdatedAt: Date; id: string } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; latestFileUpdatedAt: Date }>
  >`
    SELECT
      t.id,
      lf."latestFileUpdatedAt"
    ${filters.baseWhere}
      AND t.id = ${taskId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    latestFileUpdatedAt: row.latestFileUpdatedAt,
  };
}

export async function fetchProjectTasksPage(params: {
  workspaceId: string;
  projectId: string | null;
  assigneeId?: string;
  coworkerAccess?: CoworkerTaskAccessSqlParams;
  cursor?: string;
  take: number;
}): Promise<FetchProjectTasksPageResult> {
  const takePlusOne = params.take + 1;
  const filters = buildProjectTaskFilters(params);

  let cursorFilter = PrismaRaw.empty;
  if (params.cursor) {
    const cursorSortKey = await resolveProjectTaskCursorSortKey(params.cursor, {
      ...filters,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      assigneeId: params.assigneeId,
      coworkerAccess: params.coworkerAccess,
    });
    if (!cursorSortKey) {
      return { ok: false, reason: "invalid_cursor" };
    }

    cursorFilter = PrismaRaw.sql`
      AND (
        lf."latestFileUpdatedAt" < ${cursorSortKey.latestFileUpdatedAt}
        OR (
          lf."latestFileUpdatedAt" = ${cursorSortKey.latestFileUpdatedAt}
          AND t.id < ${cursorSortKey.id}
        )
      )
    `;
  }

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ id: string; name: string; latestFileUpdatedAt: Date }>
    >`
      SELECT
        t.id,
        t.name,
        lf."latestFileUpdatedAt"
      ${filters.baseWhere}
      ${cursorFilter}
      ORDER BY lf."latestFileUpdatedAt" DESC, t.id DESC
      LIMIT ${takePlusOne}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      ${filters.baseWhere}
    `,
  ]);

  return {
    ok: true,
    rows,
    totalCount: Number(countRows[0]?.count ?? 0n),
  };
}
