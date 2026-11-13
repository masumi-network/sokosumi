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
  if (analysisStatus === "requested" || analysisStatus === "running")
    return analysisStatus;
  return taskStatus === "COMPLETED" ? "completed" : "running";
}

/** Result rows read to find the newest result of each Task. A Task imports few files. */
const SEO_MONITOR_RESULT_ROWS = 50;

/**
 * The newest readable result of each of the two newest Tasks with a result, newest Task first. Tasks are in the
 * order given (newest created first), so a late result keeps its Run's place. One Task with two imported files
 * counts once. The workspace and the notification therefore compare the same pair of Runs. The owner filter keeps
 * the read on the owner's observation index.
 */
export async function newestSeoMonitorResults(
  owner: Pick<SeoActor, "owner">,
  taskIds: string[],
): Promise<SeoMonitorRunResult[]> {
  if (!taskIds.length) return [];
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(owner),
      sourceTaskId: { in: taskIds },
      ownerId: null,
      kind: { notIn: NON_RESULT_KINDS },
    },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: SEO_MONITOR_RESULT_ROWS,
    select: { id: true, sourceTaskId: true },
  });
  const newestOfTask = new Map<string, string>();
  for (const row of rows)
    if (row.sourceTaskId && !newestOfTask.has(row.sourceTaskId))
      newestOfTask.set(row.sourceTaskId, row.id);
  const ids = taskIds
    .flatMap((taskId) => newestOfTask.get(taskId) ?? [])
    .slice(0, 2);
  const results = await prisma.projectSeoObservation.findMany({
    where: { id: { in: ids } },
    select: { id: true, observedAt: true, payload: true },
  });
  return ids.flatMap((id) => {
    const row = results.find((item) => item.id === id);
    const parsed = publicSeoPayloadSchema.safeParse(row?.payload);
    return row && parsed.success
      ? [{ observedAt: row.observedAt, payload: parsed.data }]
      : [];
  });
}

/** Per monitor: its newest Run and what its newest result changed against the result before. */
export async function readSeoMonitorRuns(
  actor: Pick<SeoActor, "owner" | "workspaceId">,
  monitorIds: string[],
): Promise<
  Map<
    string,
    { lastRun: SeoMonitorLastRun | null; change: SeoMonitorChange | null }
  >
> {
  const entries = await Promise.all(
    monitorIds.map(async (monitorId) => {
      const tasks = await prisma.task.findMany({
        where: { scheduleId: monitorId, workspaceId: actor.workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: SEO_MONITOR_RECENT_RUNS,
        select: { id: true, status: true, createdAt: true },
      });
      const newest = tasks[0];
      const [analysis, results] = await Promise.all([
        newest
          ? prisma.projectSeoAnalysis.findUnique({
              where: { taskId: newest.id },
              select: { status: true },
            })
          : null,
        newestSeoMonitorResults(
          actor,
          tasks.map((task) => task.id),
        ),
      ]);
      const [latest, previous] = results;
      return [
        monitorId,
        {
          lastRun: newest
            ? {
                at: newest.createdAt.toISOString(),
                status: lastRunStatus(newest.status, analysis?.status),
                taskId: newest.id,
              }
            : null,
          change:
            latest && previous ? compareSeoMonitorRuns(previous, latest) : null,
        },
      ] as const;
    }),
  );
  return new Map(entries);
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
