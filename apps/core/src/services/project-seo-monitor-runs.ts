import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import { SEO_MONITOR_MARKER } from "@/lib/seo/monitor-plan";
import type {
  SeoMonitorChange,
  SeoMonitorLastRun,
} from "@/schemas/project-seo-monitor.schema";

import {
  compareSeoMonitorRuns,
  type SeoMonitorRunResult,
} from "./project-seo-monitor-change";

/** Newest Tasks of a monitor searched for its two newest results. Older results do not feed the change. */
const SEO_MONITOR_RECENT_RUNS = 10;
/** Observation kinds that hold no check result. */
const NON_RESULT_KINDS = ["metrics", "page_change"];

function lastRunStatus(
  taskStatus: string,
  analysisStatus: string | undefined,
): SeoMonitorLastRun["status"] {
  if (
    analysisStatus === "requested" ||
    analysisStatus === "running" ||
    analysisStatus === "completed" ||
    analysisStatus === "failed"
  )
    return analysisStatus;
  if (taskStatus === "COMPLETED") return "completed";
  return taskStatus === "FAILED" || taskStatus === "CANCELED"
    ? "failed"
    : "running";
}

/** The two newest readable results of these Tasks, newest first. */
export async function newestSeoMonitorResults(
  taskIds: string[],
  before?: Date,
): Promise<SeoMonitorRunResult[]> {
  if (!taskIds.length) return [];
  const rows = await prisma.projectSeoObservation.findMany({
    where: {
      sourceTaskId: { in: taskIds },
      ownerId: null,
      kind: { notIn: NON_RESULT_KINDS },
      ...(before ? { observedAt: { lt: before } } : {}),
    },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { observedAt: true, payload: true },
  });
  return rows.flatMap((row) => {
    const parsed = publicSeoPayloadSchema.safeParse(row.payload);
    return parsed.success
      ? [{ observedAt: row.observedAt, payload: parsed.data }]
      : [];
  });
}

/** Per monitor: its newest Run and what its newest result changed against the result before. */
export async function readSeoMonitorRuns(
  workspaceId: string,
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
        where: { scheduleId: monitorId, workspaceId },
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
        newestSeoMonitorResults(tasks.map((task) => task.id)),
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
