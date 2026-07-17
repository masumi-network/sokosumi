interface AssigneeIdAliasInput {
  assigneeId?: string | null;
  coworkerId?: string | null;
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
