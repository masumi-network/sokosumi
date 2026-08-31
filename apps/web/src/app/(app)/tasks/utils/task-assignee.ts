import type { TaskAssigneeKind } from "@sokosumi/utils";

import type { TaskBoardAssignee } from "@/app/tasks/types/task-board";
import type { Task } from "@/lib/clients/generated/core/types.gen";

export const UNSET_TASK_ASSIGNEE_VALUE = "unset";

export interface TaskAssigneeMemberOption {
  id: string;
  name: string;
  image?: string | null;
}

export type TaskAssigneeSelection =
  | { kind: "unset" }
  | { kind: "coworker"; id: string }
  | { kind: "user"; id: string };

export function encodeTaskAssigneeValue(
  selection: TaskAssigneeSelection,
): string {
  if (selection.kind === "unset") {
    return UNSET_TASK_ASSIGNEE_VALUE;
  }

  return `${selection.kind}:${selection.id}`;
}

export function decodeTaskAssigneeValue(
  value: string | null | undefined,
): TaskAssigneeSelection {
  if (!value || value === UNSET_TASK_ASSIGNEE_VALUE) {
    return { kind: "unset" };
  }

  if (value.startsWith("coworker:")) {
    const id = value.slice("coworker:".length);
    if (id) {
      return { kind: "coworker", id };
    }
  }

  if (value.startsWith("user:")) {
    const id = value.slice("user:".length);
    if (id) {
      return { kind: "user", id };
    }
  }

  return { kind: "unset" };
}

export function taskAssigneeIdsFromSelection(
  selection: TaskAssigneeSelection,
): {
  assigneeId: string | null;
  assigneeUserId: string | null;
} {
  if (selection.kind === "coworker") {
    return { assigneeId: selection.id, assigneeUserId: null };
  }

  if (selection.kind === "user") {
    return { assigneeId: null, assigneeUserId: selection.id };
  }

  return { assigneeId: null, assigneeUserId: null };
}

export function taskAssigneeKindFromIds(
  assigneeId: string | null | undefined,
  assigneeUserId: string | null | undefined,
): TaskAssigneeKind {
  if (assigneeId) {
    return "coworker";
  }

  if (assigneeUserId) {
    return "human";
  }

  return "unset";
}

export function taskAssigneeKindFromBoardAssignee(
  assignee: TaskBoardAssignee | null | undefined,
): TaskAssigneeKind {
  if (assignee?.kind === "coworker") {
    return "coworker";
  }

  if (assignee?.kind === "user") {
    return "human";
  }

  return "unset";
}

export function defaultTaskAssigneeValue(input: {
  mode: "create" | "edit";
  assigneeId?: string | null;
  assigneeUserId?: string | null;
  coworkerOptions: Array<{ id: string; slug: string; name: string }>;
}): string {
  if (input.assigneeUserId) {
    return encodeTaskAssigneeValue({
      kind: "user",
      id: input.assigneeUserId,
    });
  }

  if (input.assigneeId) {
    return encodeTaskAssigneeValue({
      kind: "coworker",
      id: input.assigneeId,
    });
  }

  if (input.mode === "edit") {
    return UNSET_TASK_ASSIGNEE_VALUE;
  }

  const elenaCoworker = input.coworkerOptions.find(
    (option) =>
      option.slug.trim().toLowerCase() === "elena" ||
      option.name.trim().toLowerCase() === "elena",
  );
  const fallback = elenaCoworker ?? input.coworkerOptions[0];
  if (!fallback) {
    return UNSET_TASK_ASSIGNEE_VALUE;
  }

  return encodeTaskAssigneeValue({ kind: "coworker", id: fallback.id });
}

export function coworkerNameFromCoreAssignee(
  assignee: Task["assignee"],
): string | null {
  if (assignee?.type === "coworker") {
    return assignee.coworker.name;
  }

  return null;
}

export function mapCoreAssigneeToBoardAssignee(
  assignee: Task["assignee"],
): TaskBoardAssignee | null {
  if (!assignee) {
    return null;
  }

  if (assignee.type === "coworker") {
    return {
      kind: "coworker",
      id: assignee.id,
      name: assignee.coworker.name,
      image: assignee.coworker.image ?? null,
      slug: assignee.coworker.slug,
    };
  }

  return {
    kind: "user",
    id: assignee.id,
    name: assignee.user.name,
    image: assignee.user.image ?? null,
  };
}
