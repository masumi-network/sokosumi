import { sokoBotTaskSummaryPrompt } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { tryUseLogger } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  SYSTEM_TURN_ROUTES,
  TASK_SUMMARY_CLIENT_TURN_PREFIX,
} from "@/lib/soko-bot/system-routes";
import { INVOLVING_DELEGATION } from "@/lib/soko-bot/task-involvement";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import {
  SokoBotBusyError,
  SokoBotDisabledError,
  SokoBotIdempotencyConflictError,
  SokoBotNoDestinationError,
  SokoBotNotFoundError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { proactiveGate } from "@/services/soko-bot-proactive.service";

/**
 * `started`: the bot writes the summary. `covered`: the bot delegated this
 * Task and someone else completed it, so the events sync wakes the bot to
 * report the completion itself. `deferred`: the
 * daily cap or missing credits; try again later. `busy`: a turn is running;
 * try again next tick.
 * `gone`: the bot cannot run; the bell takes the moment.
 */
export type TaskSummaryOutcome =
  | "started"
  | "covered"
  | "deferred"
  | "busy"
  | "gone";

/**
 * Whether the events sync wakes this bot itself for a settled status on the
 * Task: it does for a delegation the bot involves, but not for a change the
 * bot made. Then the bot reports it and the follow sends nothing more.
 */
export async function delegationWakeCovers(input: {
  taskId: string;
  sokoBotId: string;
  /** The Soko Bot that wrote the status event, if one did. */
  changedBySokoBotId: string | null;
}): Promise<boolean> {
  if (input.changedBySokoBotId === input.sokoBotId) return false;
  const delegated = await prisma.sokoBotDelegation.findFirst({
    where: {
      taskId: input.taskId,
      turn: { sokoBotId: input.sokoBotId },
      ...INVOLVING_DELEGATION,
    },
    select: { id: true },
  });
  return delegated !== null;
}

/**
 * Start the completion summary in the follower's Soko Bot 1:1: an EVENT turn
 * on a read-only route. It counts toward the bot's daily cap and is paid by
 * the follower like any turn their bot starts on its own.
 */
export async function startTaskSummaryTurn(input: {
  momentKey: string;
  task: { id: string; workspaceId: string; identifier: string | null };
  userId: string;
  sokoBotId: string;
  /** The Soko Bot that wrote the completing event, if one did. */
  completedBySokoBotId: string | null;
  abortSignal: AbortSignal;
}): Promise<TaskSummaryOutcome> {
  if (
    await delegationWakeCovers({
      taskId: input.task.id,
      sokoBotId: input.sokoBotId,
      changedBySokoBotId: input.completedBySokoBotId,
    })
  )
    return "covered";

  const gate = await proactiveGate(input.sokoBotId);
  if (!gate.ok) return "deferred";

  try {
    const started = await sokoBotControlPlane.startTurn({
      userId: input.userId,
      sokoBotId: input.sokoBotId,
      workspaceId: input.task.workspaceId,
      clientTurnId: `${TASK_SUMMARY_CLIENT_TURN_PREFIX}${input.momentKey}`,
      message: sokoBotTaskSummaryPrompt(input.task),
      source: "EVENT",
      presetRoute: SYSTEM_TURN_ROUTES["task-summary"],
    });
    // The same client turn id hands back a turn that already ended badly:
    // it wrote no summary, so the bell takes the moment.
    if (started.status === "FAILED" || started.status === "CANCELLED")
      return "gone";
    if (
      started.reconciliationLeaseToken &&
      (started.status === "STARTING" || started.status === "RUNNING")
    ) {
      await sokoBotControlPlane
        .reconcileTurn(
          started.turnId,
          input.abortSignal,
          started.reconciliationLeaseToken,
        )
        .catch((error) => {
          // Only safe fields: turn work can echo its prompt.
          tryUseLogger()?.warn("Task summary turn reconciliation failed", {
            turn: { id: started.turnId },
            failure: messageSafeErrorFields(error),
          });
        });
    }
    return "started";
  } catch (error) {
    // The same client turn id already started: this summary exists.
    if (error instanceof SokoBotIdempotencyConflictError) return "started";
    if (error instanceof SokoBotBusyError) return "busy";
    if (error instanceof SokoBotBillingAccessError) return "deferred";
    // No 1:1 room to write the summary in: the bell takes the moment.
    if (
      error instanceof SokoBotNotFoundError ||
      error instanceof SokoBotDisabledError ||
      error instanceof SokoBotNoDestinationError
    )
      return "gone";
    throw error;
  }
}
