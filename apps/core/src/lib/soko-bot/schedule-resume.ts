import type {
  Prisma,
  SokoBotSchedule,
  SokoBotScheduleRun,
} from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { emitCoreWarning } from "@/lib/evlog";
import {
  DetachedNetworkRefusal,
  detachedNetworkScope,
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

export async function scheduleTurnProvenance(
  schedule: ScheduleSource,
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
  if (schedule.jobId == null || schedule.network !== "preprod") return false;
  if (error instanceof DetachedNetworkRefusal) return !error.final;
  if (!(error instanceof HTTPException) || error.status !== 503) return false;
  const { cause } = error;
  if (typeof cause !== "object" || cause === null || !("kind" in cause)) {
    return false;
  }
  return (
    cause.kind === CORE_API_ERROR_KINDS.PREPROD_PAUSED ||
    cause.kind === CORE_API_ERROR_KINDS.PREPROD_CONTROL_UNAVAILABLE
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
