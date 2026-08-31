interface AssigneeIdAliasInput {
  assigneeId?: string | null;
  coworkerId?: string | null;
}

interface AssigneeKindInput {
  assigneeId?: string | null;
  assigneeUserId?: string | null;
}

interface AssigneeIssueContext {
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
  ctx: AssigneeIssueContext,
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

export function refineAssigneeKindConflict(
  data: AssigneeKindInput,
  ctx: AssigneeIssueContext,
): void {
  if (data.assigneeId && data.assigneeUserId) {
    ctx.addIssue({
      code: "custom",
      message: "assigneeId and assigneeUserId cannot both be set",
      path: ["assigneeUserId"],
    });
  }
}

export function resolveNextTaskAssignees(
  input: AssigneeKindInput,
  current: { assigneeId: string | null; assigneeUserId: string | null },
): { assigneeId: string | null; assigneeUserId: string | null } {
  if (input.assigneeUserId && input.assigneeUserId !== current.assigneeUserId) {
    return {
      assigneeId: input.assigneeId !== undefined ? input.assigneeId : null,
      assigneeUserId: input.assigneeUserId,
    };
  }
  if (input.assigneeId && input.assigneeId !== current.assigneeId) {
    return {
      assigneeId: input.assigneeId,
      assigneeUserId:
        input.assigneeUserId !== undefined ? input.assigneeUserId : null,
    };
  }

  return {
    assigneeId:
      input.assigneeId !== undefined ? input.assigneeId : current.assigneeId,
    assigneeUserId:
      input.assigneeUserId !== undefined
        ? input.assigneeUserId
        : current.assigneeUserId,
  };
}
