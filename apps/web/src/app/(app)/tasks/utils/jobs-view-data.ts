import "server-only";

import type { JobWithSokosumiStatus } from "@sokosumi/database";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { taskService } from "@/lib/services/task.service";

interface TasksViewJobData {
  id: string;
  agentId: string;
  name: string | null;
  createdAt: string;
  completedAt: string | null;
  status: JobWithSokosumiStatus["status"];
  jobType: JobWithSokosumiStatus["jobType"];
  coworker: {
    name: string | null;
    image: string | null;
  } | null;
}

interface AgentPreview {
  name: string;
  icon: string | null;
}

interface MapJobsToTasksViewDataParams {
  jobs: JobWithSokosumiStatus[];
  coworkersById: Map<string, Parameters<typeof getCoworkerImage>[0]>;
  seedTasksById?: Map<
    string,
    NonNullable<Awaited<ReturnType<typeof taskService.getTaskById>>>
  >;
}

export async function mapJobsToTasksViewData({
  jobs,
  coworkersById,
  seedTasksById,
}: MapJobsToTasksViewDataParams): Promise<{
  jobs: TasksViewJobData[];
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

  const mappedJobs = jobs.map((job) => ({
    id: job.id,
    agentId: job.agentId,
    name: job.name,
    createdAt: new Date(job.createdAt).toISOString(),
    completedAt: job.completedAt
      ? new Date(job.completedAt).toISOString()
      : null,
    status: job.status,
    jobType: job.jobType,
    coworker: (() => {
      const task = job.taskId ? tasksById.get(job.taskId) : null;
      if (!task) {
        return {
          name: job.user.name ?? null,
          image: job.user.image ?? null,
        };
      }

      const coworker = task.coworkerId
        ? (coworkersById.get(task.coworkerId) ?? null)
        : null;
      return {
        name: coworker?.name ?? null,
        image: getCoworkerImage(coworker),
      };
    })(),
  }));

  const agentPreviewById: Record<string, AgentPreview> = {};
  for (const job of jobs) {
    if (agentPreviewById[job.agentId]) continue;
    agentPreviewById[job.agentId] = {
      name: getAgentName(job.agent),
      icon: getAgentResolvedIcon(job.agent),
    };
  }

  return {
    jobs: mappedJobs,
    agentPreviewById,
  };
}
