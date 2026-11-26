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
import { actsForOwner } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

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
  if (
    authorized.reader.sharedScope ||
    !actingUserId ||
    !actsForOwner(authorized)
  )
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

/** The owner's own chat turn, the only one that may change someone else's schedule. */
function ownersOwnChat(authorized: AuthorizedSokoBotRuntime): boolean {
  return (
    authorized.turn.source === "CHAT" &&
    authorized.turn.chainDepth === 0 &&
    authorized.askedByKind === "OWNER"
  );
}

async function requireChangeable(
  actor: ScheduleActor,
  authorized: AuthorizedSokoBotRuntime,
  scheduleId: string,
) {
  const current = await findReadableSchedule(actor, scheduleId);
  const ours =
    current.creatorUserId === actor.userId ||
    current.creatorSokoBotId === authorized.turn.sokoBotId;
  if (!ours && !ownersOwnChat(authorized))
    throw new SokoBotRefusedUnsentError(
      `"${current.name}" was made by someone else. Ask your owner first, and change it when they say yes in their chat.`,
    );
  return current;
}

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
  const saved = await refusingHttp(async () => {
    if (!parsed.scheduleId) {
      if (!parsed.name || !parsed.cron)
        throw new SokoBotRefusedUnsentError(
          "A new Task Schedule needs name, brief, cron and timezone.",
        );
      const request = createTaskScheduleRequestSchema.safeParse({
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
      return parsed.state === "PAUSED"
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
