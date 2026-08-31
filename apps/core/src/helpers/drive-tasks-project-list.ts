import { TaskFileOrigin, TaskFileStatus, TaskStatus } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

import prisma from "@/lib/db/prisma";
import type { DriveListSort } from "@/schemas/drive-list-sort.schema";

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
  sort?: DriveListSort | null;
}): Promise<FetchProjectTasksPageResult> {
  const takePlusOne = params.take + 1;
  const filters = buildProjectTaskFilters(params);
  const sort = params.sort ?? null;
  // type falls back to name at task level
  const sortKey = !sort || sort.sortBy === "date" ? "date" : "name";
  const sortOrder = sort?.sortOrder ?? "desc";

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

    if (sortKey === "name") {
      const cursorNameRows = await prisma.$queryRaw<Array<{ name: string }>>`
        SELECT t.name
        ${filters.baseWhere}
          AND t.id = ${params.cursor}
        LIMIT 1
      `;
      const cursorName = cursorNameRows[0]?.name;
      if (!cursorName) {
        return { ok: false, reason: "invalid_cursor" };
      }

      cursorFilter =
        sortOrder === "desc"
          ? PrismaRaw.sql`
              AND (
                t.name < ${cursorName}
                OR (
                  t.name = ${cursorName}
                  AND t.id < ${cursorSortKey.id}
                )
              )
            `
          : PrismaRaw.sql`
              AND (
                t.name > ${cursorName}
                OR (
                  t.name = ${cursorName}
                  AND t.id > ${cursorSortKey.id}
                )
              )
            `;
    } else {
      cursorFilter =
        sortOrder === "desc"
          ? PrismaRaw.sql`
              AND (
                lf."latestFileUpdatedAt" < ${cursorSortKey.latestFileUpdatedAt}
                OR (
                  lf."latestFileUpdatedAt" = ${cursorSortKey.latestFileUpdatedAt}
                  AND t.id < ${cursorSortKey.id}
                )
              )
            `
          : PrismaRaw.sql`
              AND (
                lf."latestFileUpdatedAt" > ${cursorSortKey.latestFileUpdatedAt}
                OR (
                  lf."latestFileUpdatedAt" = ${cursorSortKey.latestFileUpdatedAt}
                  AND t.id > ${cursorSortKey.id}
                )
              )
            `;
    }
  }

  const orderBySql =
    sortKey === "name"
      ? sortOrder === "desc"
        ? PrismaRaw.sql`ORDER BY t.name DESC, t.id DESC`
        : PrismaRaw.sql`ORDER BY t.name ASC, t.id ASC`
      : sortOrder === "desc"
        ? PrismaRaw.sql`ORDER BY lf."latestFileUpdatedAt" DESC, t.id DESC`
        : PrismaRaw.sql`ORDER BY lf."latestFileUpdatedAt" ASC, t.id ASC`;

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
      ${orderBySql}
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
