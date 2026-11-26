import { type Prisma } from "@sokosumi/database";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import {
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

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

/**
 * Cuso's owner works in CMO, which has no Task board: a Task there is work
 * for a Coworker, and CMO's chat shows it. What a person has to do, Cuso
 * says in chat, where they will read it.
 */
export function refuseCusoPersonTask(
  versionId: string | null | undefined,
  input: {
    coworkerId?: string | null;
    assignToOwner?: true;
    memberId?: string;
  },
  /** Creating: a Task with nobody on it is a to-do for a person as well. */
  creating: boolean,
): void {
  if (getSokoBotVersion(versionId).profile !== "cmo") return;
  if (input.assignToOwner || input.memberId || (creating && !input.coworkerId))
    throw new SokoBotRefusedUnsentError(
      "Here a Task is work for a Coworker; a person never sees one. Tell the owner in your answer what you need them to do, or give the work to a Coworker with coworkerId.",
    );
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
 * Returns the equivalent alternate `create_task` input form on a single-Task
 * EVENT wake: when `triggeringTaskId` is omitted, returns the explicit form
 * with that single Task ID; when `triggeringTaskId` matches that single Task
 * ID, returns the implicit form without `triggeringTaskId`.
 *
 * Deployed ahead of enabling multiple `CREATE_TASK` actions per EVENT turn
 * (expand-and-contract cutover): keeping the caller's actual input for its
 * primary hash/operationKey while also checking this alternate form under the
 * reservation lock deduplicates omitted <-> explicit retries in both
 * directions, keeps single-claim protection active across mixed-version
 * rollouts, and ensures every worker reads both forms before multi-Task
 * creation is turned on.
 */
export async function alternateCreateTaskEventInput(
  db: Pick<Prisma.TransactionClient, "sokoBotEventInbox">,
  turn: { id: string; sokoBotId: string; source: string | null },
  rawInput: unknown,
): Promise<unknown | null> {
  if (
    turn.source !== "EVENT" ||
    !rawInput ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    return null;
  }
  const record = rawInput as Record<string, unknown>;
  const entries = await db.sokoBotEventInbox.findMany({
    where: { turnId: turn.id, botId: turn.sokoBotId },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const [only] = entries;
  if (entries.length !== 1 || !only) {
    return null;
  }
  if (record.triggeringTaskId === undefined) {
    return { ...record, triggeringTaskId: only.entityId };
  }
  if (record.triggeringTaskId === only.entityId) {
    const { triggeringTaskId: _ignored, ...withoutTrigger } = record;
    return withoutTrigger;
  }
  return null;
}

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
