"use server";

import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
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
