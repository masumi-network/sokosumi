import { type TaskStatus, TaskVisibility } from "@sokosumi/database";
import {
  countSetAssignees,
  hasAssigneeValue,
  isAgentOnlyTaskStatus,
} from "@sokosumi/utils";
import type { TaskAssigner } from "@/helpers/access-control";
import { badRequest, unprocessableEntity } from "@/helpers/error";
import type { TaskDomainActor } from "./task-domain.service";

export function requireAssigneeXor(
  assigneeId: string | null | undefined,
  assigneeSokoBotId: string | null | undefined,
  assigneeUserId?: string | null | undefined,
): void {
  if (countSetAssignees(assigneeId, assigneeSokoBotId, assigneeUserId) > 1) {
    throw unprocessableEntity(
      "Task cannot be assigned to more than one assignee",
    );
  }
}

export function requireNoHumanAssigneeOnPrivateTask(
  visibility: TaskVisibility,
  assigneeUserId: string | null | undefined,
): void {
  if (
    visibility === TaskVisibility.PRIVATE &&
    hasAssigneeValue(assigneeUserId)
  ) {
    throw badRequest("Private Tasks cannot be assigned to a human teammate");
  }
}

export function requireAssigneeForExecutableStatus(
  status: TaskStatus,
  assigneeId: string | null | undefined,
  assigneeSokoBotId?: string | null,
  assigneeUserId?: string | null | undefined,
): void {
  requireAssigneeXor(assigneeId, assigneeSokoBotId, assigneeUserId);
  if (
    isAgentOnlyTaskStatus(status) &&
    !hasAssigneeValue(assigneeId) &&
    !hasAssigneeValue(assigneeSokoBotId)
  ) {
    throw unprocessableEntity(
      "An agent (Coworker or Soko Bot) assignee is required for this status",
    );
  }
}

/** Only a user or a Soko Bot acting for itself carries tasking authority. */
export function taskAssigner(actor: TaskDomainActor): TaskAssigner {
  switch (actor.kind) {
    case "user":
      return { kind: "user", userId: actor.userId };
    case "soko_bot":
      return { kind: "soko_bot", sokoBotId: actor.sokoBotId };
    case "coworker":
      return { kind: "other" };
  }
}
