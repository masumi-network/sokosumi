import type { Task } from "@sokosumi/core-client";
import { isAgentOnlyTaskStatus } from "@sokosumi/utils";

import type { ProjectFilterOption } from "./tasks-filters";

/** Why person and empty assignee options are off, or null when all are open. */
export type AssigneePeopleLock = "agentRequired" | "private" | null;

/** Core rejects a person, or no one, where only an agent may hold the Task. */
export function assigneePeopleLock(
  task: Pick<Task, "status" | "visibility">,
): AssigneePeopleLock {
  if (isAgentOnlyTaskStatus(task.status)) return "agentRequired";
  if (task.visibility === "PRIVATE") return "private";
  return null;
}

/**
 * Project picker options that hold the Task's own project. The list is capped,
 * so the current project is added from its own read. Returns null when the
 * list failed, or when the Task has a project neither read could load: the
 * picker would then offer a misleading list.
 */
export function withCurrentProjectOption(
  listed: ProjectFilterOption[] | null,
  taskProjectId: string | null,
  current: ProjectFilterOption | null,
): ProjectFilterOption[] | null {
  if (!listed) return null;
  if (!taskProjectId) return listed;
  if (listed.some((option) => option.id === taskProjectId)) return listed;
  if (current?.id !== taskProjectId) return null;
  return [
    {
      id: current.id,
      name: current.name,
      logo: current.logo,
      designMd: current.designMd,
      briefingUrl: current.briefingUrl,
      contextMd: current.contextMd,
    },
    ...listed,
  ];
}
