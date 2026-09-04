interface AssigneeIdAliasInput {
  assigneeId?: string | null;
  coworkerId?: string | null;
  assigneeSokoBotId?: string | null;
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
  return value != null && value.trim() !== "";
}

/** Coworker and sokoBot assignee FKs are XOR. */
export function refineAssigneeXorConflict(
  data: AssigneeIdAliasInput,
  ctx: AssigneeIdAliasIssueContext,
): void {
  refineAssigneeIdAliasConflict(data, ctx);
  if (
    hasAssigneeValue(resolveAssigneeIdFromRequest(data)) &&
    hasAssigneeValue(data.assigneeSokoBotId)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "assigneeId and assigneeSokoBotId cannot both be set",
      path: ["assigneeSokoBotId"],
    });
  }
}

/**
 * A provided assignee field replaces the whole assignee: coworker, sokoBot,
 * or neither. Omitted fields leave the current assignee untouched.
 */
export function nextAssigneeWrite(input: {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
}):
  | { assigneeId: string | null; assigneeSokoBotId: string | null }
  | undefined {
  const hasCoworker = input.assigneeId !== undefined;
  const hasSokoBot = input.assigneeSokoBotId !== undefined;
  if (!hasCoworker && !hasSokoBot) return undefined;
  const coworkerId = input.assigneeId?.trim() || null;
  const sokoBotId = input.assigneeSokoBotId?.trim() || null;
  if (hasCoworker && coworkerId) {
    return { assigneeId: coworkerId, assigneeSokoBotId: null };
  }
  if (hasSokoBot && sokoBotId) {
    return { assigneeId: null, assigneeSokoBotId: sokoBotId };
  }
  return { assigneeId: null, assigneeSokoBotId: null };
}
