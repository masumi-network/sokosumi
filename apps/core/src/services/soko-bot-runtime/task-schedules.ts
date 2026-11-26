import { createHash } from "node:crypto";
import {
  sokoBotDeleteTaskScheduleInputSchema,
  sokoBotSaveTaskScheduleInputSchema,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import {
  createTaskScheduleRequestSchema,
  updateTaskScheduleRequestSchema,
} from "@/schemas/task-schedule.schema";
import {
  changeTaskScheduleState,
  createTaskSchedule,
  deleteTaskSchedule,
  updateTaskSchedule,
} from "@/services/task-schedule.service";
import {
  findReadableSchedule,
  type ScheduleActor,
} from "@/services/task-schedule-read.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";
import {
  isOursTaskSchedule,
  keepsOwnersTaskSchedules,
  ownersOwnChat,
} from "./task-schedule-access";

/**
 * A personal Soko Bot keeps the owner's Task Schedules (the Schedules page)
 * with the owner's own rights, as their Creator. A schedule someone else made
 * changes only on the owner's own chat turn: the bot asks first and acts on
 * the yes. Shared bots have no owner to act for.
 */

async function botScheduleActor(
  authorized: AuthorizedSokoBotRuntime,
): Promise<ScheduleActor> {
  const { actingUserId, workspaceId, sokoBotId } = authorized.turn;
  if (!actingUserId || !keepsOwnersTaskSchedules(authorized))
    throw new SokoBotRefusedUnsentError(
      "Task Schedules are kept for your owner, on your owner's own turn. Say what you would change; your owner or a member can do it on the Schedules page.",
    );
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { id: true, userId: true, organizationId: true },
  });
  await requireAssignedOrganizationSeat(actingUserId, workspace.organizationId);
  return {
    kind: "user",
    userId: actingUserId,
    sokoBotId,
    workspace: {
      workspaceId: workspace.id,
      userId: workspace.userId,
      organizationId: workspace.organizationId,
    },
  };
}

async function requireChangeable(
  actor: ScheduleActor,
  authorized: AuthorizedSokoBotRuntime,
  scheduleId: string,
) {
  const current = await findReadableSchedule(actor, scheduleId);
  if (!isOursTaskSchedule(authorized, current) && !ownersOwnChat(authorized))
    throw new SokoBotRefusedUnsentError(
      `"${current.name}" was made by someone else. Ask your owner first, and change it when they say yes in their chat.`,
    );
  return current;
}

/**
 * A UUID that is the same for every attempt of one tool call: the create
 * service's idempotency key (`operationId`), scoped to the workspace.
 */
export function toolCallOperationId(
  turnId: string,
  toolCallId: string,
): string {
  const hex = createHash("sha256")
    .update(`save_task_schedule:${turnId}:${toolCallId}`)
    .digest("hex");
  // RFC 9562 version 8 (custom) with the RFC variant bits.
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16,
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A scheduled run never deletes, pauses or ends a Task Schedule (Codex round 13). */
const SCHEDULED_RUN_REFUSAL =
  "A scheduled run doesn't delete, pause or end Task Schedules. Report what you found and let the owner decide.";

/** The day's end in UTC; the rule is read in its own timezone anyway. */
const endOfDay = (day: string) => `${day}T23:59:59.000Z`;

function ruleEnd(input: {
  endsOn?: string | null;
  endsAfterRuns?: number | null;
}) {
  if (input.endsOn)
    return {
      endsMode: "ON" as const,
      endsOn: endOfDay(input.endsOn),
      targetRunCount: null,
    };
  if (input.endsAfterRuns)
    return {
      endsMode: "AFTER" as const,
      endsOn: null,
      targetRunCount: input.endsAfterRuns,
    };
  return { endsMode: "NEVER" as const, endsOn: null, targetRunCount: null };
}

interface SavedSchedule {
  id: string;
  name: string;
  state: string;
  expr: string;
  timezone: string;
  nextRunAt: Date | null;
}

function brief(schedule: SavedSchedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    state: schedule.state,
    cron: schedule.expr,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
  };
}

const STATE_ACTIONS = {
  ACTIVE: "resume",
  PAUSED: "pause",
  ENDED: "end",
} as const;

async function refusingHttp<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HTTPException && error.status < 500)
      throw new SokoBotRefusedUnsentError(error.message);
    throw error;
  }
}

export async function saveTaskSchedule(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  const parsed = sokoBotSaveTaskScheduleInputSchema.parse(input.input);
  const actor = await botScheduleActor(authorized);
  const assignee = {
    ...(parsed.assigneeCoworkerId !== undefined && {
      assigneeId: parsed.assigneeCoworkerId,
    }),
    ...(parsed.assigneeSokoBotId !== undefined && {
      assigneeSokoBotId: parsed.assigneeSokoBotId,
    }),
  };
  // A scheduled run never pauses or ends a Task Schedule, a new one included
  // (Codex round 15), and never gives an existing one an end date or a run
  // count, which end it too, just later (Neon round 6).
  if (
    authorized.turn.source === "SCHEDULE" &&
    (parsed.state === "PAUSED" ||
      parsed.state === "ENDED" ||
      (parsed.scheduleId !== undefined &&
        ((parsed.endsOn !== undefined && parsed.endsOn !== null) ||
          (parsed.endsAfterRuns !== undefined &&
            parsed.endsAfterRuns !== null))))
  )
    throw new SokoBotRefusedUnsentError(SCHEDULED_RUN_REFUSAL);
  const saved = await refusingHttp(async () => {
    if (!parsed.scheduleId) {
      if (!parsed.name || !parsed.cron)
        throw new SokoBotRefusedUnsentError(
          "A new Task Schedule needs name, brief, cron and timezone.",
        );
      if (parsed.state === "ENDED")
        throw new SokoBotRefusedUnsentError(
          "A new Task Schedule starts ACTIVE or PAUSED; end one that exists by its scheduleId.",
        );
      const request = createTaskScheduleRequestSchema.safeParse({
        // The same tool call, retried after its receipt was lost, replays
        // the schedule the first attempt made instead of making another.
        operationId: toolCallOperationId(authorized.turn.id, input.toolCallId),
        name: parsed.name,
        description: parsed.brief ?? null,
        projectId: parsed.projectId ?? null,
        ...assignee,
        rule: {
          expr: parsed.cron,
          ...(parsed.timezone && { timezone: parsed.timezone }),
          ...ruleEnd(parsed),
        },
      });
      if (!request.success)
        throw new SokoBotRefusedUnsentError(
          request.error.issues.map((issue) => issue.message).join("; "),
        );
      const created = await createTaskSchedule(actor, request.data);
      // The call's initial state goes only on a schedule nobody changed since
      // it was made (revision 0): a retry must not undo the owner's resume,
      // and a first attempt that stopped before pausing still pauses.
      return parsed.state === "PAUSED" &&
        created.state === "ACTIVE" &&
        created.revision === 0
        ? changeTaskScheduleState(actor, created.id, "pause")
        : created;
    }
    const current = await requireChangeable(
      actor,
      authorized,
      parsed.scheduleId,
    );
    const changesRule =
      parsed.cron !== undefined ||
      parsed.timezone !== undefined ||
      parsed.endsOn !== undefined ||
      parsed.endsAfterRuns !== undefined;
    const fields = {
      ...(parsed.name !== undefined && { name: parsed.name }),
      ...(parsed.brief !== undefined && { description: parsed.brief }),
      ...(parsed.projectId !== undefined && { projectId: parsed.projectId }),
      ...assignee,
      ...(changesRule && {
        rule: {
          expr: parsed.cron ?? current.expr,
          timezone: parsed.timezone ?? current.timezone,
          intervalDays: current.intervalDays,
          anchorAt: current.intervalDays
            ? current.anchorAt.toISOString()
            : null,
          ...(parsed.endsOn !== undefined || parsed.endsAfterRuns !== undefined
            ? ruleEnd(parsed)
            : {
                endsMode: current.endsMode,
                endsOn: current.endsOn?.toISOString() ?? null,
                targetRunCount: current.targetRunCount,
              }),
        },
      }),
    };
    let schedule: SavedSchedule = current;
    if (Object.keys(fields).length) {
      const request = updateTaskScheduleRequestSchema.safeParse({
        expectedRevision: current.revision,
        ...fields,
      });
      if (!request.success)
        throw new SokoBotRefusedUnsentError(
          request.error.issues.map((issue) => issue.message).join("; "),
        );
      schedule = await updateTaskSchedule(actor, current.id, request.data);
    }
    if (parsed.state && parsed.state !== schedule.state)
      schedule = await changeTaskScheduleState(
        actor,
        current.id,
        STATE_ACTIONS[parsed.state],
      );
    return schedule;
  });
  const result = { taskSchedule: brief(saved), created: !parsed.scheduleId };
  return runtime.commitReceipt(authorized, input.toolCallId, saved.id, result);
}

export async function removeTaskSchedule(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  const { scheduleId } = sokoBotDeleteTaskScheduleInputSchema.parse(
    input.input,
  );
  if (authorized.turn.source === "SCHEDULE")
    throw new SokoBotRefusedUnsentError(SCHEDULED_RUN_REFUSAL);
  const actor = await botScheduleActor(authorized);
  const current = await refusingHttp(async () => {
    const schedule = await requireChangeable(actor, authorized, scheduleId);
    await deleteTaskSchedule(actor, schedule.id);
    return schedule;
  });
  return runtime.commitReceipt(authorized, input.toolCallId, current.id, {
    taskSchedule: { id: current.id, name: current.name },
    deleted: true,
  });
}
