import { z } from "@hono/zod-openapi";
import { PrismaRaw } from "@sokosumi/database/client";
import { badRequest } from "@/helpers/error";

const projectActivityCursorSchema = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  lastActivityAt: z.iso.datetime(),
  // Absent on cursors minted before Pins could lead the order.
  starredAt: z.iso.datetime().nullable().optional(),
});

export interface ProjectActivityRow {
  id: string;
  lastActivityAt: Date;
  /** The reader's Pin when the page leads with Pins, otherwise null. */
  starredAt?: Date | null;
}

/** `open` covers closing and close-failed projects: only `closedAt` is terminal. */
export const PROJECT_LIST_STATES = ["open", "closed"] as const;
export type ProjectListState = (typeof PROJECT_LIST_STATES)[number];

export function encodeProjectActivityCursor(
  workspaceId: string,
  row: ProjectActivityRow,
): string {
  return Buffer.from(
    JSON.stringify({
      workspaceId,
      id: row.id,
      lastActivityAt: row.lastActivityAt.toISOString(),
      starredAt: row.starredAt?.toISOString() ?? null,
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
  state?: ProjectListState;
  /** The reader whose Pins lead the page; omitted keeps pure activity order. */
  pinnedFirstUserId?: string | null;
}

/**
 * ILIKE treats `%` and `_` as wildcards, so a name search for "50%" would
 * otherwise match everything after "50". Escaping them (and the escape
 * character itself) keeps the query a literal substring match.
 */
export function literalSubstringPattern(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (match) => `\\${match}`);
  return `%${escaped}%`;
}

function projectNameSearchClause(search: string) {
  return PrismaRaw.sql`AND p.name ILIKE ${literalSubstringPattern(search)} ESCAPE '\\'`;
}

function projectStateClause(state?: ProjectListState) {
  if (state === "open") return PrismaRaw.sql`AND p."closedAt" IS NULL`;
  if (state === "closed") return PrismaRaw.sql`AND p."closedAt" IS NOT NULL`;
  return PrismaRaw.empty;
}

/**
 * The ranked page query's `WHERE`, shared with the count so `pagination.total`
 * cannot drift from the pages: the name search and the open/closed split.
 */
function projectListFilterClause(search?: string, state?: ProjectListState) {
  return PrismaRaw.sql`${search ? projectNameSearchClause(search) : PrismaRaw.empty}
      ${projectStateClause(state)}`;
}

/** Same predicate as the ranked page query, so pagination.total cannot drift. */
export function projectCountQuery(
  workspaceId: string,
  { search, state }: { search?: string; state?: ProjectListState } = {},
) {
  return PrismaRaw.sql`
    SELECT COUNT(*)::bigint AS count
    FROM project p
    WHERE p."workspaceId" = ${workspaceId}::uuid
      ${projectListFilterClause(search, state)}
  `;
}

/** Global database ordering, before LIMIT. Metadata/report refreshes do not
 * count as activity. Creation is the floor; task/job events, ready task outputs,
 * and project lifecycle events advance it. Reader-invisible work cannot do so.
 * The cursor carries the immutable activity/ID boundary, scoped to the workspace.
 * With `pinnedFirstUserId`, that reader's Pins lead by `starredAt` ascending and
 * the cursor carries the Pin too; without it every row's `starredAt` is NULL,
 * so the same ORDER BY and boundary collapse to plain activity order.
 */
export function projectActivityPageQuery({
  workspaceId,
  cursor,
  take,
  visibility,
  search,
  state,
  pinnedFirstUserId,
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
      SELECT p.id, GREATEST(p."createdAt", MAX(a.at)) AS "lastActivityAt",
        ${
          pinnedFirstUserId
            ? PrismaRaw.sql`MAX(s."starredAt")`
            : PrismaRaw.sql`NULL::timestamp`
        } AS "starredAt"
      FROM project p LEFT JOIN activity a ON a."projectId" = p.id
      ${
        pinnedFirstUserId
          ? PrismaRaw.sql`LEFT JOIN project_star s ON s."projectId" = p.id AND s."userId" = ${pinnedFirstUserId}`
          : PrismaRaw.empty
      }
      WHERE p."workspaceId" = ${workspaceId}::uuid
      ${projectListFilterClause(search, state)}
      GROUP BY p.id, p."createdAt"
    )
    SELECT r.id, r."lastActivityAt", r."starredAt" FROM ranked r
    ${boundary ? projectActivityBoundaryClause(boundary) : PrismaRaw.empty}
    ORDER BY r."starredAt" ASC NULLS LAST, r."lastActivityAt" DESC, r.id DESC
    LIMIT ${take}
  `;
}

/** Rows after the boundary in `starredAt ASC NULLS LAST, lastActivityAt DESC, id DESC`. */
function projectActivityBoundaryClause(
  boundary: z.infer<typeof projectActivityCursorSchema>,
) {
  const afterActivity = PrismaRaw.sql`(r."lastActivityAt", r.id) < (${boundary.lastActivityAt}::timestamp, ${boundary.id}::uuid)`;
  if (!boundary.starredAt) {
    return PrismaRaw.sql`WHERE r."starredAt" IS NULL AND ${afterActivity}`;
  }
  return PrismaRaw.sql`WHERE r."starredAt" IS NULL
    OR r."starredAt" > ${boundary.starredAt}::timestamp
    OR (r."starredAt" = ${boundary.starredAt}::timestamp AND ${afterActivity})`;
}

export interface ProjectRecentActivityRow {
  kind: "task" | "job" | "project";
  id: string;
  at: Date;
  projectId: string;
  entityId: string;
  title: string | null;
  status: string | null;
  agentId: string | null;
}

/**
 * The newest event per task, job and project across the workspace's open
 * projects, newest first: the same sources `projectActivityPageQuery` ranks
 * projects by, minus ready task outputs, which land with the task's own event.
 * One row per task or job, so a job that polls ten statuses is one row.
 *
 * shortcut: DISTINCT ON scans every visible task and job event in the
 * workspace, like the ranked projects page does; add an events-by-workspace
 * index if this shows up in query times.
 */
export function projectRecentActivityQuery({
  workspaceId,
  take,
  visibility,
}: {
  workspaceId: string;
  take: number;
  visibility: { task: PrismaRaw.Sql; job: PrismaRaw.Sql };
}) {
  return PrismaRaw.sql`
    SELECT * FROM (
      (SELECT DISTINCT ON (t.id) 'task' AS kind, e.id::text AS id, e."createdAt" AS at,
        t."projectId"::text AS "projectId", t.id AS "entityId", t.name AS title,
        e.status::text AS status, NULL::text AS "agentId"
      FROM "taskEvent" e
      JOIN task t ON t.id = e."taskId"
      JOIN project p ON p.id = t."projectId" AND p."closedAt" IS NULL
      WHERE t."workspaceId" = ${workspaceId}::uuid AND t."archivedAt" IS NULL
        ${visibility.task}
      ORDER BY t.id, e."createdAt" DESC, e.id DESC)
      UNION ALL
      (SELECT DISTINCT ON (j.id) 'job', e.id::text, e."createdAt",
        j."projectId"::text, j.id, j.name, e.status::text, j."agentId"
      FROM "jobEvent" e
      JOIN "Job" j ON j.id = e."jobId"
      JOIN project p ON p.id = j."projectId" AND p."closedAt" IS NULL
      LEFT JOIN task t ON t.id = j."taskId"
      WHERE j."workspaceId" = ${workspaceId}::uuid
        AND (j."taskId" IS NULL OR (t."workspaceId" = ${workspaceId}::uuid AND t."archivedAt" IS NULL))
        ${visibility.job}
      ORDER BY j.id, e."createdAt" DESC, e.id DESC)
      UNION ALL
      (SELECT DISTINCT ON (p.id) 'project', e.id::text, e."createdAt",
        p.id::text, p.id::text, p.name, e.kind::text, NULL::text
      FROM project_event e
      JOIN project p ON p.id = e."projectId" AND p."closedAt" IS NULL
      WHERE p."workspaceId" = ${workspaceId}::uuid
      ORDER BY p.id, e."createdAt" DESC, e.id DESC)
    ) a
    ORDER BY a.at DESC, a.id DESC
    LIMIT ${take}
  `;
}
