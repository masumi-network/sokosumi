import { TaskStatus } from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import { SokosumiJobStatus } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

interface StatusCount<TStatus extends string> {
  status: TStatus;
  count: number;
}

interface ProjectResourceStats<TStatus extends string> {
  total: number;
  byStatus: Array<StatusCount<TStatus>>;
}

export interface ProjectStatsEntry {
  projectId: string;
  tasks: ProjectResourceStats<TaskStatus>;
  jobs: ProjectResourceStats<SokosumiJobStatus>;
}

function createEmptyResourceStats<
  TStatus extends string,
>(): ProjectResourceStats<TStatus> {
  return {
    total: 0,
    byStatus: [],
  };
}

function createResourceStatsByProjectId<TStatus extends string>(
  projectIds: readonly string[],
): Map<string, ProjectResourceStats<TStatus>> {
  return new Map(
    projectIds.map((projectId) => [projectId, createEmptyResourceStats()]),
  );
}

function addStatusCount<TStatus extends string>(
  stats: ProjectResourceStats<TStatus>,
  status: TStatus,
  count: number,
) {
  stats.total += count;
  stats.byStatus.push({ status, count });
}

export async function getProjectTaskStatsByProjectIds(
  workspaceId: string,
  projectIds: readonly string[],
): Promise<Map<string, ProjectResourceStats<TaskStatus>>> {
  const statsByProjectId =
    createResourceStatsByProjectId<TaskStatus>(projectIds);

  if (projectIds.length === 0) {
    return statsByProjectId;
  }

  const taskStatusCounts = await prisma.task.groupBy({
    by: ["projectId", "status"],
    where: {
      archivedAt: null,
      workspaceId,
      projectId: { in: [...projectIds] },
    },
    _count: {
      _all: true,
    },
  });

  for (const row of taskStatusCounts) {
    if (!row.projectId) continue;
    const stats = statsByProjectId.get(row.projectId);
    if (!stats) continue;

    addStatusCount(stats, row.status, row._count._all);
  }

  return statsByProjectId;
}

export async function getProjectJobStatsByProjectIds(
  workspaceId: string,
  projectIds: readonly string[],
): Promise<Map<string, ProjectResourceStats<SokosumiJobStatus>>> {
  const statsByProjectId =
    createResourceStatsByProjectId<SokosumiJobStatus>(projectIds);

  if (projectIds.length === 0) {
    return statsByProjectId;
  }

  const jobs = await prisma.job.findMany({
    where: {
      workspaceId,
      projectId: { in: [...projectIds] },
    },
    select: jobForStatusComputeSelect,
  });

  for (const job of jobs) {
    const projectId = job.projectId;
    if (!projectId) continue;
    const stats = statsByProjectId.get(projectId);
    if (!stats) continue;

    const status = computeJobStatus(job);
    const existingStatusCount = stats.byStatus.find(
      (entry) => entry.status === status,
    );

    stats.total += 1;
    if (existingStatusCount) {
      existingStatusCount.count += 1;
    } else {
      stats.byStatus.push({ status, count: 1 });
    }
  }

  return statsByProjectId;
}

export async function getProjectStatsByProjectIds(
  workspaceId: string,
  projectIds: readonly string[],
): Promise<ProjectStatsEntry[]> {
  const uniqueProjectIds = Array.from(new Set(projectIds));
  const [taskStatsByProjectId, jobStatsByProjectId] = await Promise.all([
    getProjectTaskStatsByProjectIds(workspaceId, uniqueProjectIds),
    getProjectJobStatsByProjectIds(workspaceId, uniqueProjectIds),
  ]);

  return uniqueProjectIds.map((projectId) => ({
    projectId,
    tasks:
      taskStatsByProjectId.get(projectId) ??
      createEmptyResourceStats<TaskStatus>(),
    jobs:
      jobStatsByProjectId.get(projectId) ??
      createEmptyResourceStats<SokosumiJobStatus>(),
  }));
}
