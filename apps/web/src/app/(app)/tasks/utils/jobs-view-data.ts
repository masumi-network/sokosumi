import "server-only";

import type { SokosumiJobStatus } from "@sokosumi/database";

import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import type { JobSummary } from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";

/** Minimal task shape used to resolve job coworker; full Task from getTaskById also accepted. */
type TaskSeedForJob = { id: string; coworkerId: string | null };

interface MemberPreview {
  name: string | null;
  image: string | null;
}

interface AgentPreview {
  name: string;
  icon: string | null;
}

interface MapJobsToTasksViewDataParams {
  jobs: JobSummary[];
  coworkersById: Map<string, Parameters<typeof getCoworkerImage>[0]>;
  memberPreviewByUserId: Map<string, MemberPreview>;
  agentPreviewSeedById: Map<string, AgentPreview>;
  seedTasksById?: Map<
    string,
    | TaskSeedForJob
    | NonNullable<Awaited<ReturnType<typeof taskService.getTaskById>>>
  >;
}

export async function mapJobsToTasksViewData({
  jobs,
  coworkersById,
  memberPreviewByUserId,
  agentPreviewSeedById,
  seedTasksById,
}: MapJobsToTasksViewDataParams): Promise<{
  jobs: TasksViewJob[];
  agentPreviewById: Record<string, AgentPreview>;
}> {
  const tasksById = new Map(seedTasksById);
  const missingTaskIds = Array.from(
    new Set(
      jobs
        .map((job) => job.taskId)
        .filter((taskId): taskId is string => {
          if (!taskId) return false;
          return !tasksById.has(taskId);
        }),
    ),
  );

  if (missingTaskIds.length > 0) {
    const missingTasks = await Promise.all(
      missingTaskIds.map((taskId) => taskService.getTaskById(taskId)),
    );
    for (const task of missingTasks) {
      if (!task) continue;
      tasksById.set(task.id, task);
    }
  }

  const mappedJobs: TasksViewJob[] = jobs.map((job) => ({
    id: job.id,
    agentId: job.agentId,
    name: job.name ?? null,
    createdAt: new Date(job.createdAt).toISOString(),
    completedAt: job.completedAt
      ? new Date(job.completedAt).toISOString()
      : null,
    status: job.status as SokosumiJobStatus,
    jobType: job.jobType,
    coworker: (() => {
      const task = job.taskId ? tasksById.get(job.taskId) : null;
      const memberPreview = memberPreviewByUserId.get(job.userId) ?? null;
      if (!task) {
        return {
          name: memberPreview?.name ?? null,
          image: memberPreview?.image ?? null,
        };
      }

      const coworker = task.coworkerId
        ? (coworkersById.get(task.coworkerId) ?? null)
        : null;
      return {
        name: coworker?.name ?? memberPreview?.name ?? null,
        image: coworker
          ? getCoworkerImage(coworker)
          : (memberPreview?.image ?? null),
      };
    })(),
  }));

  const agentPreviewById: Record<string, AgentPreview> = {};
  for (const job of jobs) {
    if (agentPreviewById[job.agentId]) continue;
    const seededPreview = agentPreviewSeedById.get(job.agentId);
    agentPreviewById[job.agentId] = {
      name: seededPreview?.name ?? job.agentId,
      icon: seededPreview?.icon ?? null,
    };
  }

  return {
    jobs: mappedJobs,
    agentPreviewById,
  };
}
