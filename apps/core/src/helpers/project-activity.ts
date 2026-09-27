import { z } from "@hono/zod-openapi";
import { PrismaRaw } from "@sokosumi/database/client";
import { badRequest } from "@/helpers/error";
import type { AuthenticationContext } from "@/middleware/auth";
import { resolveProjectReaderAccess } from "@/types/project";

export async function projectActivityVisibility(
  auth: AuthenticationContext,
  workspaceId: string,
): Promise<{ task: PrismaRaw.Sql; job: PrismaRaw.Sql }> {
  const { sqlWhere } = await resolveProjectReaderAccess(auth, workspaceId);
  return sqlWhere;
}

const projectActivityCursorSchema = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  lastActivityAt: z.iso.datetime(),
});

export interface ProjectActivityRow {
  id: string;
  lastActivityAt: Date;
}

export function encodeProjectActivityCursor(
  workspaceId: string,
  row: ProjectActivityRow,
): string {
  return Buffer.from(
    JSON.stringify({
      workspaceId,
      id: row.id,
      lastActivityAt: row.lastActivityAt.toISOString(),
    }),
  ).toString("base64url");
}

function decodeProjectActivityCursor(cursor: string, workspaceId: string) {
  try {
    const boundary = projectActivityCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    if (boundary.workspaceId !== workspaceId)
      throw new Error("Wrong workspace");
    return boundary;
  } catch {
    throw badRequest("Invalid project pagination cursor");
  }
}

interface ProjectActivityPageParams {
  workspaceId: string;
  cursor?: string;
  take: number;
  visibility: { task: PrismaRaw.Sql; job: PrismaRaw.Sql };
  search?: string;
}

/**
 * ILIKE treats `%` and `_` as wildcards, so a name search for "50%" would
 * otherwise match everything after "50". Escaping them (and the escape
 * character itself) keeps the query a literal substring match.
 */
export function projectNameSearchPattern(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (match) => `\\${match}`);
  return `%${escaped}%`;
}

export function projectNameSearchClause(search: string) {
  return PrismaRaw.sql`AND p.name ILIKE ${projectNameSearchPattern(search)} ESCAPE '\\'`;
}

/** Same predicate as the ranked page query, so pagination.total cannot drift. */
export function projectNameCountQuery(workspaceId: string, search: string) {
  return PrismaRaw.sql`
    SELECT COUNT(*)::bigint AS count
    FROM project p
    WHERE p."workspaceId" = ${workspaceId}::uuid
      ${projectNameSearchClause(search)}
  `;
}

/** Global database ordering, before LIMIT. Metadata/report refreshes do not
 * count as activity. Creation is the floor; task/job events, ready task outputs,
 * and project lifecycle events advance it. Reader-invisible work cannot do so.
 * The cursor carries the immutable activity/ID boundary, scoped to the workspace.
 */
export function projectActivityPageQuery({
  workspaceId,
  cursor,
  take,
  visibility,
  search,
}: ProjectActivityPageParams) {
  const boundary = cursor
    ? decodeProjectActivityCursor(cursor, workspaceId)
    : undefined;
  return PrismaRaw.sql`
    WITH activity AS (
      SELECT t."projectId", GREATEST(t."createdAt",
        (SELECT MAX(e."createdAt") FROM "taskEvent" e WHERE e."taskId" = t.id),
        (SELECT MAX(f."updatedAt") FROM task_file f
         WHERE f."taskId" = t.id AND f.status = 'READY' AND f.origin = 'TASK_OUTPUT' AND f."fileUrl" IS NOT NULL)
      ) AS at
      FROM task t
      WHERE t."workspaceId" = ${workspaceId}::uuid AND t."projectId" IS NOT NULL
        AND t."archivedAt" IS NULL ${visibility.task}
      UNION ALL
      SELECT j."projectId", GREATEST(j."createdAt",
        (SELECT MAX(e."createdAt") FROM "jobEvent" e WHERE e."jobId" = j.id)) AS at
      FROM "Job" j LEFT JOIN task t ON t.id = j."taskId"
      WHERE j."workspaceId" = ${workspaceId}::uuid AND j."projectId" IS NOT NULL
        AND (j."taskId" IS NULL OR (t."workspaceId" = ${workspaceId}::uuid AND t."archivedAt" IS NULL))
        ${visibility.job}
      UNION ALL
      SELECT e."projectId", e."createdAt" AS at
      FROM project_event e JOIN project p ON p.id = e."projectId"
      WHERE p."workspaceId" = ${workspaceId}::uuid
    ), ranked AS (
      SELECT p.id, GREATEST(p."createdAt", MAX(a.at)) AS "lastActivityAt"
      FROM project p LEFT JOIN activity a ON a."projectId" = p.id
      WHERE p."workspaceId" = ${workspaceId}::uuid
      ${search ? projectNameSearchClause(search) : PrismaRaw.empty}
      GROUP BY p.id, p."createdAt"
    )
    SELECT r.id, r."lastActivityAt" FROM ranked r
    ${
      boundary
        ? PrismaRaw.sql`WHERE (r."lastActivityAt", r.id) < (${boundary.lastActivityAt}::timestamp, ${boundary.id}::uuid)`
        : PrismaRaw.empty
    }
    ORDER BY r."lastActivityAt" DESC, r.id DESC
    LIMIT ${take}
  `;
}
