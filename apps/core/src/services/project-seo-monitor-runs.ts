import { PrismaRaw } from "@sokosumi/database/client";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { SEO_MONITOR_MARKER } from "@/lib/seo/monitor-plan";
import type { SeoActor } from "@/schemas/project-seo.schema";
import type {
  SeoMonitorChange,
  SeoMonitorLastRun,
} from "@/schemas/project-seo-monitor.schema";

import {
  compareSeoMonitorRuns,
  type SeoMonitorRunResult,
} from "./project-seo-monitor-change";
import { seoOwnerWhere } from "./project-seo-store";

/** Newest Tasks of a monitor searched for its two newest results. Older results do not feed the change. */
const SEO_MONITOR_RECENT_RUNS = 10;
/** Observation kinds that hold no check result. */
const NON_RESULT_KINDS = ["metrics", "page_change"];

export function lastRunStatus(
  taskStatus: string,
  analysisStatus: string | undefined,
): SeoMonitorLastRun["status"] {
  // Only the import moves the analysis past "requested": a Task that failed without a file must not read as waiting.
  if (analysisStatus === "completed" || analysisStatus === "failed")
    return analysisStatus;
  if (taskStatus === "FAILED" || taskStatus === "CANCELED") return "failed";
  if (
    analysisStatus === "requested" &&
    (taskStatus === "RUNNING" || taskStatus === "COMPLETED")
  )
    return "running";
  if (analysisStatus === "requested" || analysisStatus === "running")
    return analysisStatus;
  return taskStatus === "COMPLETED" ? "completed" : "running";
}

/**
 * Per group of Tasks (newest created first): the newest readable result of each of the two newest Tasks with a
 * result, newest Task first. A late result keeps its Run's place, and one Task with two imported files counts once,
 * so the workspace and the notification compare the same pair of Runs. All groups share one id read and one payload
 * read. The id read returns one row per Task, so one Task's many files never push out other Tasks' results.
 */
async function newestResultsOfTaskGroups(
  owner: Pick<SeoActor, "owner">,
  groups: string[][],
): Promise<SeoMonitorRunResult[][]> {
  const taskIds = groups.flat();
  if (!taskIds.length) return groups.map(() => []);
  const ownerFilter =
    owner.owner.kind === "audit"
      ? PrismaRaw.sql`"auditId" = ${owner.owner.id}::uuid AND "projectId" IS NULL`
      : PrismaRaw.sql`"projectId" = ${owner.owner.id}::uuid AND "auditId" IS NULL`;
  // One row per Task, its newest result. A Task with many files still returns one row.
  const rows = await prisma.$queryRaw<{ id: string; sourceTaskId: string }[]>`
    SELECT DISTINCT ON ("sourceTaskId") id, "sourceTaskId"
    FROM "project_seo_observation"
    WHERE ${ownerFilter}
      AND "sourceTaskId" = ANY(${taskIds}::text[])
      AND "ownerId" IS NULL
      AND kind NOT IN (${PrismaRaw.join(NON_RESULT_KINDS)})
    ORDER BY "sourceTaskId", "observedAt" DESC, id DESC
  `;
  const newestOfTask = new Map(rows.map((row) => [row.sourceTaskId, row.id]));
  const groupIds = groups.map((group) =>
    group.flatMap((taskId) => newestOfTask.get(taskId) ?? []).slice(0, 2),
  );
  const ids = groupIds.flat();
  const results = ids.length
    ? await prisma.projectSeoObservation.findMany({
        where: { id: { in: ids }, ...seoOwnerWhere(owner) },
        select: { id: true, observedAt: true, payload: true },
      })
    : [];
  const byId = new Map(results.map((row) => [row.id, row]));
  return groupIds.map((group) =>
    group.flatMap((id) => {
      const row = byId.get(id);
      const parsed = publicSeoPayloadSchema.safeParse(row?.payload);
      return row && parsed.success
        ? [{ observedAt: row.observedAt, payload: parsed.data }]
        : [];
    }),
  );
}

/** The two newest results of one group of Tasks, as above. */
export async function newestSeoMonitorResults(
  owner: Pick<SeoActor, "owner">,
  taskIds: string[],
): Promise<SeoMonitorRunResult[]> {
  const [results] = await newestResultsOfTaskGroups(owner, [taskIds]);
  return results;
}

/**
 * Per monitor: its newest Run and what its newest result changed against the result before. One indexed Task read
 * per monitor; the analysis status, result ids and payloads are one read each for all monitors.
 */
export async function readSeoMonitorRuns(
  actor: Pick<SeoActor, "owner" | "workspaceId">,
  monitorIds: string[],
): Promise<
  Map<
    string,
    { lastRun: SeoMonitorLastRun | null; change: SeoMonitorChange | null }
  >
> {
  const tasksOf = await Promise.all(
    monitorIds.map((monitorId) =>
      prisma.task.findMany({
        where: { scheduleId: monitorId, workspaceId: actor.workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: SEO_MONITOR_RECENT_RUNS,
        select: { id: true, status: true, createdAt: true },
      }),
    ),
  );
  const newestIds = tasksOf.flatMap((tasks) => tasks[0]?.id ?? []);
  const [analyses, results] = await Promise.all([
    newestIds.length
      ? prisma.projectSeoAnalysis.findMany({
          where: { taskId: { in: newestIds } },
          select: { taskId: true, status: true },
        })
      : [],
    newestResultsOfTaskGroups(
      actor,
      tasksOf.map((tasks) => tasks.map((task) => task.id)),
    ),
  ]);
  const analysisStatus = new Map(
    analyses.map((analysis) => [analysis.taskId, analysis.status]),
  );
  return new Map(
    monitorIds.map((monitorId, index) => {
      const newest = tasksOf[index][0];
      const [latest, previous] = results[index];
      return [
        monitorId,
        {
          lastRun: newest
            ? {
                at: newest.createdAt.toISOString(),
                status: lastRunStatus(
                  newest.status,
                  analysisStatus.get(newest.id),
                ),
                taskId: newest.id,
              }
            : null,
          change:
            latest && previous ? compareSeoMonitorRuns(previous, latest) : null,
        },
      ];
    }),
  );
}

/** Which SEO monitor made each of these Tasks. Tasks of other schedules and one-off checks are absent. */
export async function seoMonitorOfTasks(
  workspaceId: string,
  taskIds: string[],
): Promise<Map<string, string>> {
  if (!taskIds.length) return new Map();
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      workspaceId,
      schedule: { description: { startsWith: SEO_MONITOR_MARKER } },
    },
    select: { id: true, scheduleId: true },
  });
  return new Map(
    tasks.flatMap((task) =>
      task.scheduleId ? [[task.id, task.scheduleId] as const] : [],
    ),
  );
}
