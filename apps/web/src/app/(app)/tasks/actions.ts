"use server";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

export async function loadMoreTasks(cursor: string | null) {
  const [coworkers, agents, tasksResult] = await Promise.all([
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    taskService.listTasks({ cursor, limit: 20 }),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  const tasks = tasksResult.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );

  return {
    tasks,
    nextCursor: tasksResult.pagination?.nextCursor ?? null,
  };
}

export async function loadMoreJobs(cursor: string | null) {
  const [coworkers, jobsPage] = await Promise.all([
    coworkerService.listCoworkers(),
    userService.listMyJobsForActiveContextPaginated({
      cursor,
      limit: 20,
    }),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const missingTaskIds = Array.from(
    new Set(
      jobsPage.jobs
        .map((job) => job.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    ),
  );
  const missingTasks = await Promise.all(
    missingTaskIds.map((taskId) => taskService.getTaskById(taskId)),
  );
  const tasksById = new Map(
    missingTasks
      .filter((task): task is NonNullable<typeof task> => Boolean(task))
      .map((task) => [task.id, task]),
  );

  const jobs = jobsPage.jobs.map((job) => ({
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

  const agentPreviewById: Record<
    string,
    { name: string; icon: string | null }
  > = {};
  for (const job of jobsPage.jobs) {
    if (agentPreviewById[job.agentId]) continue;
    agentPreviewById[job.agentId] = {
      name: getAgentName(job.agent),
      icon: getAgentResolvedIcon(job.agent),
    };
  }

  return {
    jobs,
    nextCursor: jobsPage.nextCursor,
    agentPreviewById,
  };
}
