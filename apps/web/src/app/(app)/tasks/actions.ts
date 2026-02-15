"use server";

import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
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
  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
  });

  return {
    jobs,
    nextCursor: jobsPage.nextCursor,
    agentPreviewById,
  };
}
