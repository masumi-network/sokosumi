export interface TaskAssigneeRequestFields {
  assigneeId?: string | null;
  assigneeOrchestratorId?: string | null;
}

export interface ResolvedTaskAssignee {
  assigneeId: string | null;
  assigneeOrchestratorId: string | null;
}

export function hasResolvedTaskAssignee(
  assignee: ResolvedTaskAssignee,
): boolean {
  return assignee.assigneeId != null || assignee.assigneeOrchestratorId != null;
}

export function refineTaskAssigneeXorConflict(
  data: TaskAssigneeRequestFields,
  ctx: {
    addIssue: (issue: {
      code: "custom";
      message: string;
      path: Array<string | number>;
    }) => void;
  },
): void {
  const hasCoworker =
    data.assigneeId !== undefined &&
    data.assigneeId !== null &&
    data.assigneeId !== "";
  const hasOrchestrator =
    data.assigneeOrchestratorId !== undefined &&
    data.assigneeOrchestratorId !== null &&
    data.assigneeOrchestratorId !== "";
  if (hasCoworker && hasOrchestrator) {
    ctx.addIssue({
      code: "custom",
      message: "assigneeId and assigneeOrchestratorId are mutually exclusive",
      path: ["assigneeOrchestratorId"],
    });
  }
}

/** Dual-rail: orchestrator assignee or legacy shadow coworker assignee. */
export function isTaskAssignedToSokoBot(
  task: {
    assigneeOrchestratorId?: string | null;
    assigneeId?: string | null;
    assignee?: { sokoBotId?: string | null } | null;
  },
  bot: { id: string; coworkerId?: string | null },
): boolean {
  if (task.assigneeOrchestratorId === bot.id) return true;
  if (bot.coworkerId && task.assigneeId === bot.coworkerId) return true;
  if (task.assignee?.sokoBotId === bot.id) return true;
  return false;
}
