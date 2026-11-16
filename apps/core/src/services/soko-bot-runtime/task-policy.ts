import { type Prisma } from "@sokosumi/database";
import { SokoBotRuntimeValidationError } from "../soko-bot-runtime.service";

export function toolAssigneeFields(
  coworkerId: string | null | undefined,
  sokoBotId: string,
  ownerUserId?: string | null,
): {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
} {
  if (ownerUserId) {
    if (coworkerId)
      throw new SokoBotRuntimeValidationError(
        "Give coworkerId or a person to assign, not both",
      );
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: ownerUserId,
    };
  }
  if (coworkerId == null) return {};
  if (coworkerId === sokoBotId) {
    return { assigneeId: null, assigneeSokoBotId: sokoBotId };
  }
  return { assigneeId: coworkerId, assigneeSokoBotId: null };
}

export const MAX_BOT_COMMENTS_PER_TASK_PER_DAY = 3;

/** The longest Task description or comment the tool schemas accept. */
export const TASK_TEXT_MAX_CHARS = 20_000;

export const ACTIVE_STATUSES = [
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
] as const;

/**
 * The Task an event turn's batch is about, when there is only one: a follow-up
 * created on that turn belongs to it. With several, the model has to say which.
 */
export async function onlyEventTask(
  tx: Prisma.TransactionClient,
  turn: { id: string; sokoBotId: string },
): Promise<string> {
  const entries = await tx.sokoBotEventInbox.findMany({
    where: { turnId: turn.id, botId: turn.sokoBotId },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const [only] = entries;
  if (entries.length === 1 && only) return only.entityId;
  throw new SokoBotRuntimeValidationError(
    entries.length
      ? `Set triggeringTaskId to the event's Task this follows up: one of ${entries.map((entry) => entry.entityId).join(", ")}.`
      : "This event turn has no Task to follow up, so it cannot create one.",
  );
}

/** Fields that name a Task by id in tool input. */
export const TASK_ID_FIELDS = ["taskId", "peerTaskId"] as const;

export const TASK_ID_PREFIX = 23;
