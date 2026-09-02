interface AssigneeIdAliasInput {
  assigneeId?: string | null;
  coworkerId?: string | null;
  assigneeOrchestratorId?: string | null;
}

interface AssigneeIdAliasIssueContext {
  addIssue: (issue: {
    code: "custom";
    message: string;
    path: Array<string | number>;
  }) => void;
}

/**
 * Resolves the canonical assignee coworker id from request fields.
 * Prefer `assigneeId`; fall back to deprecated `coworkerId`.
 * Callers must reject conflicting pairs via {@link refineAssigneeIdAliasConflict}.
 */
export function resolveAssigneeIdFromRequest(
  input: AssigneeIdAliasInput,
): string | null | undefined {
  if (input.assigneeId !== undefined) {
    return input.assigneeId;
  }

  return input.coworkerId;
}

export function refineAssigneeIdAliasConflict(
  data: AssigneeIdAliasInput,
  ctx: AssigneeIdAliasIssueContext,
): void {
  if (
    data.assigneeId !== undefined &&
    data.coworkerId !== undefined &&
    data.assigneeId !== data.coworkerId
  ) {
    ctx.addIssue({
      code: "custom",
      message: "assigneeId and coworkerId must match when both are provided",
      path: ["assigneeId"],
    });
  }
}

function hasAssigneeValue(value: string | null | undefined): boolean {
  return value != null && value !== "";
}

/** Coworker and orchestrator assignee FKs are XOR. */
export function refineAssigneeXorConflict(
  data: AssigneeIdAliasInput,
  ctx: AssigneeIdAliasIssueContext,
): void {
  refineAssigneeIdAliasConflict(data, ctx);
  if (
    hasAssigneeValue(resolveAssigneeIdFromRequest(data)) &&
    hasAssigneeValue(data.assigneeOrchestratorId)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "assigneeId and assigneeOrchestratorId cannot both be set",
      path: ["assigneeOrchestratorId"],
    });
  }
}

/**
 * A provided assignee field replaces the whole assignee: coworker, orchestrator,
 * or neither. Omitted fields leave the current assignee untouched.
 */
export function nextAssigneeWrite(input: {
  assigneeId?: string | null;
  assigneeOrchestratorId?: string | null;
}):
  | { assigneeId: string | null; assigneeOrchestratorId: string | null }
  | undefined {
  const hasCoworker = input.assigneeId !== undefined;
  const hasOrchestrator = input.assigneeOrchestratorId !== undefined;
  if (!hasCoworker && !hasOrchestrator) return undefined;
  if (hasCoworker && input.assigneeId != null) {
    return { assigneeId: input.assigneeId, assigneeOrchestratorId: null };
  }
  if (hasOrchestrator && input.assigneeOrchestratorId != null) {
    return {
      assigneeId: null,
      assigneeOrchestratorId: input.assigneeOrchestratorId,
    };
  }
  return { assigneeId: null, assigneeOrchestratorId: null };
}
