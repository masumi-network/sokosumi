import type {
  Prisma,
  SokoBotSchedule,
  SokoBotScheduleRun,
} from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { emitCoreWarning } from "@/lib/evlog";
import {
  DetachedNetworkRefusal,
  detachedNetworkScope,
  isTemporaryDetachedRefusal,
} from "@/lib/soko-bot/detached-network";
import type { StartSokoBotTurnInput } from "@/lib/soko-bot/turn-start";

type ScheduleSource = Pick<
  SokoBotSchedule,
  "id" | "jobId" | "network" | "preprodGeneration" | "workspaceId"
>;

export type ScheduledTurnProvenance = Pick<
  StartSokoBotTurnInput,
  "network" | "expectedPreprodGeneration"
>;

/**
 * Slice 30-3 opens fresh Preprod turns. Until then the schedule and Job event
 * pickups leave Preprod work waiting, so it takes no place in a tick.
 */
export function freshPreprodTurnsDeferred(): boolean {
  return true;
}

export async function scheduleTurnProvenance(
  schedule: ScheduleSource,
  deferFreshPreprodTurn = false,
): Promise<ScheduledTurnProvenance> {
  if (schedule.jobId == null) {
    return { network: createNetworkScope("mainnet").network };
  }
  if (schedule.network == null) throw staleScheduleNetwork();
  const scope = await detachedNetworkScope(schedule);
  if (scope.network === "mainnet") return { network: scope.network };

  const job = await scope.networkDb.job.findFirst({
    where: { id: schedule.jobId, workspaceId: schedule.workspaceId },
    select: { id: true },
  });
  if (!job) throw staleScheduleNetwork();
  // Slice 30-3 opens fresh Preprod turns. Until then leave their occurrences due.
  if (deferFreshPreprodTurn && freshPreprodTurnsDeferred())
    throw new DetachedNetworkRefusal(
      CORE_API_ERROR_KINDS.PREPROD_CONTROL_UNAVAILABLE,
    );
  return {
    network: scope.network,
    expectedPreprodGeneration: schedule.preprodGeneration,
  };
}

function staleScheduleNetwork() {
  return new DetachedNetworkRefusal(
    CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE,
  );
}

/** The writer's existing pause fence can refuse a turn after pickup. */
export function isTemporaryScheduleRefusal(
  schedule: Pick<ScheduleSource, "jobId" | "network">,
  error: unknown,
): boolean {
  return (
    schedule.jobId != null &&
    isTemporaryDetachedRefusal(schedule.network, error)
  );
}

type ScheduleRunClaim = Pick<
  SokoBotScheduleRun,
  "id" | "status" | "attempt" | "leaseToken" | "leaseExpiresAt" | "turnId"
>;

function staleScheduleRunData() {
  const error = staleScheduleNetwork();
  return {
    status: "FAILED" as const,
    completedAt: new Date(),
    leaseToken: null,
    leaseExpiresAt: null,
    errorKind: error.kind,
    errorDetail: error.message,
  };
}

/** A stale schedule cannot start a later occurrence either. */
export async function finishStaleSchedule(
  schedule: ScheduleSource,
  run?: ScheduleRunClaim,
): Promise<boolean> {
  const where = {
    id: schedule.id,
    network: schedule.network,
    preprodGeneration: schedule.preprodGeneration,
    jobId: schedule.jobId,
  };
  const disable = (db: Prisma.TransactionClient) =>
    db.sokoBotSchedule.updateMany({
      where: { ...where, enabled: true },
      data: { enabled: false },
    });
  const finishRun = async (run: ScheduleRunClaim) =>
    prisma.$transaction(async (tx) => {
      const { id, status, attempt, leaseToken, leaseExpiresAt, turnId } = run;
      // Settlement takes the run before updating its schedule.
      const finished = await tx.sokoBotScheduleRun.updateMany({
        where: {
          id,
          status,
          attempt,
          leaseToken,
          leaseExpiresAt,
          turnId,
          schedule: where,
        },
        data: staleScheduleRunData(),
      });
      return { finished, disabled: await disable(tx) };
    });
  const { finished, disabled } = run
    ? await finishRun(run)
    : { finished: null, disabled: await disable(prisma) };
  if (disabled.count === 1) {
    emitCoreWarning(
      { operation: "soko_bot_schedule_stale", schedule: { id: schedule.id } },
      {
        message: "Disabled a stale Soko Bot schedule",
        why: "Its stored Network, generation or Job link could not be resumed",
      },
      { errorKind: CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE },
    );
  }
  return (finished ?? disabled).count === 1;
}
