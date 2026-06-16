import "server-only";

import type { AgentWithCreditsPrice } from "@sokosumi/utils";
import { SokosumiJobStatus } from "@sokosumi/utils";

import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { coreClient } from "@/lib/clients/core.client";
import type { JobSummary } from "@/lib/clients/generated/core/types.gen";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { taskService } from "@/lib/services/task.service";

type AgentForPreview = Parameters<typeof getAgentName>[0] &
  Parameters<typeof getAgentResolvedIcon>[0];

/** Minimal task shape used to resolve job coworker; full Task from getTaskById also accepted. */
type TaskSeedForJob = { id: string; coworkerId: string | null };

interface MapJobsToTasksViewDataParams {
  jobs: JobSummary[];
  coworkersById: Map<string, Parameters<typeof getCoworkerImage>[0]>;
  /** Agents already loaded for the page (e.g. catalog); avoids redundant getAgentById calls. */
  knownAgentsById?: ReadonlyMap<string, AgentWithCreditsPrice>;
  seedTasksById?: Map<
    string,
    | TaskSeedForJob
    | NonNullable<Awaited<ReturnType<typeof taskService.getTaskById>>>
  >;
}

async function getMissingTasksById(
  jobs: JobSummary[],
  tasksById: Map<
    string,
    | TaskSeedForJob
    | NonNullable<Awaited<ReturnType<typeof taskService.getTaskById>>>
  >,
) {
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

  if (missingTaskIds.length === 0) {
    return;
  }

  const missingTasks = await Promise.all(
    missingTaskIds.map((taskId) => taskService.getTaskById(taskId)),
  );
  for (const task of missingTasks) {
    if (!task) continue;
    tasksById.set(task.id, task);
  }
}

async function resolveAgentsForJobs(
  jobs: JobSummary[],
  knownAgentsById?: ReadonlyMap<string, AgentWithCreditsPrice>,
): Promise<Map<string, AgentForPreview | null>> {
  const agentIds = Array.from(new Set(jobs.map((job) => job.agentId)));
  const resolved = new Map<string, AgentForPreview | null>();
  const missingIds: string[] = [];

  for (const agentId of agentIds) {
    const known = knownAgentsById?.get(agentId);
    if (known) {
      resolved.set(agentId, known);
    } else {
      missingIds.push(agentId);
    }
  }

  await Promise.all(
    missingIds.map(async (agentId) => {
      try {
        const { data } = await coreClient.getAgentById(agentId);
        resolved.set(
          agentId,
          (data ?? null) as unknown as AgentForPreview | null,
        );
      } catch {
        resolved.set(agentId, null);
      }
    }),
  );

  return resolved;
}

export async function mapJobsToTasksViewData({
  jobs,
  coworkersById,
  knownAgentsById,
  seedTasksById,
}: MapJobsToTasksViewDataParams): Promise<{
  jobs: TasksViewJob[];
  agentPreviewById: Record<string, { name: string; icon: string | null }>;
}> {
  const tasksById = new Map(seedTasksById);
  const [agentsById] = await Promise.all([
    resolveAgentsForJobs(jobs, knownAgentsById),
    getMissingTasksById(jobs, tasksById),
  ]);

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
      if (!task) {
        return null;
      }

      const coworker = task.coworkerId
        ? (coworkersById.get(task.coworkerId) ?? null)
        : null;
      return {
        name: coworker?.name?.trim() || null,
        image: getCoworkerImage(coworker),
      };
    })(),
  }));

  const agentPreviewById: Record<
    string,
    { name: string; icon: string | null }
  > = {};
  for (const job of jobs) {
    if (agentPreviewById[job.agentId]) continue;
    const agent = agentsById.get(job.agentId);
    if (!agent) continue;
    agentPreviewById[job.agentId] = {
      name: getAgentName(agent),
      icon: getAgentResolvedIcon(agent),
    };
  }

  return {
    jobs: mappedJobs,
    agentPreviewById,
  };
}
