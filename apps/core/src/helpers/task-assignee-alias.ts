import { countSetAssignees } from "@sokosumi/utils";

interface AssigneeIdAliasInput {
  assigneeId?: string | null;
  coworkerId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
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

/** Coworker, sokoBot, and user assignee FKs are at most one. */
export function refineAssigneeXorConflict(
  data: AssigneeIdAliasInput,
  ctx: AssigneeIdAliasIssueContext,
): void {
  refineAssigneeIdAliasConflict(data, ctx);
  if (
    countSetAssignees(
      resolveAssigneeIdFromRequest(data),
      data.assigneeSokoBotId,
      data.assigneeUserId,
    ) > 1
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Task cannot be assigned to more than one assignee",
      path: ["assigneeUserId"],
    });
  }
}

/**
 * A provided assignee field replaces the whole assignee: coworker,
 * sokoBot, user, or neither. Omitted fields leave the current assignee
 * untouched.
 */
export function nextAssigneeWrite(input: {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
}):
  | {
      assigneeId: string | null;
      assigneeSokoBotId: string | null;
      assigneeUserId: string | null;
    }
  | undefined {
  const hasCoworker = input.assigneeId !== undefined;
  const hasSokoBot = input.assigneeSokoBotId !== undefined;
  const hasUser = input.assigneeUserId !== undefined;
  if (!hasCoworker && !hasSokoBot && !hasUser) return undefined;
  const coworkerId = input.assigneeId?.trim() || null;
  const sokoBotId = input.assigneeSokoBotId?.trim() || null;
  const userId = input.assigneeUserId?.trim() || null;
  if (hasCoworker && coworkerId) {
    return {
      assigneeId: coworkerId,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    };
  }
  if (hasSokoBot && sokoBotId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: sokoBotId,
      assigneeUserId: null,
    };
  }
  if (hasUser && userId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: userId,
    };
  }
  return {
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
  };
}
