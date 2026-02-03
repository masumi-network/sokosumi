"use server";

import { agentService } from "@/lib/services/agent.service";
import { orchestratorService } from "@/lib/services/orchestrator.service";
import { taskService } from "@/lib/services/task.service";
import { mapTaskToTaskWithOrchestrator } from "@/lib/utils/task-transformer";

export async function loadMoreTasks(cursor: string | null) {
  const [orchestrators, agents, tasksResult] = await Promise.all([
    orchestratorService.listOrchestrators(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    taskService.listTasks({ cursor, limit: 20 }),
  ]);

  const orchestratorsById = new Map(
    orchestrators.map((orchestrator) => [orchestrator.id, orchestrator]),
  );

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  const tasks = tasksResult.tasks.map((task) =>
    mapTaskToTaskWithOrchestrator(task, orchestratorsById, agentsById),
  );

  return {
    tasks,
    nextCursor: tasksResult.pagination?.nextCursor ?? null,
  };
}
