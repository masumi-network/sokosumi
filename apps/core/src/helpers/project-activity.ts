import { z } from "@hono/zod-openapi";
import { PrismaRaw } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { badRequest } from "@/helpers/error";
import { escapeLikeText } from "@/helpers/query-params";

const projectActivityCursorSchema = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  lastActivityAt: z.iso.datetime(),
  matchRank: z.number().int().min(0).max(1).optional(),
  // Absent on cursors minted before Pins could lead the order.
  starredAt: z.iso.datetime().nullable().optional(),
});

export interface ProjectActivityRow {
  id: string;
  lastActivityAt: Date;
  matchRank?: number;
  /** The reader's Pin when the page leads with Pins, otherwise null. */
  starredAt?: Date | null;
}

/**
 * `open` covers closing and close-failed projects: only `closedAt` is
 * terminal. `hidden` is the reader's own Hidden projects that are still open
 * (ADR 0036); a project both Closed and Hidden lists under `closed`.
 */
export const PROJECT_LIST_STATES = ["open", "hidden", "closed"] as const;
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
      matchRank: row.matchRank,
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
  /** The reader whose Hides split `open` from `hidden`; null hides nothing. */
  readerUserId?: string | null;
  /** The reader whose Pins lead the page; omitted keeps pure activity order. */
  pinnedFirstUserId?: string | null;
}

/**
 * ILIKE treats `%` and `_` as wildcards, so a name search for "50%" would
 * otherwise match everything after "50". Escaping them (and the escape
 * character itself) keeps the query a literal substring match.
 */
export function literalSubstringPattern(search: string): string {
  return `%${escapeLikeText(search)}%`;
}

function primaryProjectMatch(pattern: string) {
  return PrismaRaw.sql`(p.name ILIKE ${pattern} ESCAPE '\\'
    OR p.identifier ILIKE ${pattern} ESCAPE '\\')`;
}

function projectSearchClause(search: string) {
  const pattern = literalSubstringPattern(search);
  return PrismaRaw.sql`AND (${primaryProjectMatch(pattern)}
    OR p.briefing ILIKE ${pattern} ESCAPE '\\'
    OR p."websiteUrl" ILIKE ${pattern} ESCAPE '\\')`;
}

/** The reader's Hide on project `p`, for `EXISTS` / `NOT EXISTS`. */
function readerHideClause(readerUserId: string) {
  return PrismaRaw.sql`(SELECT 1 FROM ${sharedTable("project_hide")} h WHERE h."projectId" = p.id AND h."userId" = ${readerUserId})`;
}

/**
 * Hides belong to a person, so without a reader (a coworker or vendor
 * context) nothing is Hidden: `open` is every open project, `hidden` is empty.
 */
function projectStateClause(
  state: ProjectListState | undefined,
  readerUserId: string | null,
) {
  if (state === "open") {
    return readerUserId
      ? PrismaRaw.sql`AND p."closedAt" IS NULL AND NOT EXISTS ${readerHideClause(readerUserId)}`
      : PrismaRaw.sql`AND p."closedAt" IS NULL`;
  }
  if (state === "hidden") {
    return readerUserId
      ? PrismaRaw.sql`AND p."closedAt" IS NULL AND EXISTS ${readerHideClause(readerUserId)}`
      : PrismaRaw.sql`AND FALSE`;
  }
  if (state === "closed") return PrismaRaw.sql`AND p."closedAt" IS NOT NULL`;
  return PrismaRaw.empty;
}

interface ProjectListFilter {
  search?: string;
  state?: ProjectListState;
  readerUserId?: string | null;
}

/**
 * The ranked page query's `WHERE`, shared with the count so `pagination.total`
 * cannot drift from the pages: the name search and the open/hidden/closed split.
 */
function projectListFilterClause({
  search,
  state,
  readerUserId = null,
}: ProjectListFilter) {
  return PrismaRaw.sql`${search ? projectSearchClause(search) : PrismaRaw.empty}
      ${projectStateClause(state, readerUserId)}`;
}

/** Same predicate as the ranked page query, so pagination.total cannot drift. */
export function projectCountQuery(
  workspaceId: string,
  filter: ProjectListFilter = {},
) {
  return PrismaRaw.sql`
    SELECT COUNT(*)::bigint AS count
    FROM ${sharedTable("project")} p
    WHERE p."workspaceId" = ${workspaceId}::uuid
      ${projectListFilterClause(filter)}
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
  readerUserId,
  pinnedFirstUserId,
}: ProjectActivityPageParams) {
  const boundary = cursor
    ? decodeProjectActivityCursor(cursor, workspaceId)
    : undefined;
  const matchRank = search
    ? PrismaRaw.sql`CASE WHEN ${primaryProjectMatch(literalSubstringPattern(search))} THEN 0 ELSE 1 END`
    : PrismaRaw.sql`0`;
  return PrismaRaw.sql`
    WITH activity AS (
      SELECT t."projectId", GREATEST(t."createdAt",
        (SELECT MAX(e."createdAt") FROM ${sharedTable("taskEvent")} e WHERE e."taskId" = t.id),
        (SELECT MAX(f."updatedAt") FROM ${sharedTable("task_file")} f
         WHERE f."taskId" = t.id AND f.status = 'READY' AND f.origin = 'TASK_OUTPUT' AND f."fileUrl" IS NOT NULL)
      ) AS at
      FROM ${sharedTable("task")} t
      WHERE t."workspaceId" = ${workspaceId}::uuid AND t."projectId" IS NOT NULL
        AND t."archivedAt" IS NULL ${visibility.task}
      UNION ALL
      SELECT j."projectId", GREATEST(j."createdAt",
        (SELECT MAX(e."createdAt") FROM ${netTable("mainnet", "jobEvent")} e WHERE e."jobId" = j.id)) AS at
      FROM ${netTable("mainnet", "Job")} j LEFT JOIN ${sharedTable("task")} t ON t.id = j."taskId"
      WHERE j."workspaceId" = ${workspaceId}::uuid AND j."projectId" IS NOT NULL
        AND (j."taskId" IS NULL OR (t."workspaceId" = ${workspaceId}::uuid AND t."archivedAt" IS NULL))
        ${visibility.job}
      UNION ALL
      SELECT e."projectId", e."createdAt" AS at
      FROM ${sharedTable("project_event")} e JOIN ${sharedTable("project")} p ON p.id = e."projectId"
      WHERE p."workspaceId" = ${workspaceId}::uuid
    ), ranked AS (
      SELECT p.id, ${matchRank} AS "matchRank", GREATEST(p."createdAt", MAX(a.at)) AS "lastActivityAt",
        ${
          pinnedFirstUserId
            ? PrismaRaw.sql`MAX(s."starredAt")`
            : PrismaRaw.sql`NULL::timestamp`
        } AS "starredAt"
      FROM ${sharedTable("project")} p LEFT JOIN activity a ON a."projectId" = p.id
      ${
        pinnedFirstUserId
          ? PrismaRaw.sql`LEFT JOIN ${sharedTable("project_star")} s ON s."projectId" = p.id AND s."userId" = ${pinnedFirstUserId}`
          : PrismaRaw.empty
      }
      WHERE p."workspaceId" = ${workspaceId}::uuid
      ${projectListFilterClause({ search, state, readerUserId })}
      GROUP BY p.id, p."createdAt"
    )
    SELECT r.id, r."lastActivityAt", r."starredAt", r."matchRank" FROM ranked r
    ${
      boundary
        ? PrismaRaw.sql`WHERE r."matchRank" > ${boundary.matchRank ?? 0}
      OR (r."matchRank" = ${boundary.matchRank ?? 0} AND (${projectActivityBoundaryClause(boundary)}))`
        : PrismaRaw.empty
    }
    ORDER BY r."matchRank", r."starredAt" ASC NULLS LAST, r."lastActivityAt" DESC, r.id DESC
    LIMIT ${take}
  `;
}

/** Rows after the boundary in `starredAt ASC NULLS LAST, lastActivityAt DESC, id DESC`. */
function projectActivityBoundaryClause(
  boundary: z.infer<typeof projectActivityCursorSchema>,
) {
  const afterActivity = PrismaRaw.sql`(r."lastActivityAt", r.id) < (${boundary.lastActivityAt}::timestamp, ${boundary.id}::uuid)`;
  if (!boundary.starredAt) {
    return PrismaRaw.sql`r."starredAt" IS NULL AND ${afterActivity}`;
  }
  return PrismaRaw.sql`r."starredAt" IS NULL
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
  /** Task or job event status; a project row's event kind. */
  status: string | null;
  agentId: string | null;
}

/**
 * The newest event per task, job and project across the workspace's open
 * projects, minus the reader's Hidden ones (ADR 0036), newest first: the same sources `projectActivityPageQuery` ranks
 * projects by, minus ready task outputs, which land with the task's own event.
 * One row per task or job, so a job that polls ten statuses is one row.
 * With `projectId`, the same rows for that one project.
 *
 * shortcut: DISTINCT ON scans every visible task and job event in the
 * workspace, like the ranked projects page does; add an events-by-workspace
 * index if this shows up in query times.
 */
export function projectRecentActivityQuery({
  workspaceId,
  take,
  visibility,
  readerUserId,
  projectId,
}: {
  workspaceId: string;
  take: number;
  visibility: { task: PrismaRaw.Sql; job: PrismaRaw.Sql };
  /** The reader whose Hidden projects drop out; null drops none. */
  readerUserId: string | null;
  /**
   * One project's events, whether open, Closed or Hidden: the reader opened
   * it, so its history stays readable.
   */
  projectId?: string;
}) {
  const projectFilter = projectId
    ? PrismaRaw.sql`AND p.id = ${projectId}::uuid`
    : readerUserId
      ? PrismaRaw.sql`AND p."closedAt" IS NULL AND NOT EXISTS ${readerHideClause(readerUserId)}`
      : PrismaRaw.sql`AND p."closedAt" IS NULL`;
  return PrismaRaw.sql`
    SELECT * FROM (
      (SELECT DISTINCT ON (t.id) 'task' AS kind, e.id::text AS id, e."createdAt" AS at,
        t."projectId"::text AS "projectId", t.id AS "entityId", t.name AS title,
        e.status::text AS status, NULL::text AS "agentId"
      FROM ${sharedTable("taskEvent")} e
      JOIN ${sharedTable("task")} t ON t.id = e."taskId"
      JOIN ${sharedTable("project")} p ON p.id = t."projectId" ${projectFilter}
      WHERE t."workspaceId" = ${workspaceId}::uuid AND t."archivedAt" IS NULL
        ${visibility.task}
      ORDER BY t.id, e."createdAt" DESC, e.id DESC)
      UNION ALL
      (SELECT DISTINCT ON (j.id) 'job', e.id::text, e."createdAt",
        j."projectId"::text, j.id, j.name, e.status::text, j."agentId"
      FROM ${netTable("mainnet", "jobEvent")} e
      JOIN ${netTable("mainnet", "Job")} j ON j.id = e."jobId"
      JOIN ${sharedTable("project")} p ON p.id = j."projectId" ${projectFilter}
      LEFT JOIN ${sharedTable("task")} t ON t.id = j."taskId"
      WHERE j."workspaceId" = ${workspaceId}::uuid
        AND (j."taskId" IS NULL OR (t."workspaceId" = ${workspaceId}::uuid AND t."archivedAt" IS NULL))
        ${visibility.job}
      ORDER BY j.id, e."createdAt" DESC, e.id DESC)
      UNION ALL
      (SELECT DISTINCT ON (p.id) 'project', e.id::text, e."createdAt",
        p.id::text, p.id::text, p.name, e.kind::text, NULL::text
      FROM ${sharedTable("project_event")} e
      JOIN ${sharedTable("project")} p ON p.id = e."projectId" ${projectFilter}
      WHERE p."workspaceId" = ${workspaceId}::uuid
      ORDER BY p.id, e."createdAt" DESC, e.id DESC)
    ) a
    ORDER BY a.at DESC, a.id DESC
    LIMIT ${take}
  `;
}
